import { platform } from '#platform';
import { corsAwareFetch } from '../cache.ts';
import {
  normalizeCompanyName,
  slugMatchesCompany,
} from '../companies/registry.ts';
import { scraperNames, scrapers, type ScraperName } from '../scrapers/index.ts';
import { type ParsedUrl } from '../scrapers/Scraper.ts';
import { applyOverrides, time } from '../utils/misc.ts';

export interface SearchConfig {
  /**
   * SerpApi key. Defaults to `SERP_API_TOKEN` in the environment, then
   * `SERPAPI_KEY` / `SERPAPI_API_KEY`. Browsers have no environment, so
   * there search stays off until a key is passed to `configureSearch`.
   */
  apiKey: string | null;
  /**
   * Most searches to spend per `period`. SerpApi's free tier is 250 searches
   * a month, which is the default; check your own dashboard, since the
   * allowance changes. Set `period: 'day'` if your plan is metered daily.
   */
  limit: number;
  period: 'day' | 'month';
  /** Results to ask for per search */
  resultCount: number;
  /**
   * How long a search result, including a fruitless one, is reused before
   * the company is worth spending another search on. Companies change job
   * boards rarely, and this is the difference between paying once per
   * company and paying once per lookup.
   */
  resultTtl: number;
  /**
   * Companies per query when searching in bulk. Names are OR'd together and
   * results attributed back by slug, so this many companies cost one search.
   */
  batchSize: number;
  /**
   * Whether `resolveHomepage` searches by default. Off unless asked for, via
   * this or `SERPAPI_HOMEPAGE_SEARCH=1`: a homepage search costs one search
   * per company the free sources can't settle. Worth it when lookups are
   * rare enough that the quota doesn't matter. `resolveHomepage`'s own
   * `search` option overrides this per call.
   */
  homepages: boolean;
}

const DEFAULTS: SearchConfig = {
  apiKey: null,
  limit: 250,
  period: 'month',
  resultCount: 10,
  resultTtl: 30 * time.day,
  batchSize: 5,
  homepages: false,
};

let overrides: Partial<SearchConfig> = {};

/**
 * Overrides the search settings for this process. Anything left out keeps
 * falling back to the environment, then to the defaults above. Passing
 * `undefined` for a key drops the override, restoring that fallback.
 *
 * @example
 * configureSearch({ apiKey: 'abc123', limit: 5, period: 'day' });
 */
export function configureSearch(config: Partial<SearchConfig>): void {
  overrides = applyOverrides(overrides, config);
}

export function getSearchConfig(): SearchConfig {
  const { env } = platform;
  const limit = Number(env('SERPAPI_SEARCH_LIMIT'));
  const period = env('SERPAPI_SEARCH_PERIOD');

  return {
    ...DEFAULTS,
    apiKey:
      env('SERP_API_TOKEN') ||
      env('SERPAPI_KEY') ||
      env('SERPAPI_API_KEY') ||
      DEFAULTS.apiKey,
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    ...(period === 'day' || period === 'month' ? { period } : {}),
    ...(/^(1|true|on|yes)$/i.test(env('SERPAPI_HOMEPAGE_SEARCH') ?? '')
      ? { homepages: true }
      : {}),
    ...overrides,
  };
}

/** Whether a web search is configured and has quota left */
export async function canSearch(): Promise<boolean> {
  const config = getSearchConfig();
  if (!config.apiKey) return false;
  return (await readUsage(config)).count < config.limit;
}

export interface SearchedBoard extends ParsedUrl {
  scraper: ScraperName;
  /** The search result this came from */
  url: string;
}

/**
 * Asks a web search which job board a company posts on, by scoping the query
 * to the domains our scrapers serve. This is the fallback for companies
 * whose board slug can't be guessed from their name, and the only way to
 * find a Workday tenant, since those slugs aren't derivable at all.
 *
 * Returns an empty array when search isn't configured, is out of quota, or
 * turns up nothing. It never throws for those reasons; callers treat search
 * as an optional accelerator.
 */
export async function searchForBoards(
  companyName: string
): Promise<SearchedBoard[]> {
  const [result] = await searchForBoardsBatch([companyName]);
  return result?.boards ?? [];
}

export interface BatchedSearch {
  companyName: string;
  boards: SearchedBoard[];
}

/**
 * Looks up several companies at once. Their names are OR'd into a single
 * query and the results attributed back by slug, so `batchSize` companies
 * cost one search instead of one each.
 *
 * Anything already cached is answered without a query, and only the
 * remainder is batched, so re-running a large list is nearly free.
 */
export async function searchForBoardsBatch(
  companyNames: string[]
): Promise<BatchedSearch[]> {
  const config = getSearchConfig();
  const results = new Map<string, SearchedBoard[]>();
  const pending: string[] = [];

  const cached = await readResults();
  for (const companyName of companyNames) {
    const record = cached[normalizeCompanyName(companyName)];
    // a remembered result stands in for a search, empty or not
    if (record && Date.now() - record.ts < config.resultTtl) {
      results.set(companyName, record.boards);
    } else {
      pending.push(companyName);
    }
  }

  if (pending.length > 0 && config.apiKey) {
    for (let i = 0; i < pending.length; i += config.batchSize) {
      const chunk = pending.slice(i, i + config.batchSize);
      const found = await runSearch(chunk, config);
      if (!found) break; // out of quota; leave the rest unsearched

      for (const [companyName, boards] of found)
        results.set(companyName, boards);
    }
  }

  return companyNames.map((companyName) => ({
    companyName,
    boards: results.get(companyName) ?? [],
  }));
}

// concurrent resolutions of the same company must not each spend a search
const inFlight = new Map<
  string,
  Promise<Map<string, SearchedBoard[]> | null>
>();

/**
 * Runs one query for a chunk of companies, and remembers the outcome for
 * each, including the ones nothing was found for.
 */
function runSearch(
  chunk: string[],
  config: SearchConfig
): Promise<Map<string, SearchedBoard[]> | null> {
  const key = chunk.map(normalizeCompanyName).sort().join('|');

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const domains = scraperNames
      .flatMap((name) => [...scrapers[name].boardDomains])
      .map((domain) => `site:${domain}`)
      .join(' OR ');
    const names = chunk.map((name) => `"${name}"`).join(' OR ');

    const query =
      chunk.length > 1 ? `(${names}) (${domains})` : `${names} (${domains})`;
    // one query covering several companies needs room for all of them
    const links = await querySearch(
      query,
      chunk.length > 1 ? 100 : config.resultCount,
      config
    );
    if (!links) return null;

    const found = new Map<string, SearchedBoard[]>(
      chunk.map((companyName) => [companyName, []])
    );

    for (const link of links) {
      const parsed = parseResult(link);
      if (!parsed) continue;

      // attribute the result to whichever company the slug resembles; a
      // search for a widely name-dropped company returns other companies'
      // boards, and those must not be attributed to anyone
      const owner = chunk.find((companyName) =>
        slugMatchesCompany(parsed.slug, companyName)
      );
      if (!owner) continue;

      const boards = found.get(owner)!;
      if (!boards.some((board) => board.slug === parsed.slug)) {
        boards.push(parsed);
      }
    }

    await rememberResults(found);
    return found;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

/**
 * Runs one web search and returns the result links, best first. Null when
 * search isn't configured, is out of quota, or the request failed; search is
 * always optional, so none of those throw.
 */
async function querySearch(
  query: string,
  resultCount: number,
  config: SearchConfig
): Promise<string[] | null> {
  if (!config.apiKey) return null;

  const usage = await readUsage(config);
  if (usage.count >= config.limit) return null;

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(resultCount));
  url.searchParams.set('api_key', config.apiKey);

  try {
    // counted before the response lands: a search that errors after being
    // dispatched still spends quota
    await writeUsage({ ...usage, count: usage.count + 1 });

    const res = await corsAwareFetch(url);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      organic_results?: { link?: string }[];
    };
    return (data.organic_results ?? [])
      .map(({ link }) => link)
      .filter((link): link is string => Boolean(link));
  } catch {
    return null;
  }
}

/**
 * Asks a web search for a company's own website. Returns the result links,
 * best first, for the caller to verify; an empty array when search isn't
 * configured or out of quota. Unlike board searches these aren't
 * remembered, since `resolveHomepage` records its own outcome.
 */
export async function searchForHomepage(
  companyName: string
): Promise<string[]> {
  const config = getSearchConfig();
  return (
    (await querySearch(
      `"${companyName}" official website`,
      config.resultCount,
      config
    )) ?? []
  );
}

function parseResult(link: string): SearchedBoard | null {
  const url = URL.parse(link);
  if (!url) return null;

  for (const scraper of scraperNames) {
    if (scrapers[scraper].boardDomains.length === 0) continue;

    const parsed = scrapers[scraper].parseUrl(url);
    if (parsed) return { ...parsed, scraper, url: link };
  }

  return null;
}

interface SearchRecord {
  boards: SearchedBoard[];
  /** When the search ran */
  ts: number;
}

const resultsFile = platform.dataFile('search-results.json');

/** Everything previously searched for, keyed by normalized company name */
async function readResults(): Promise<Record<string, SearchRecord>> {
  try {
    return JSON.parse((await platform.readText(resultsFile)) ?? '{}');
  } catch {
    return {};
  }
}

async function rememberResults(
  found: Map<string, SearchedBoard[]>
): Promise<void> {
  const results = await readResults();
  const ts = Date.now();

  for (const [companyName, boards] of found) {
    // recorded even when empty: knowing a company turned up nothing is
    // exactly what stops the next lookup spending another search
    results[normalizeCompanyName(companyName)] = { boards, ts };
  }

  await platform.writeText(
    resultsFile,
    JSON.stringify(results, null, 2) + '\n'
  );
}

/** Forgets remembered search results. Returns how many companies were dropped */
export async function clearSearchCache(): Promise<number> {
  const results = await readResults();
  const count = Object.keys(results).length;

  inFlight.clear();
  await platform.writeText(resultsFile, '{}\n');
  return count;
}

interface Usage {
  /** The period this count belongs to, e.g. `2026-09` or `2026-09-10` */
  period: string;
  count: number;
}

const usageFile = platform.dataFile('search-usage.json');

function currentPeriod(config: SearchConfig): string {
  const date = new Date().toISOString().slice(0, 10);
  return config.period === 'day' ? date : date.slice(0, 7);
}

async function readUsage(config: SearchConfig): Promise<Usage> {
  const period = currentPeriod(config);

  try {
    const usage = JSON.parse(
      (await platform.readText(usageFile)) ?? ''
    ) as Usage;
    // a new period starts the count over
    if (usage.period === period) return usage;
  } catch {}

  return { period, count: 0 };
}

async function writeUsage(usage: Usage): Promise<void> {
  await platform.writeText(usageFile, JSON.stringify(usage, null, 2) + '\n');
}
