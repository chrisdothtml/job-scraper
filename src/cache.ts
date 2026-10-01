import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { cacheDir as defaultCacheDir, ensureDir } from './paths.ts';
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

export interface CacheConfig {
  /**
   * Turns disk caching off entirely. Scrapers that opt out per-call (during
   * tests, say) stay opted out regardless: this can disable caching, never
   * force it on.
   */
  enabled: boolean;
  /**
   * How long a cached response stays fresh, in milliseconds. Overrides the
   * TTL each scraper picks for itself; leave it unset to keep those.
   */
  ttl: number | null;
  /** Where response bodies are written. Defaults to `.data/cache` */
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
 * environment (`JOB_SCRAPER_CACHE`, `JOB_SCRAPER_CACHE_TTL`), then defaults.
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
  const env = process.env;
  const ttl = Number(env.JOB_SCRAPER_CACHE_TTL);
  const disabled = /^(0|false|off|no)$/i.test(env.JOB_SCRAPER_CACHE ?? '');

  return {
    ...CACHE_DEFAULTS,
    ...(disabled ? { enabled: false } : {}),
    ...(Number.isFinite(ttl) && ttl >= 0 ? { ttl } : {}),
    ...overrides,
  };
}

/** Deletes every cached response. Returns how many were removed */
export async function clearCache(): Promise<number> {
  const dir = getCacheConfig().dir;

  try {
    const files = await fs.readdir(dir);
    const cached = files.filter((file) => file.endsWith('.json'));
    await Promise.all(cached.map((file) => fs.rm(path.join(dir, file))));
    return cached.length;
  } catch {
    return 0;
  }
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

  if (!cache) return assertOk(await fetch(...args), args);

  const key = crypto
    .createHash('sha256')
    .update(serializeArgs(args))
    .digest('hex');
  const cacheFilePath = path.join(await ensureDir(config.dir), key + '.json');

  try {
    const { mtimeMs } = await fs.stat(cacheFilePath);
    // `mtimeMs` carries sub-millisecond precision that `Date.now()` truncates,
    // so a just-written entry can read as slightly negative age; clamping
    // keeps `ttl: 0` meaning "always stale" rather than "always fresh"
    const age = Math.max(0, Date.now() - mtimeMs);
    if (age >= ttl) throw new Error('expired');

    const cached = JSON.parse(await fs.readFile(cacheFilePath, 'utf8'));

    return new Response(Buffer.from(cached.body, 'base64'), {
      status: cached.status,
      statusText: cached.statusText,
      headers: cached.headers,
    });
  } catch {}

  const res = await fetch(...args);
  const buf = Buffer.from(await res.arrayBuffer());

  if (res.ok) {
    const payload = {
      status: res.status,
      statusText: res.statusText,
      headers: Array.from(res.headers.entries()),
      body: buf.toString('base64'),
    };

    await fs.writeFile(cacheFilePath, JSON.stringify(payload));
  }

  return assertOk(
    new Response(buf, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    }),
    args
  );
}

/**
 * Boards signal a missing board or posting with a status code and an error
 * body that would otherwise be handed back as if it were job content, so a
 * failed response has to become an exception here rather than downstream.
 */
function assertOk(res: Response, args: Parameters<Fetch>): Response {
  if (!res.ok) {
    const [input] = args;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    throw new HttpError(res.status, res.statusText, url);
  }
  return res;
}
