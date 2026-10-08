import { CorsError } from '../cache.ts';
import {
  addCompanyDomain,
  findCompany,
  findCompanyByDomain,
  isBoardDomain,
  normalizeCompanyName,
  normalizeDomain,
  registerCompany,
  slugMatchesCompany,
  type Company,
  type StoredCompany,
} from '../companies/registry.ts';
import {
  discoverableScrapers,
  getScraper,
  isScraperName,
  scraperNames,
  scrapers,
  type ScraperName,
} from '../scrapers/index.ts';
import {
  BoardShapeError,
  type Scraper,
  type ScraperSubclass,
} from '../scrapers/Scraper.ts';
import { searchForBoards } from './search.ts';
import { sniffPage } from './sniff.ts';

/** Thrown when no scraper in this package can serve the requested company */
export class UnresolvedCompanyError extends Error {
  constructor(
    public input: string,
    message?: string,
    /**
     * Whether the browser blocked any board or page tried along the way (see
     * `CorsError`). When it did, the company may well resolve from Node,
     * which doesn't enforce CORS.
     */
    public blocked = false
  ) {
    super(
      (message ?? `Could not resolve a scraper for '${input}'`) +
        (blocked
          ? ` (some job boards were blocked by the browser's CORS policy; it may resolve from Node)`
          : '')
    );
    this.name = 'UnresolvedCompanyError';
  }
}

export interface CompanyInput {
  /** Company name, e.g. `"Airbnb"` or `"apollo.io"` */
  company?: string;
  /** A careers board or job posting URL */
  url?: string;
  /** Skip resolution and use this scraper */
  scraper?: ScraperName;
  /** Skip slug discovery and use this board slug */
  slug?: string;
  /**
   * Whether to fall back to a web search when slug guessing fails.
   * Defaults to on when a SerpApi key is configured.
   */
  search?: boolean;
  /**
   * How many real postings a board needs before discovery will register it,
   * placeholders like "Test UAT" not counting. Guessing a slug proves a board
   * exists, not that the company uses it; plenty keep a forgotten trial
   * account on a board they never moved to. Only applies to boards found by
   * probing or search; a URL or registry entry is trusted as is.
   * @default 3
   */
  minJobs?: number;
}

const DEFAULT_MIN_JOBS = 3;

export interface ResolvedCompany extends Company {
  /** True when the company was resolved by probing rather than looked up */
  discovered: boolean;
}

/** A resolved company plus the job id, when the input pointed at one posting */
export interface ResolvedJob extends ResolvedCompany {
  jobId: string | null;
}

/**
 * Turns loose input (a company name, a URL, an explicit scraper) into a
 * concrete company record. Companies found by probing are added to the
 * registry so the next call is a plain lookup.
 */
export async function resolveCompany(
  input: CompanyInput | string
): Promise<ResolvedCompany> {
  return resolveJob(input);
}

/**
 * Like `resolveCompany`, but also recovers the job id when the input was a
 * job posting URL.
 */
export async function resolveJob(
  input: CompanyInput | string
): Promise<ResolvedJob> {
  const options = normalizeInput(input);
  const { scraper, slug } = options;
  const minJobs = options.minJobs ?? DEFAULT_MIN_JOBS;
  let jobId: string | null = null;

  if (!options.company && !options.url && !slug) {
    throw new TypeError('A company name, URL, or slug is required');
  }

  if (scraper && !isScraperName(scraper)) {
    throw new TypeError(`Unknown scraper: ${scraper}`);
  }

  const url = options.url ? URL.parse(options.url) : null;
  const host = url && normalizeDomain(url.hostname);

  // every name worth trying, best first. The caller's own name outranks
  // anything guessed from the URL, and each gains a careers-stripped form
  const names = new NameCandidates();
  names.add(options.company);

  // what went wrong with candidates along the way, so that a failure can say
  // *why* rather than shrugging with a generic "not found"
  const misses: ProbeLog = { shapeErrors: [], blocked: false };

  /**
   * Records the company's own careers domain on the way out, so the next URL
   * on it is a plain lookup. Board hosts are excluded: `parseUrl` already
   * knows them, and claiming one would point every company's jobs at this one
   */
  const resolved = async (result: ResolvedJob): Promise<ResolvedJob> => {
    if (host && !isBoardDomain(host) && ownDomain(host, result.name)) {
      await addCompanyDomain(result.name, host);
    }
    return result;
  };

  if (url) {
    // 1. a URL a scraper recognizes names the board outright, so trust it
    const parsed = parseJobUrl(url.href, scraper);
    if (parsed) {
      const known = await findCompany(parsed.name);
      return resolved({
        ...parsed,
        // prefer a real display name over one derived from a slug
        name: options.company ?? known?.name ?? parsed.name,
        discovered: false,
      });
    }

    jobId = jobIdFromUrl(url);

    // 2. a domain this company has been seen on before. This is the whole
    // point of storing domains: a bespoke careers site (`pinterestcareers.com`)
    // otherwise has to earn its way through every step below, every time
    const byDomain = await findCompanyByDomain(url.hostname);
    if (byDomain && (!scraper || byDomain.scraper === scraper)) {
      return {
        ...byDomain,
        name: options.company ?? byDomain.name,
        jobId,
        discovered: false,
      };
    }

    // 3. the hostname usually carries the company name (`careers.acme.com`)
    names.add(companyNameFromUrl(url));

    const byHost = await findKnown(names, scraper);
    if (byHost) {
      return resolved({ ...byHost, jobId, discovered: false });
    }

    // 4. read the page itself. It's likely a board embedded on the company's
    // own domain, and the markup still has to name the board it loads
    const page = await sniffPage(url.href);
    if (page.blocked) misses.blocked = true;
    const [embedded] = page.boards;
    if (embedded) {
      const known = await findCompany(embedded.slug);
      return resolved({
        name: options.company ?? known?.name ?? embedded.slug,
        scraper: embedded.scraper,
        slug: embedded.slug,
        // deliberately not `embedded.jobId`: that's whichever posting the
        // page happened to link first, not the one the caller asked for
        jobId,
        discovered: false,
      });
    }

    // 5. no board in the markup, but the page still says who it belongs to.
    // `og:site_name` and JSON-LD beat the hostname, which is why they're
    // tried before falling back to it for discovery below
    names.prepend(page.names);

    const byName = await findKnown(names, scraper);
    if (byName) {
      return resolved({ ...byName, jobId, discovered: false });
    }

    if (names.empty && !slug) {
      throw new UnresolvedCompanyError(
        url.href,
        `No scraper recognizes '${url.href}'`,
        misses.blocked
      );
    }
  }

  names.add(slug);
  const name = names.primary!;

  // 6. caller pinned the board explicitly
  if (scraper && slug) {
    return { name, scraper, slug, jobId, discovered: false };
  }

  // 7. already known
  const known = await findKnown(names, scraper);
  if (known) {
    return resolved({ ...known, jobId, discovered: false });
  }

  // 8. probe the boards that can be addressed by a guessable slug. A URL
  // carrying a board's own tracking params (`?gh_jid=`) says which board to
  // try first, even when nothing else about the page does
  const hinted = url ? boardHints(url) : [];
  const candidates = scraper
    ? [scraper]
    : [...hinted, ...discoverableScrapers.filter((s) => !hinted.includes(s))];

  const found = await discoverBoard(
    names.all,
    slug,
    candidates,
    minJobs,
    misses
  );
  if (found) {
    await registerCompany(found);
    return resolved({ ...found, jobId, discovered: true });
  }

  // 9. ask the web which board they're on. This is the only route to boards
  // whose slug isn't derivable from the name at all, Workday especially
  if (options.search ?? true) {
    const searched = await searchForBoards(name);
    for (const board of searched) {
      if (scraper && board.scraper !== scraper) continue;
      // a search for a company that other job posts name-drop (an HR vendor,
      // say) surfaces boards belonging to entirely different companies, so
      // the slug has to look like the company before we'll believe it
      if (!slugMatchesCompany(board.slug, name)) continue;

      // the search told us where to look; the board still has to confirm it
      const ScraperClass = scrapers[board.scraper];
      if (!(await hasCompanyBoard(ScraperClass, board.slug, minJobs, misses))) {
        continue;
      }

      const company = { name, scraper: board.scraper, slug: board.slug };
      await registerCompany(company);
      return resolved({
        ...company,
        jobId: jobId ?? board.jobId,
        discovered: true,
      });
    }
  }

  // nothing resolved; if a candidate along the way looked like the right
  // board but a fallback couldn't parse its page, that's more useful to the
  // caller than a blanket "couldn't find it"
  if (misses.shapeErrors.length > 0) throw misses.shapeErrors[0];
  throw new UnresolvedCompanyError(name, undefined, misses.blocked);
}

interface ProbeLog {
  /** Fallback page-shape mismatches (see `BoardShapeError`) */
  shapeErrors: BoardShapeError[];
  /** Whether the browser refused any request (see `CorsError`) */
  blocked: boolean;
}

/**
 * Runs `hasCompanyBoard` on a throwaway instance, recording a `BoardShapeError` or `CorsError` in
 * `misses` instead of letting it abort the candidate loop it's called from.
 * A board the browser won't let us reach is no match, not a failure: the
 * company may well be on one of the boards it can reach.
 */
async function hasCompanyBoard(
  ScraperClass: ScraperSubclass,
  slug: string,
  minJobs: number,
  misses: ProbeLog
): Promise<boolean> {
  const instance = new ScraperClass(slug);
  try {
    return await instance.hasCompanyBoard(minJobs);
  } catch (err) {
    if (err instanceof BoardShapeError) misses.shapeErrors.push(err);
    else if (err instanceof CorsError) misses.blocked = true;
    else throw err;
    return false;
  } finally {
    instance.dispose();
  }
}

// words a company tacks onto its own name when it runs a careers site of its
// own: `pinterestcareers.com`, `lifeatacme.io`, "Figma Careers"
const SITE_PREFIX =
  /^(?:life[-_. ]?at|work[-_. ]?at|join[-_. ]?us|join)[-_. ]?/i;
const SITE_SUFFIX =
  /[-_. ]?(?:careers?|jobs?|hiring|talent|recruiting|apply)$/i;

/**
 * Alternate readings of a company name. A careers domain or page title names
 * the site rather than the company, so `pinterestcareers` has to be allowed
 * to mean `pinterest`, otherwise a company already in the registry is missed
 * purely because the link went through its own careers site.
 */
export function companyNameCandidates(name: string): string[] {
  const stripped = name
    .replace(SITE_PREFIX, '')
    .replace(SITE_SUFFIX, '')
    .trim();
  return stripped && stripped !== name ? [name, stripped] : [name];
}

/** An ordered, de-duplicated set of names to try, best first */
class NameCandidates {
  #names: string[] = [];

  get all(): string[] {
    return this.#names;
  }

  get primary(): string | undefined {
    return this.#names[0];
  }

  get empty(): boolean {
    return this.#names.length === 0;
  }

  add(...values: (string | null | undefined)[]): void {
    for (const value of values.flat()) {
      if (value && !this.#names.includes(value)) this.#names.push(value);
    }
  }

  /** Adds names ahead of what's already there, keeping their own order */
  prepend(values: string[]): void {
    const existing = this.#names;
    this.#names = [];
    this.add(...values);
    this.add(...existing);
  }
}

/** The first candidate name the registry knows, trying stripped forms too */
async function findKnown(
  names: NameCandidates,
  scraper?: ScraperName
): Promise<StoredCompany | null> {
  for (const name of names.all) {
    for (const candidate of companyNameCandidates(name)) {
      const known = await findCompany(candidate);
      if (known && (!scraper || known.scraper === scraper)) return known;
    }
  }
  return null;
}

/**
 * Whether a hostname plausibly belongs to the company itself, rather than to
 * an aggregator that merely lists their jobs. Only the company's own domains
 * are worth remembering; recording `linkedin.com` would hand every later
 * LinkedIn link to whichever company was looked up first.
 */
function ownDomain(hostname: string, companyName: string): boolean {
  // short names match too much of too many hostnames to be evidence
  return (
    normalizeCompanyName(companyName).length >= 4 &&
    slugMatchesCompany(hostname, companyName)
  );
}

/** Boards named by a URL's own tracking params, e.g. `?gh_jid=` for Greenhouse */
export function boardHints(url: URL): ScraperName[] {
  return scraperNames.filter((name) =>
    scrapers[name].urlHintParams.some((param) => url.searchParams.has(param))
  );
}

// subdomains that name the job board rather than the company
const BOARD_SUBDOMAINS = new Set([
  'apply',
  'boards',
  'careers',
  'jobs',
  'job-boards',
  'explore',
  'www',
]);

/**
 * Best-effort company name from a careers URL hosted on the company's own
 * domain, e.g. `https://careers.acme.com/...` -> `acme`.
 */
export function companyNameFromUrl(url: URL): string | null {
  const labels = url.hostname.split('.').filter(Boolean);
  while (labels.length > 2 && BOARD_SUBDOMAINS.has(labels[0])) labels.shift();

  // everything from here on is the public suffix
  return labels.length > 1 ? labels[0] : null;
}

// query params boards use to address a single posting when the path doesn't
const JOB_ID_PARAMS = ['gh_jid', 'pid', 'jobId', 'job_id', 'lever-job-id'];

/** Best-effort job id from a URL no scraper claimed */
export function jobIdFromUrl(url: URL): string | null {
  for (const param of JOB_ID_PARAMS) {
    const value = url.searchParams.get(param);
    if (value) return value;
  }

  // a trailing all-digits segment is an id often enough to be worth trying;
  // anything looser matches too many ordinary careers pages
  const last = url.pathname.split('/').filter(Boolean).at(-1);
  return last && /^\d+$/.test(last) ? last : null;
}

/** Builds the scraper instance for a resolved company */
export function createScraper(company: Company): Scraper {
  const ScraperClass = getScraper(company.scraper);
  return new ScraperClass(company.slug);
}

/**
 * Asks each scraper whether it recognizes the URL. Returns the board it
 * belongs to, plus the job id when the URL addresses a single posting.
 */
export function parseJobUrl(
  input: string,
  only?: ScraperName
): (ResolvedJob & { discovered: false }) | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  for (const name of only ? [only] : scraperNames) {
    const parsed = scrapers[name].parseUrl(url);
    if (!parsed) continue;

    return {
      // the slug is the only name a URL carries; callers with a better one
      // overwrite it
      name: parsed.slug,
      scraper: name,
      slug: parsed.slug,
      jobId: parsed.jobId,
      discovered: false,
    };
  }

  return null;
}

/**
 * Tries each scraper's slug guesses against its board. Probes run in
 * parallel, but the result follows `candidates` order so that the most
 * common board wins a tie. A board with fewer than `minJobs` real postings
 * doesn't count as an answer.
 */
async function discoverBoard(
  names: string[],
  slug: string | undefined,
  candidates: ScraperName[],
  minJobs: number,
  misses: ProbeLog
): Promise<Company | null> {
  // every reading of the name gets probed, since a careers-site name and the
  // company's real one produce different slugs (`pinterestcareers` vs
  // `pinterest`). Whichever answers is also the name we register it under
  const readings = [...new Set(names.flatMap(companyNameCandidates))];

  const probes = candidates.flatMap((scraper) => {
    const ScraperClass = scrapers[scraper];

    return readings.flatMap((companyName) => {
      const slugs = slug ? [slug] : ScraperClass.slugCandidates(companyName);

      return slugs.map(async (slug) => {
        const exists = await hasCompanyBoard(
          ScraperClass,
          slug,
          minJobs,
          misses
        );
        return exists ? { name: companyName, scraper, slug } : null;
      });
    });
  });

  // `Promise.all` rather than `any`, so the ordering above is what decides
  const results = await Promise.all(probes);
  return results.find((result) => result !== null) ?? null;
}

function normalizeInput(input: CompanyInput | string): CompanyInput {
  if (typeof input !== 'string') return input;
  return URL.canParse(input) ? { url: input } : { company: input };
}
