import { platform } from '#platform';
import { cacheDir as defaultCacheDir } from './paths.ts';
import { applyOverrides, time } from './utils/misc.ts';

function serializeArgs(args: Parameters<Fetch>): string {
  const [url, init] = args;
  return JSON.stringify({
    url,
    init: init && {
      ...init,
      headers: init.headers
        ? Array.from(new Headers(init.headers).entries())
        : undefined,
    },
  });
}

/** Thrown when a board answers with a non-2xx status */
export class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public url: string
  ) {
    super(`${status} ${statusText} — ${url}`);
    this.name = 'HttpError';
  }
}

/**
 * Thrown in browsers when a request fails before any response arrives, which
 * is what a board refusing cross-origin requests looks like to page script
 * (a plain network failure looks identical). Never thrown under Node, which
 * doesn't enforce CORS.
 */
export class CorsError extends Error {
  constructor(
    public url: string,
    options?: ErrorOptions
  ) {
    super(
      `Request to ${url} was blocked, most likely by its CORS policy. ` +
        `It should work from Node, which doesn't enforce CORS`,
      options
    );
    this.name = 'CorsError';
  }
}

export interface CacheConfig {
  /**
   * Turns response caching off entirely. Scrapers that opt out per-call (during
   * tests, say) stay opted out regardless: this can disable caching, never
   * force it on.
   */
  enabled: boolean;
  /**
   * How long a cached response stays fresh, in milliseconds. Overrides the
   * TTL each scraper picks for itself; leave it unset to keep those.
   */
  ttl: number | null;
  /**
   * Where response bodies are written. Defaults to `~/.job-scraper/cache`.
   * In browsers, this names the Cache API cache instead
   */
  dir: string;
}

const CACHE_DEFAULTS: CacheConfig = {
  enabled: true,
  ttl: null,
  dir: defaultCacheDir,
};

let overrides: Partial<CacheConfig> = {};

/**
 * Overrides caching for this process. Anything left out falls back to the
 * environment (`JOB_SCRAPER_CACHE`, `JOB_SCRAPER_CACHE_TTL`; Node only), then
 * defaults.
 * Passing `undefined` for a key drops the override, restoring that fallback.
 *
 * @example
 * configureCache({ enabled: false });    // always hit the network
 * configureCache({ ttl: time.hour });    // fresher than the default day
 * configureCache({ ttl: undefined });    // back to whatever each scraper asks
 */
export function configureCache(config: Partial<CacheConfig>): void {
  overrides = applyOverrides(overrides, config);
}

export function getCacheConfig(): CacheConfig {
  const ttl = Number(platform.env('JOB_SCRAPER_CACHE_TTL'));
  const disabled = /^(0|false|off|no)$/i.test(
    platform.env('JOB_SCRAPER_CACHE') ?? ''
  );

  return {
    ...CACHE_DEFAULTS,
    ...(disabled ? { enabled: false } : {}),
    ...(Number.isFinite(ttl) && ttl >= 0 ? { ttl } : {}),
    ...overrides,
  };
}

/** Deletes every cached response. Returns how many were removed */
export async function clearCache(): Promise<number> {
  return platform.responseCache.clear(getCacheConfig().dir);
}

interface CacheContext {
  cache?: boolean;
  cacheTTL?: number;
}

type Fetch = typeof fetch;
// FIXME: implement rate limit header/status-code detection
export async function cachedFetch(
  this: CacheContext | void,
  ...args: Parameters<Fetch>
): ReturnType<Fetch> {
  const { cache: callerWantsCache = true, cacheTTL } = this ?? {};
  const config = getCacheConfig();

  // a caller that opted out stays opted out; config can only disable
  const cache = callerWantsCache && config.enabled;
  // an explicit config TTL wins over whatever the scraper asked for
  const ttl = config.ttl ?? cacheTTL ?? time.day;

  if (!cache) return assertOk(await corsAwareFetch(...args), args);

  const key = serializeArgs(args);
  const hit = await platform.responseCache.get(config.dir, key, ttl);
  if (hit) return hit;

  const res = await corsAwareFetch(...args);
  const body = await res.arrayBuffer();

  if (res.ok) {
    await platform.responseCache.put(config.dir, key, {
      status: res.status,
      statusText: res.statusText,
      headers: Array.from(res.headers.entries()),
      body,
    });
  }

  return assertOk(
    new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    }),
    args
  );
}

/**
 * `fetch`, except that in browsers a request that never got a response
 * becomes a `CorsError`. Everything that goes over the network should come
 * through here, so a blocked board is always told apart from a missing one.
 */
export async function corsAwareFetch(
  ...args: Parameters<Fetch>
): ReturnType<Fetch> {
  try {
    return await fetch(...args);
  } catch (err) {
    const url = requestUrl(args[0]);
    // an unparseable URL is a TypeError too, but a caller's bug, not a block
    if (
      platform.enforcesCors &&
      err instanceof TypeError &&
      URL.canParse(url)
    ) {
      throw new CorsError(url, { cause: err });
    }
    throw err;
  }
}

function requestUrl(input: Parameters<Fetch>[0]): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

/**
 * Boards signal a missing board or posting with a status code and an error
 * body that would otherwise be handed back as if it were job content, so a
 * failed response has to become an exception here rather than downstream.
 */
function assertOk(res: Response, args: Parameters<Fetch>): Response {
  if (!res.ok) {
    throw new HttpError(res.status, res.statusText, requestUrl(args[0]));
  }
  return res;
}
