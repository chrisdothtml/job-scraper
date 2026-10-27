import { platform } from '#platform';
import { cacheDir as defaultCacheDir } from './paths.ts';
import { applyOverrides, time } from './utils.ts';

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

/** Rate-limited retries a single request gets before its 429 is surfaced */
const MAX_RETRIES = 3;
/**
 * The longest a single request will wait out rate limiting, in total. A board
 * asking for longer than this won't recover in any useful time, so its 429
 * is surfaced instead.
 */
const MAX_RATE_LIMIT_WAIT = 30 * time.second;

/** When each rate-limited host may be hit again (epoch ms), keyed by host */
const hostResumeAt = new Map<string, number>();

/**
 * `fetch`, except that in browsers a request that never got a response
 * becomes a `CorsError`, and that rate limiting is waited out rather than
 * surfaced. Everything that goes over the network should come through here,
 * so a blocked board is always told apart from a missing one, and a
 * throttled host is paused for every caller, not just the one that hit it.
 */
export async function corsAwareFetch(
  ...args: Parameters<Fetch>
): ReturnType<Fetch> {
  const [input, init] = args;
  const url = requestUrl(input);
  const host = URL.canParse(url) ? new URL(url).host : url;
  const signal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  let waited = 0;

  for (let attempt = 0; ; attempt++) {
    const pause = (hostResumeAt.get(host) ?? 0) - Date.now();
    if (pause > 0) await sleep(pause, signal);

    // a Request's body can only be read once, so each attempt gets a copy
    const res = await networkFetch(
      (input instanceof Request ? input.clone() : input) as typeof input,
      init
    );
    const wait = rateLimitWait(res, attempt);
    if (wait === null) return res;

    const resumeAt = Date.now() + wait;
    if (res.ok) {
      // the quota is spent, but this response still counts
      hostResumeAt.set(host, Math.max(hostResumeAt.get(host) ?? 0, resumeAt));
      return res;
    }
    if (attempt >= MAX_RETRIES || waited + wait > MAX_RATE_LIMIT_WAIT) {
      return res;
    }

    hostResumeAt.set(host, Math.max(hostResumeAt.get(host) ?? 0, resumeAt));
    waited += wait;
    await res.body?.cancel();
  }
}

/**
 * How long to hold off before the next request to this response's host, or
 * null when it isn't rate limited. A 429 is always retried (backing off
 * exponentially when the board doesn't say for how long); a 503 only when it
 * says when to come back, since otherwise it's as likely an outage. A
 * successful response that reports its quota as spent pauses the host until
 * the quota resets.
 */
function rateLimitWait(res: Response, attempt: number): number | null {
  const told = readRateLimitDelay(res.headers);

  if (res.status === 429) {
    return told ?? time.second * 2 ** attempt * (1 + Math.random() / 4);
  }
  if (res.status === 503) return told;
  if (res.ok && quotaSpent(res.headers)) return told;
  return null;
}

/**
 * The delay a response asks for, in ms, from `Retry-After` or else from the
 * quota reset it reports (`RateLimit`, `RateLimit-Reset`, `X-RateLimit-Reset`).
 * In browsers, these are only readable when the board exposes them via CORS.
 */
function readRateLimitDelay(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter) {
    if (/^\d+$/.test(retryAfter)) return Number(retryAfter) * time.second;
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }

  // structured `RateLimit: "default";r=0;t=30` (IETF draft), `t` in seconds
  const structured = headers.get('ratelimit')?.match(/(?:^|;)\s*t=(\d+)/);
  if (structured) return Number(structured[1]) * time.second;

  const reset = Number(
    headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset') ?? NaN
  );
  if (!Number.isFinite(reset) || reset < 0) return null;
  // boards disagree on units: GitHub sends an epoch timestamp, most send
  // seconds from now
  if (reset > 1e12) return Math.max(0, reset - Date.now());
  if (reset > 1e9) return Math.max(0, reset * time.second - Date.now());
  return reset * time.second;
}

function quotaSpent(headers: Headers): boolean {
  const remaining =
    headers.get('ratelimit')?.match(/(?:^|;)\s*r=(\d+)/)?.[1] ??
    headers.get('ratelimit-remaining') ??
    headers.get('x-ratelimit-remaining');
  return remaining?.trim() === '0';
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** A single network round trip, translating a browser's CORS block */
async function networkFetch(...args: Parameters<Fetch>): ReturnType<Fetch> {
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
