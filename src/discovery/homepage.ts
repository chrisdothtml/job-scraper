import { cachedFetch, corsAwareFetch, CorsError } from '../cache.ts';
import {
  findCompany,
  isBoardDomain,
  normalizeCompanyName,
  normalizeDomain,
  setCompanyHomepage,
  type Company,
} from '../companies/registry.ts';
import { pkgVersion } from '../constants.ts';
import { resolveCompany } from './resolve.ts';
import { scrapers } from '../scrapers/index.ts';
import { canSearch, getSearchConfig, searchForHomepage } from './search.ts';
import {
  BROWSER_USER_AGENT,
  findBoardsInPage,
  findNamesInPage,
} from './sniff.ts';
import { time } from '../utils/misc.ts';

export interface HomepageOptions {
  /**
   * Also ask a web search when the free sources don't settle it. Defaults to
   * `SearchConfig.homepages` (off unless configured), and does nothing
   * without a key; see `configureSearch`. Results are verified like any
   * other candidate.
   */
  search?: boolean;
}

/** Where a homepage came from, most trustworthy first */
export type HomepageSource =
  | 'board'
  | 'careers-domain'
  | 'clearbit'
  | 'wikidata'
  | 'guess'
  | 'search';

export interface FoundHomepage {
  /** The site's origin, e.g. `https://ramp.com` */
  url: string;
  source: HomepageSource;
}

// every source is best-effort, and a slow one mustn't hold the rest up
const SOURCE_TIMEOUT = 8 * time.second;

// a remembered miss is retried after this long even within one release, since
// a company with no findable site today may well launch one
const MISS_TTL = 30 * time.day;

/**
 * Finds a company's own website (its homepage, not its careers board), e.g.
 * for looking up its favicon. Takes a company record, or anything
 * `resolveCompany` accepts.
 *
 * The answer is remembered on the company's registry entry, as is a failure
 * to find one, so repeat calls are free. A remembered failure is retried
 * after a while, and by every new release of this package.
 *
 * Resolves to null when no source produced a homepage it could stand behind.
 *
 * @throws {UnresolvedCompanyError} when given a name or URL that doesn't
 * resolve to a company
 *
 * @example
 * await resolveHomepage('Ramp'); // 'https://ramp.com'
 */
export async function resolveHomepage(
  input: Company | string,
  options: HomepageOptions = {}
): Promise<string | null> {
  const company =
    typeof input === 'string'
      ? ((await findCompany(input)) ?? (await resolveCompany(input)))
      : input;

  const stored = await findCompany(company.name);
  const homepage = stored?.homepage ?? company.homepage;
  if (homepage) return homepage;

  const search =
    (options.search ?? getSearchConfig().homepages) && (await canSearch());
  const miss = stored?.homepageMiss;
  if (
    // only the release that recorded a miss trusts it; a newer one may
    // resolve what that one couldn't
    miss?.version === pkgVersion &&
    Date.now() - miss.ts < MISS_TTL &&
    // a miss without search doesn't answer a caller who's asking for one
    (miss.searched || !search)
  ) {
    return null;
  }

  const found = await findHomepage(stored ?? company, { search });
  await setCompanyHomepage(
    company.name,
    found
      ? { homepage: found.url }
      : { miss: { ts: Date.now(), searched: search, version: pkgVersion } }
  );
  return found?.url ?? null;
}

/**
 * Looks a company's homepage up from scratch, ignoring and not touching the
 * registry. Sources are tried most trustworthy first:
 *
 * 1. the website the company gave its job board, where the board keeps one
 * 2. the parent of a careers domain it posts on (`careers.acme.com`)
 * 3. name-to-domain lookups (Clearbit, Wikidata)
 * 4. guessed domains built from its name and board slug
 * 5. a web search, when search is on (`options.search`, defaulting to
 *    `SearchConfig.homepages`) and a key is configured. It runs whenever the
 *    sources above didn't find a page linking back to the company's board,
 *    not only when they found nothing, since that's where they go wrong
 *
 * Everything past the first is only a candidate, and has to be confirmed by
 * fetching it: the page has to link to the company's board, or call itself
 * by the company's name. Each source fails quietly, so any one of them
 * disappearing costs coverage, never an error.
 */
export async function findHomepage(
  company: Company,
  options: HomepageOptions = {}
): Promise<FoundHomepage | null> {
  const ScraperClass = scrapers[company.scraper];
  const declared = await attempt(
    (signal) => ScraperClass.fetchHomepage(company.slug, signal),
    null
  );
  const declaredOrigin = declared && siteOrigin(declared);
  if (declaredOrigin) return { url: declaredOrigin, source: 'board' };

  const [clearbit, wikidata] = await Promise.all([
    attempt((signal) => clearbitCandidates(company.name, signal), []),
    attempt((signal) => wikidataCandidates(company.name, signal), []),
  ]);

  const careers = careersParents(company.domains ?? []).flatMap(
    as('careers-domain')
  );
  const lookups = [
    ...clearbit.flatMap(as('clearbit')),
    ...wikidata.flatMap(as('wikidata')),
  ];
  const guesses = guessDomains(company).flatMap(as('guess'));

  // each candidate is fetched once, however many times it's ranked
  const verdicts = new Map<string, Promise<Verdict | null>>();
  const check = (url: string) => {
    let verdict = verdicts.get(url);
    if (!verdict) {
      verdict = verify(company, url).catch(() => null);
      verdicts.set(url, verdict);
    }
    return verdict;
  };

  const found = await pickVerified(
    company,
    dedupe([...careers, ...lookups, ...guesses]),
    check
  );
  // a page linking back to the board settles it; anything less is worth a
  // search to a caller who's opted into spending them
  const search = options.search ?? getSearchConfig().homepages;
  if (found?.conclusive || !search || !(await canSearch())) {
    return found?.homepage ?? null;
  }

  const links = await attempt(() => searchForHomepage(company.name), []);
  const searched = dedupe(
    links.filter((link) => !isProfileSite(link)).flatMap(as('search'))
  ).slice(0, SEARCH_CANDIDATES);
  if (searched.length === 0) return found?.homepage ?? null;

  // a search result that names the company outranks a lookup that does: the
  // search ranks by the name in context, where Clearbit and Wikidata only
  // match it letter for letter
  const better = await pickVerified(
    company,
    dedupe([...careers, ...searched, ...lookups, ...guesses]),
    check
  );
  return better?.homepage ?? found?.homepage ?? null;
}

// how many search results are worth fetching; past the first few, they're
// pages *about* the company rather than its own
const SEARCH_CANDIDATES = 5;

type Candidate = FoundHomepage;

interface Verdict {
  /** The origin the candidate ended up at, after redirects */
  url: string;
  /**
   * Whether the page could actually be read. A site that answers with an
   * error (usually bot protection) or that a browser won't let us read
   * (CORS) is live, but says nothing about whose it is
   */
  readable: boolean;
  /** The page links to the company's board or careers domains */
  linksBoard: boolean;
  /** The page calls itself by the company's name */
  namesCompany: boolean;
}

// sources whose candidates are tied to the company by more than a guess, so
// that being a live site is enough when the page itself can't be read
const TRUSTED: HomepageSource[] = ['careers-domain', 'clearbit', 'wikidata'];

/**
 * Fetches every candidate and picks the best confirmed one, in this order:
 *
 * 1. a page linking back to the company's board
 * 2. a looked-up page calling itself by the company's name
 * 3. a careers domain's parent that's live, or another trusted candidate
 *    that's live and either is named for the company (`lyft.com`) or can't
 *    be read (bot protection, or a browser refused by CORS). One that *can*
 *    be read but names neither is someone else's site sharing the name
 * 4. a guessed page calling itself by the company's name, since a common
 *    name is shared by plenty of sites that aren't this company's
 *
 * Within each, the earlier (more trustworthy) source wins.
 *
 * Guesses are judged in order of likelihood, and only the first live one
 * counts: when `acme.com` exists but won't show us its page, `acme.io`
 * calling itself "Acme" is far more likely someone else than the company.
 */
async function pickVerified(
  company: Company,
  candidates: Candidate[],
  check: (url: string) => Promise<Verdict | null>
): Promise<{ homepage: FoundHomepage; conclusive: boolean } | null> {
  const settled = await Promise.all(
    candidates.map(async (candidate) => {
      const verdict = await check(candidate.url);
      return verdict && { candidate, verdict };
    })
  );

  const firstGuess = settled.find((v) => v?.candidate.source === 'guess');
  const live = settled.filter(
    (v): v is NonNullable<typeof v> =>
      v !== null && (v.candidate.source !== 'guess' || v === firstGuess)
  );

  const best =
    live.find(({ verdict }) => verdict.linksBoard) ??
    live.find(
      ({ candidate, verdict }) =>
        verdict.namesCompany && candidate.source !== 'guess'
    ) ??
    live.find(
      ({ candidate, verdict }) =>
        candidate.source === 'careers-domain' ||
        (TRUSTED.includes(candidate.source) &&
          (!verdict.readable || domainNamesCompany(company, verdict.url)))
    ) ??
    live.find(({ verdict }) => verdict.namesCompany);
  if (!best) return null;

  return {
    homepage: { url: best.verdict.url, source: best.candidate.source },
    conclusive: best.verdict.linksBoard,
  };
}

// what a parked or for-sale domain says about itself
const PARKED =
  /\b(?:domain (?:name )?(?:is |may be )?for sale|buy this domain|this domain (?:is|may be) for sale|domain has expired|parked (?:free|domain)|sedoparking|hugedomains|afternic)\b/i;
const MARKETPLACES = [
  'afternic.com',
  'dan.com',
  'godaddy.com',
  'hugedomains.com',
  'sedo.com',
  'squadhelp.com',
  'atom.com',
];

// how much of a page to read; a homepage's head says all that's needed
const MAX_HTML = 500_000;

/**
 * Fetches a candidate and reports what it says about itself. Throws when the
 * candidate isn't a live, unparked site.
 */
async function verify(company: Company, url: string): Promise<Verdict> {
  let res: Response;
  try {
    res = await corsAwareFetch(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(SOURCE_TIMEOUT),
    });
  } catch (err) {
    if (err instanceof CorsError) return unreadable(url);
    throw err;
  }
  // gone is gone, but anything else (403s from bot protection, mostly)
  // still means there's a site here
  if (res.status === 404 || res.status === 410) {
    throw new Error(`${res.status} from ${url}`);
  }

  const finalUrl = landedOn(url, res.url);
  if (!finalUrl) throw new Error(`${url} redirected somewhere unusable`);

  const host = normalizeDomain(finalUrl);
  if (MARKETPLACES.some((m) => host === m || host.endsWith(`.${m}`))) {
    throw new Error(`${url} is for sale`);
  }
  if (!res.ok) return unreadable(finalUrl);

  const html = (await res.text()).slice(0, MAX_HTML);
  if (PARKED.test(html)) throw new Error(`${url} is parked`);

  return {
    url: finalUrl,
    readable: true,
    linksBoard: linksBoard(company, html),
    namesCompany: namesCompany(company, html),
  };
}

/**
 * Where a candidate's redirects ended up, as an origin. A hop onto one of the
 * site's own subdomains (`spotify.com` to `open.spotify.com`) is a detail of
 * how it serves pages, so the candidate itself stands.
 */
function landedOn(candidate: string, final: string): string | null {
  const landed = siteOrigin(final || candidate);
  if (!landed) return null;

  const host = normalizeDomain(candidate);
  return normalizeDomain(landed).endsWith(`.${host}`) ? candidate : landed;
}

function unreadable(url: string): Verdict {
  return { url, readable: false, linksBoard: false, namesCompany: false };
}

// second-level labels that are part of a country's suffix (`acme.co.uk`)
const COUNTRY_SECOND_LEVELS = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'net',
  'org',
]);

/** Whether the site's own name (`acme` in `www.acme.co.uk`) is the company's */
function domainNamesCompany(company: Company, url: string): boolean {
  const labels = normalizeDomain(url).split('.');
  const countrySuffix =
    labels.length >= 3 &&
    labels.at(-1)!.length === 2 &&
    COUNTRY_SECOND_LEVELS.has(labels.at(-2)!);
  const stem = labels.at(countrySuffix ? -3 : -2) ?? '';
  return companyKeys(company.name).has(normalizeCompanyName(stem));
}

function linksBoard(company: Company, html: string): boolean {
  const slug = company.slug.toLowerCase();
  if (
    findBoardsInPage(html).some(
      (board) =>
        board.scraper === company.scraper && board.slug.toLowerCase() === slug
    )
  ) {
    return true;
  }

  const lower = html.toLowerCase();
  return (company.domains ?? []).some((domain) =>
    lower.includes(`//${normalizeDomain(domain)}`)
  );
}

// separators a `<title>` puts between the site's name and everything else
const TITLE_SEPARATOR = /\s*[|–—·]\s*|\s+-\s+|:\s+/;

function namesCompany(company: Company, html: string): boolean {
  const wanted = companyKeys(company.name);
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  const names = [...findNamesInPage(html), ...title.split(TITLE_SEPARATOR)];
  return names.some((name) => name && wanted.has(normalizeCompanyName(name)));
}

/**
 * The lookup keys a site might go by: "Apollo.io" is just as likely to call
 * itself "Apollo"
 */
function companyKeys(name: string): Set<string> {
  return new Set([
    normalizeCompanyName(name),
    normalizeCompanyName(name.replace(/\.(?:ai|app|co|com|dev|io)$/i, '')),
  ]);
}

/**
 * Clearbit's autocomplete endpoint maps a name to the domains of companies
 * by that name.
 *
 * Treat it as one more contributor, nothing more. It's undocumented and
 * unsupported, and its owner (HubSpot) has already shut down every other free
 * Clearbit API; it could vanish or change shape at any time. When it does,
 * this quietly yields nothing and the other sources carry on. Its matches
 * are also loose (it'll offer "Harvey Norman" for "Harvey"), so only exact
 * name matches are kept, and those still get verified.
 */
async function clearbitCandidates(
  name: string,
  signal: AbortSignal
): Promise<string[]> {
  const url = new URL('https://autocomplete.clearbit.com/v1/companies/suggest');
  url.searchParams.set('query', name);
  const res = await cachedFetch.call({ cacheTTL: time.day }, url, { signal });
  const suggestions = (await res.json()) as unknown;
  if (!Array.isArray(suggestions)) return [];

  // suggestions come most prominent first, and a later one with the same
  // name is nearly always a lookalike (`doordashstore.com`), so only the
  // first exact match is worth anything
  const want = normalizeCompanyName(name);
  const match = suggestions.find(
    (s: { name?: unknown; domain?: unknown }) =>
      typeof s?.name === 'string' &&
      typeof s.domain === 'string' &&
      normalizeCompanyName(s.name) === want
  ) as { domain: string } | undefined;
  return match ? [`https://${match.domain}`] : [];
}

// Wikimedia throttles clients that don't say who they are. Browsers won't
// let a page set `User-Agent`, so they send `Api-User-Agent` instead
const WIKIMEDIA_HEADERS = {
  'User-Agent': 'job-scraper (https://github.com/chrisdothtml/job-scraper)',
  'Api-User-Agent': 'job-scraper (https://github.com/chrisdothtml/job-scraper)',
};

// what a Wikidata description says when the entity is an organization
const ORGANIZATION =
  /\b(compan(?:y|ies)|corporation|conglomerate|subsidiary|business|firm|enterprise|startup|manufacturer|retailer|chain|brand|bank|organi[sz]ation|institut(?:e|ion)|foundation|non-?profit|charity|agency|government|museum|university|college|school|laborator(?:y|ies)|research|publisher|studio|operator|provider)\b/i;

/**
 * Wikidata's "official website" (P856) for entities labelled with the
 * company's name. Covers established and public companies well, startups
 * hardly at all.
 */
async function wikidataCandidates(
  name: string,
  signal: AbortSignal
): Promise<string[]> {
  const api = 'https://www.wikidata.org/w/api.php';
  const search = new URL(api);
  for (const [key, value] of Object.entries({
    action: 'wbsearchentities',
    search: name,
    language: 'en',
    type: 'item',
    limit: '5',
    format: 'json',
    origin: '*',
  })) {
    search.searchParams.set(key, value);
  }

  const want = normalizeCompanyName(name);
  const found = (await cachedFetch
    .call({ cacheTTL: time.day }, search, {
      headers: WIKIMEDIA_HEADERS,
      signal,
    })
    .then((r) => r.json())) as {
    search?: {
      id?: string;
      label?: string;
      description?: string;
      match?: { text?: string };
    }[];
  };
  const ids = (found.search ?? [])
    .filter(
      (hit) =>
        typeof hit.id === 'string' &&
        // a name is shared by albums, paintings and programming languages
        // too, and those have official websites as well
        ORGANIZATION.test(hit.description ?? '') &&
        [hit.label, hit.match?.text].some(
          (label) => label && normalizeCompanyName(label) === want
        )
    )
    .map((hit) => hit.id!);
  if (ids.length === 0) return [];

  const entities = new URL(api);
  for (const [key, value] of Object.entries({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'claims',
    format: 'json',
    origin: '*',
  })) {
    entities.searchParams.set(key, value);
  }

  const data = (await cachedFetch
    .call({ cacheTTL: time.day }, entities, {
      headers: WIKIMEDIA_HEADERS,
      signal,
    })
    .then((r) => r.json())) as {
    entities?: Record<
      string,
      {
        claims?: {
          P856?: { mainsnak?: { datavalue?: { value?: unknown } } }[];
        };
      }
    >;
  };

  // the best-ranked entity with a website, and only its first one
  const sites = ids.flatMap((id) =>
    (data.entities?.[id]?.claims?.P856 ?? []).flatMap((claim) => {
      const value = claim.mainsnak?.datavalue?.value;
      return typeof value === 'string' ? [value] : [];
    })
  );
  return sites.slice(0, 1);
}

// leading labels that mark a side site (careers, investor relations) rather
// than the company's main one
const SUBSITE_LABELS =
  /^(careers?|jobs?|work|join|apply|talent|hiring|recruiting|life|team|people|investors?|ir)$/;

/**
 * The company's main site, as implied by careers domains it posts on:
 * `careers.acme.com` and `jobs.acme.co.uk` point at their parent. A bespoke
 * careers domain (`pinterestcareers.com`) implies nothing, and is left to the
 * guesses.
 */
function careersParents(domains: string[]): string[] {
  return domains.flatMap((domain) => {
    const host = normalizeDomain(domain);
    const site = siteOrigin(host);
    return site && normalizeDomain(site) !== host ? [site] : [];
  });
}

const GUESS_TLDS = ['com', 'ai', 'io', 'co'];
// startups that couldn't get the bare `.com` commonly settle for one of these
const GUESS_PREFIXES = ['get', 'try', 'use', 'join', 'with'];

/**
 * Domains worth trying for a company, built from its name and its board
 * slug, which often matches the domain where the name doesn't
 * (`runwayml`, `apolloio`).
 */
function guessDomains(company: Company): string[] {
  const words = company.name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  // Workday slugs are `tenant.pod.site`, and only the tenant is a name
  const slug = company.slug
    .split('.')[0]!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/\d+$/, '');

  const stems = new Set(
    [words.join(''), normalizeCompanyName(company.name), slug].filter(
      (stem) => stem.length > 1
    )
  );

  const hosts: string[] = [];
  // "Acme AI" is far more often acme.ai than anything built on "acmeai"
  if (words.length > 1 && words.at(-1) === 'ai') {
    hosts.push(`${words.slice(0, -1).join('')}.ai`);
  }
  for (const stem of stems) {
    for (const tld of GUESS_TLDS) hosts.push(`${stem}.${tld}`);
  }
  for (const stem of stems) {
    for (const prefix of GUESS_PREFIXES) hosts.push(`${prefix}${stem}.com`);
    hosts.push(`${stem}hq.com`);
  }

  return hosts.map((host) => `https://${host}`);
}

// sites that rank for a company's name with a page *about* it, and would
// pass for its homepage by naming it in their title
const PROFILE_SITES = [
  'crunchbase.com',
  'facebook.com',
  'glassdoor.com',
  'instagram.com',
  'linkedin.com',
  'pitchbook.com',
  'twitter.com',
  'wikipedia.org',
  'x.com',
  'youtube.com',
];

function isProfileSite(url: string): boolean {
  const host = normalizeDomain(url);
  return PROFILE_SITES.some(
    (site) => host === site || host.endsWith(`.${site}`)
  );
}

/**
 * Reduces a URL (or bare domain) to its origin, or null when it isn't a
 * usable website: unparseable, not http(s), or one of the job boards.
 */
function toOrigin(raw: string): string | null {
  const url = URL.parse(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!url || !/^https?:$/.test(url.protocol)) return null;
  if (!url.hostname.includes('.') || isBoardDomain(url.hostname)) return null;
  return url.origin;
}

/**
 * Like `toOrigin`, but climbs off a careers or investor subdomain to the
 * site it belongs to (`careers.acme.com` is `acme.com`'s), since a board's
 * "company website" is sometimes set to the careers site itself, and a search
 * often ranks the investor site first.
 */
function siteOrigin(raw: string): string | null {
  const origin = toOrigin(raw);
  if (!origin) return null;

  const url = new URL(origin);
  const labels = normalizeDomain(url.hostname).split('.');
  if (labels.length < 3 || !SUBSITE_LABELS.test(labels[0]!)) return origin;
  return `${url.protocol}//${labels.slice(1).join('.')}`;
}

function as(source: HomepageSource) {
  return (url: string): Candidate[] => {
    const origin = siteOrigin(url);
    return origin ? [{ url: origin, source }] : [];
  };
}

/** First occurrence of each site wins, `www.` or not */
function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const host = normalizeDomain(candidate.url);
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  });
}

/** Runs one source, turning any failure (or a timeout) into `fallback` */
async function attempt<T>(
  source: (signal: AbortSignal) => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await source(AbortSignal.timeout(SOURCE_TIMEOUT));
  } catch {
    return fallback;
  }
}
