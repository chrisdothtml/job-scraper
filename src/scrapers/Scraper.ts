import builtinAssert from 'node:assert';
import { type TestContext } from 'node:test';

export interface ListedJob {
  /** Stable identifier, usable with `getJobContent` */
  id: string;
  title: string;
  location: string;
  url: string;
}

export interface Job extends ListedJob {
  /** The full posting. May be plaintext, markdown, or stringified JSON */
  content: string;
}

/** The pieces of a company's job board that can be recovered from a URL */
export interface ParsedUrl {
  /** The board slug, as a `Scraper` constructor takes it */
  slug: string;
  /** The job id, when the URL points at a single posting */
  jobId: string | null;
}

/** Thrown when a board has no posting under the given id */
export class JobNotFoundError extends Error {
  constructor(
    public jobId: string,
    public companySlug: string
  ) {
    super(`No job '${jobId}' on board '${companySlug}'`);
    this.name = 'JobNotFoundError';
  }
}

/**
 * Thrown by a scraper's fallback path (scraping data out of a page, rather
 * than a stable API) when the page loaded but didn't match the shape the
 * fallback expects. This means the page changed, not that the board doesn't
 * exist, so it's kept distinct from a plain miss: `hasCompanyBoard` lets it
 * through instead of swallowing it, so resolution can surface it as an
 * actionable error rather than a generic "not found" once nothing else
 * accounts for the company either.
 */
export class BoardShapeError extends Error {
  constructor(
    public scraperName: string,
    public companySlug: string,
    message: string
  ) {
    super(`${scraperName} fallback for '${companySlug}': ${message}`);
    this.name = 'BoardShapeError';
  }
}

export abstract class Scraper {
  /**
   * Whether this scraper backs a multi-tenant job board whose slugs can be
   * guessed from a company name. Single-company scrapers, and boards whose
   * slug can't be derived (e.g. Workday), leave this false so that company
   * resolution never probes them.
   */
  static readonly discoverable: boolean = false;
  /**
   * Hostnames this board serves. Used to build `site:`-scoped web searches
   * when a company can't be found by guessing slugs. Leave empty for
   * single-company scrapers; there's nothing to search for.
   */
  static readonly boardDomains: readonly string[] = [];
  /**
   * Query params this board tags its outbound links with. When a company
   * embeds the board on its own site, these often survive in the URL
   * (`?gh_jid=` for Greenhouse) and are the one clue a bespoke careers domain
   * gives about which board is behind it.
   */
  static readonly urlHintParams: readonly string[] = [];

  /**
   * Board slugs worth trying for a company name, most likely first. Boards
   * generally slugify the company name one of a couple of ways, so the
   * default covers both; override when a board has its own convention.
   */
  static slugCandidates(companyName: string): string[] {
    const words = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);

    if (words.length === 0) return [];
    return [...new Set([words.join(''), words.join('-')])];
  }

  /**
   * Extracts the board slug (and job id, if present) from a careers or job
   * posting URL. Returns null when the URL isn't served by this scraper.
   */
  static parseUrl(url: URL): ParsedUrl | null {
    void url;
    return null;
  }

  constructor(protected companySlug: string) {}

  // allows `using scraper = new Scraper(slug)`
  [Symbol.dispose]() {}

  /**
   * Gets the full list of jobs. When `testing` is true, scrapers fetch as
   * little as they can get away with (typically a single page), but a page,
   * not a single job, since discovery judges a board by how many it returns.
   */
  abstract getJobsList(testing?: boolean): Promise<ListedJob[]>;

  /**
   * Gets a full job from the id. May be plaintext, markdown,
   * or a stringified JSON object
   */
  abstract getJobContent(id: string): Promise<string>;

  /** The public posting URL for a job id, when it can be built from the id alone */
  jobUrl(id: string): string | null {
    void id;
    return null;
  }

  /**
   * Looks a job up in a cache that `getJobsList` fills. Some boards only
   * hand over full postings through their list endpoint, so the list is
   * fetched on demand when the cache is cold; callers shouldn't have to
   * know which scrapers work that way.
   */
  protected async fromJobsList<T>(cache: Map<string, T>, id: string) {
    if (cache.size === 0) await this.getJobsList();

    const job = cache.get(id);
    if (!job) throw new JobNotFoundError(id, this.companySlug);
    return job;
  }

  /**
   * Whether this scraper's board actually serves the slug it was constructed
   * with, and has at least `minJobs` real postings on it. Boards answer
   * unknown slugs with an error or an unusable payload, both of which make
   * the listing request throw. But a board existing isn't the same as a
   * company using it: a trial account left behind holds a lone "Test UAT"
   * posting, so placeholders don't count toward `minJobs`.
   */
  async hasCompanyBoard(minJobs = 1): Promise<boolean> {
    try {
      const jobs = await this.getJobsList(true);
      if (!Array.isArray(jobs)) return false;
      return jobs.filter((job) => !isPlaceholderJob(job)).length >= minJobs;
    } catch (err) {
      // a fallback's page-shape mismatch is a signal worth surfacing, not a
      // plain "this slug doesn't exist" miss; let it propagate
      if (err instanceof BoardShapeError) throw err;
      return false;
    }
  }

  /**
   * Gets a single job with its listing fields. Scrapers that hydrate an
   * internal cache from the jobs list get one retry after listing.
   */
  async getJob(id: string): Promise<Job> {
    const content = await this.getJobContent(id);
    // most scrapers return the board's own JSON, which already carries the
    // listing fields
    const fields = readListingFields(content);

    return {
      id,
      title: fields?.title ?? '',
      location: fields?.location ?? '',
      url: fields?.url ?? this.jobUrl(id) ?? '',
      content,
    };
  }

  async _test(t?: TestContext) {
    // allow to be called manually or as part of a node test run
    const assert: typeof builtinAssert = (t?.assert ??
      builtinAssert) as typeof builtinAssert;
    const jobs = await this.getJobsList(true);

    const firstJob = jobs[0];
    assert.ok(isListedJob(firstJob));

    const content = await this.getJobContent(firstJob.id);
    assert.ok(typeof content === 'string', 'Job content is a string');
    assert.ok(content.length > 0, 'Job content is not empty');

    // a per-job fetch commonly drops fields the listing had (location is the
    // usual casualty); catch that here rather than downstream, since
    // `getJobContent` alone can't tell the difference
    const job = await this.getJob(firstJob.id);
    assert.ok(isListedJob(job));
  }
}

/**
 * The shape every concrete scraper has: constructible with a board slug,
 * plus the statics that company and URL resolution rely on.
 */
export interface ScraperSubclass {
  new (companySlug: string): Scraper;
  readonly name: string;
  readonly discoverable: boolean;
  readonly boardDomains: readonly string[];
  readonly urlHintParams: readonly string[];
  slugCandidates(companyName: string): string[];
  parseUrl(url: URL): ParsedUrl | null;
}

const listedJobType = {
  title: 'Software Engineer',
  location: 'United States',
  id: '00000',
  url: 'https://foo.com/bar',
};

function isListedJob(job: { [key: string]: any }): boolean {
  const missingKeys: string[] = [];
  const typeMisMatches: string[] = [];
  const emptyValues: string[] = [];
  for (const [key, value] of Object.entries(listedJobType)) {
    if (!job.hasOwnProperty(key)) {
      missingKeys.push(key);
      continue;
    }

    const actualValue = job[key];
    const expectedType = typeof value;
    const actualType = typeof actualValue;
    if (actualType !== expectedType) {
      typeMisMatches.push(
        `'${key}': '${actualType}' expected to be '${expectedType}'`
      );
      continue;
    }

    if (expectedType === 'string' && actualValue.length === 0) {
      emptyValues.push(key);
      continue;
    }
  }

  const errorLines: string[] = [];
  if (missingKeys.length > 0) {
    errorLines.push(`Missing keys: ${missingKeys.join(', ')}`);
  }
  if (typeMisMatches.length > 0) {
    errorLines.push(`Incorrect value types: ${typeMisMatches.join(', ')}`);
  }
  if (emptyValues.length > 0) {
    errorLines.push(`Empty values: ${emptyValues.join(', ')}`);
  }

  if (errorLines.length > 0) {
    throw new Error(
      `Job validation errors:\n` + errorLines.map((l) => '  - ' + l).join('\n')
    );
  }

  return true;
}

// words that mark a posting as a board's trial or QA data, and filler that
// accompanies them ("Test Job - Do Not Apply")
const PLACEHOLDER_MARKERS = new Set([
  'test',
  'testing',
  'uat',
  'dummy',
  'sample',
  'demo',
  'placeholder',
  'ignore',
]);
const PLACEHOLDER_FILLER = new Set([
  'do',
  'not',
  'apply',
  'please',
  'job',
  'posting',
  'position',
  'role',
  'req',
  'requisition',
  'only',
  'internal',
]);
// standing postings that collect resumes rather than hire for a role
const OPEN_APPLICATION =
  /\b(?:talent (?:community|pool|network)|general (?:application|interest)|open application)\b/i;

/**
 * Whether a posting stands in for a job rather than being one. The title has
 * to consist of placeholder words entirely, so "Test Engineer" still counts.
 */
function isPlaceholderJob(job: ListedJob): boolean {
  const title = typeof job?.title === 'string' ? job.title : '';
  if (OPEN_APPLICATION.test(title)) return true;

  const words = title.toLowerCase().match(/[a-z]+/g) ?? [];
  return (
    words.some((word) => PLACEHOLDER_MARKERS.has(word)) &&
    words.every(
      (word) => PLACEHOLDER_MARKERS.has(word) || PLACEHOLDER_FILLER.has(word)
    )
  );
}

/** Pulls listing fields out of a stringified JSON job payload, if that's what it is */
function readListingFields(content: string): Partial<ListedJob> | null {
  if (!content.startsWith('{')) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }

  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'string' && value) return value;
      // some boards nest the location as `{ name: 'Remote' }`
      if (value && typeof value === 'object') {
        const nested = (value as Record<string, unknown>).name;
        if (typeof nested === 'string' && nested) return nested;
      }
    }
    return undefined;
  };

  return {
    title: pick('title', 'name', 'text'),
    location: pick('location', 'locationsText', 'full_location'),
    url: pick('absolute_url', 'jobUrl', 'hostedUrl', 'apply_url'),
  };
}
