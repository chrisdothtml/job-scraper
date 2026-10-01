import { type Platform, type ResponseCache } from './types.ts';

// just the slices of the DOM's Storage and Cache APIs used here, so the
// package doesn't need the DOM lib to typecheck
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  keys(): Promise<readonly unknown[]>;
}

interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
}

const scope = globalThis as {
  localStorage?: StorageLike;
  caches?: CacheStorageLike;
};

// in browsers the "paths" are a key prefix rather than a directory: the
// cache dir names the Cache API cache, and files are `localStorage` keys
const dataDir = 'job-scraper';

// what's been written this session. Reads prefer it, so state survives a
// `localStorage` that's missing, blocked, or full, just not a reload
const memory = new Map<string, string>();

// stamped on every stored response, since the Cache API keeps no write time
const CACHED_AT = 'x-job-scraper-cached-at';

// Cache API keys must be http(s) requests; a reserved TLD guarantees it
// never collides with a real one
function cacheKey(key: string): string {
  return `https://job-scraper.invalid/?${encodeURIComponent(key)}`;
}

const responseCache: ResponseCache = {
  async get(dir, key, ttl) {
    if (!scope.caches) return null;

    try {
      const cache = await scope.caches.open(dir);
      const hit = await cache.match(cacheKey(key));
      if (!hit) return null;

      // a missing stamp reads as NaN, which fails the check: treat as stale
      const age = Math.max(0, Date.now() - Number(hit.headers.get(CACHED_AT)));
      if (!(age < ttl)) return null;

      const headers = new Headers(hit.headers);
      headers.delete(CACHED_AT);
      return new Response(await hit.arrayBuffer(), {
        status: hit.status,
        statusText: hit.statusText,
        headers,
      });
    } catch {
      return null;
    }
  },

  async put(dir, key, { body, status, statusText, headers }) {
    if (!scope.caches) return;

    try {
      const cache = await scope.caches.open(dir);
      const stamped = new Headers(headers);
      stamped.set(CACHED_AT, String(Date.now()));
      await cache.put(
        cacheKey(key),
        new Response(body, { status, statusText, headers: stamped })
      );
    } catch {
      // a full or unavailable cache just means the next request refetches
    }
  },

  async clear(dir) {
    if (!scope.caches) return 0;

    try {
      const cache = await scope.caches.open(dir);
      const count = (await cache.keys()).length;
      await scope.caches.delete(dir);
      return count;
    } catch {
      return 0;
    }
  },
};

export const platform: Platform = {
  enforcesCors: true,
  // there's no environment to read; configure via `configureCache` and co.
  env: () => undefined,
  dataDir,
  cacheDir: `${dataDir}/cache`,
  companiesFile: `${dataDir}/companies.json`,
  dataFile: (name) => `${dataDir}/${name}`,

  async readText(file) {
    if (memory.has(file)) return memory.get(file)!;

    try {
      return scope.localStorage?.getItem(file) ?? null;
    } catch {
      return null;
    }
  },

  async writeText(file, contents) {
    memory.set(file, contents);

    try {
      scope.localStorage?.setItem(file, contents);
    } catch {
      // blocked or over quota; the in-memory copy carries this session
    }
  },

  responseCache,
  // only reached from unbuilt sources, which have no baked-in version
  sourceVersion: () => '0.0.0-source',
};
