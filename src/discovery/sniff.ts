import { cachedFetch, CorsError } from '../cache.ts';
import { scraperNames, scrapers, type ScraperName } from '../scrapers/index.ts';
import { type ParsedUrl } from '../scrapers/Scraper.ts';
import { time } from '../utils/misc.ts';

export interface SniffedBoard extends ParsedUrl {
  scraper: ScraperName;
  /** How many times the page pointed at this board */
  hits: number;
}

/** Sent where a site would otherwise serve a stub to non-browser agents */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// URLs as they appear in markup: script/link hrefs, iframe srcs, inline JS
const URL_PATTERN = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>()\\]*)?/gi;

// a page can mention a board it doesn't use (a careers blog linking a job at
// another company, say), so cap how much of it we're willing to believe
const MAX_HTML = 2_000_000;

/**
 * Finds the job boards a page points at, by running every URL in its markup
 * through the scrapers' own URL parsing. Ordered by how often the page
 * referenced each board, so an embedded board outranks a stray mention.
 *
 * This is what makes a company's own careers page usable as input: the page
 * itself is bespoke, but the board it embeds leaves its slug in the markup.
 */
export function findBoardsInPage(html: string): SniffedBoard[] {
  const found = new Map<string, SniffedBoard>();

  for (const match of html.slice(0, MAX_HTML).matchAll(URL_PATTERN)) {
    const url = URL.parse(match[0]);
    if (!url) continue;

    for (const scraper of scraperNames) {
      // only boards that serve many companies can be identified this way;
      // a single-company scraper would match its own marketing links
      if (scrapers[scraper].boardDomains.length === 0) continue;

      const parsed = scrapers[scraper].parseUrl(url);
      if (!parsed) continue;

      const key = `${scraper}:${parsed.slug}`;
      const existing = found.get(key);
      if (existing) {
        existing.hits++;
        // a reference that carries a job id is more useful than one without
        existing.jobId ??= parsed.jobId;
      } else {
        found.set(key, { ...parsed, scraper, hits: 1 });
      }
      break;
    }
  }

  return [...found.values()].sort((a, b) => b.hits - a.hits);
}

// how a page names the company running it, in descending order of trust.
// `og:site_name` and JSON-LD are written for machines; `<title>` is written
// for people and usually carries the job title too
const NAME_PATTERNS: RegExp[] = [
  /<meta[^>]+(?:property|name)=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:site_name["']/i,
  /"hiringOrganization"\s*:\s*\{[^{}]*"name"\s*:\s*"((?:[^"\\]|\\.)+)"/i,
  /<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i,
];

// trailing words a careers site appends to its own name
const SITE_SUFFIX =
  /[\s|\u2013\u2014·-]*\b(careers?|jobs?|job board|hiring|talent|work(?:place)?|life at)\b[\s|\u2013\u2014·-]*$/i;

/**
 * Reads the company a page belongs to out of its markup. Returns the
 * candidates it found, best first, along with a careers-suffix-stripped form
 * of each ("Pinterest Careers" also yields "Pinterest").
 */
export function findNamesInPage(html: string): string[] {
  const names: string[] = [];

  for (const pattern of NAME_PATTERNS) {
    const value = pattern.exec(html.slice(0, MAX_HTML))?.[1];
    if (!value) continue;

    const name = decodeEntities(value).trim();
    if (!name || name.length > 80) continue;

    names.push(name);
    const stripped = name.replace(SITE_SUFFIX, '').trim();
    if (stripped && stripped !== name) names.push(stripped);
  }

  return [...new Set(names)];
}

export interface SniffedPage {
  /** Boards the page points at, most-referenced first */
  boards: SniffedBoard[];
  /** Company names the page claims for itself, most trustworthy first */
  names: string[];
  /**
   * Whether the browser refused to fetch the page (see `CorsError`), in
   * which case the empty results say nothing about the page itself
   */
  blocked: boolean;
}

/**
 * Fetches a careers page and reports both the boards it embeds and the
 * company it names itself after. Returns empty results when the page can't
 * be fetched: plenty of careers sites sit behind a bot challenge, so
 * sniffing is strictly a best-effort step.
 */
export async function sniffPage(url: string): Promise<SniffedPage> {
  try {
    const res = await cachedFetch.call({ cacheTTL: time.day }, url, {
      headers: {
        // some careers sites serve a stub to non-browser agents
        'User-Agent': BROWSER_USER_AGENT,
      },
    });

    const html = await res.text();
    return {
      boards: findBoardsInPage(html),
      names: findNamesInPage(html),
      blocked: false,
    };
  } catch (err) {
    return { boards: [], names: [], blocked: err instanceof CorsError };
  }
}

/** Fetches a careers page and reports the boards it embeds */
export async function sniffBoards(url: string): Promise<SniffedBoard[]> {
  return (await sniffPage(url)).boards;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match;
    const point = Number(
      code[1] === 'x' || code[1] === 'X' ? `0${code.slice(1)}` : code.slice(1)
    );
    return Number.isFinite(point) ? String.fromCodePoint(point) : match;
  });
}
