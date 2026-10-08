import { afterAll, beforeEach, test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// `paths.ts` reads this at import time, so it precedes the dynamic import
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-scraper-cache-'));
process.env.JOB_SCRAPER_DATA_DIR = tmpDir;
delete process.env.JOB_SCRAPER_CACHE;
delete process.env.JOB_SCRAPER_CACHE_TTL;

const { cachedFetch, clearCache, configureCache, CorsError, getCacheConfig } =
  await import('../cache.ts');
const { time } = await import('../utils.ts');

const realFetch = globalThis.fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  configureCache({ enabled: true, ttl: null, dir: path.join(tmpDir, 'cache') });
});

/** Stubs the network with a counter, so cache hits are observable */
function stubFetch(body = 'hello') {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls++;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return state;
}

test('a repeat request is served from disk', async () => {
  const net = stubFetch();
  const url = 'https://example.com/a';

  await cachedFetch(url);
  await cachedFetch(url);

  assert.equal(net.calls, 1);
});

test('disabling the cache always hits the network', async () => {
  const net = stubFetch();
  configureCache({ enabled: false });
  const url = 'https://example.com/b';

  await cachedFetch(url);
  await cachedFetch(url);

  assert.equal(net.calls, 2);
});

test('config can disable caching but never force it on', async () => {
  const net = stubFetch();
  configureCache({ enabled: true });
  const url = 'https://example.com/c';

  // the caller opted out; config saying `enabled` must not override that
  await cachedFetch.call({ cache: false }, url);
  await cachedFetch.call({ cache: false }, url);

  assert.equal(net.calls, 2);
});

test('a configured TTL overrides the one a scraper asked for', async () => {
  const net = stubFetch();
  const url = 'https://example.com/d';

  // scraper asks for a day; config says everything expires immediately
  configureCache({ ttl: 0 });
  await cachedFetch.call({ cacheTTL: time.day }, url);
  await cachedFetch.call({ cacheTTL: time.day }, url);

  assert.equal(net.calls, 2);

  // without the override, the scraper's TTL stands
  configureCache({ ttl: null });
  const fresh = stubFetch();
  const other = 'https://example.com/e';
  await cachedFetch.call({ cacheTTL: time.day }, other);
  await cachedFetch.call({ cacheTTL: time.day }, other);

  assert.equal(fresh.calls, 1);
});

test('failed responses are neither cached nor returned as content', async () => {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls++;
    return new Response('{"error":"Job not found"}', {
      status: 404,
      statusText: 'Not Found',
    });
  }) as unknown as typeof fetch;

  await assert.rejects(() => cachedFetch('https://example.com/missing'));
  await assert.rejects(() => cachedFetch('https://example.com/missing'));

  // a 404 body must never become a cache entry a later call would trust
  assert.equal(state.calls, 2);
});

test('clearCache empties the cache dir', async () => {
  stubFetch();
  await clearCache();
  await cachedFetch('https://example.com/f');
  await cachedFetch('https://example.com/g');

  assert.equal(await clearCache(), 2);
  assert.equal(await clearCache(), 0);
});

test('the environment configures the cache too', async () => {
  process.env.JOB_SCRAPER_CACHE = 'off';

  // an explicit override still wins over the environment...
  configureCache({ enabled: true });
  assert.equal(getCacheConfig().enabled, true);

  // ...until it's dropped, and the env shows through again
  configureCache({ enabled: undefined });
  assert.equal(getCacheConfig().enabled, false);

  delete process.env.JOB_SCRAPER_CACHE;
  process.env.JOB_SCRAPER_CACHE_TTL = String(time.hour);
  configureCache({ ttl: undefined });
  assert.equal(getCacheConfig().ttl, time.hour);
  delete process.env.JOB_SCRAPER_CACHE_TTL;
});

test('Node never reports a network failure as a CorsError', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => cachedFetch('https://example.com/offline'),
    (err) => err instanceof TypeError && !(err instanceof CorsError)
  );
});
