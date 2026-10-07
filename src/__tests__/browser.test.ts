import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeEach, test } from 'bun:test';

/**
 * Runs the core against the browser platform, with in-memory stand-ins for
 * `localStorage` and the Cache API. Tests resolve `#platform` to the Node
 * implementation, so its exports are swapped for the browser's in place
 * before anything that reads them is imported.
 */

// nothing here should touch the disk, but if it did, it lands somewhere safe
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-scraper-browser-'));
process.env.JOB_SCRAPER_DATA_DIR = tmpDir;
process.env.SERPAPI_KEY = 'from-the-environment';
delete process.env.DISABLE_COMPANY_REGISTRY;

class MemoryStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

class MemoryCache {
  entries = new Map<string, Response>();
  async match(key: string) {
    return this.entries.get(key)?.clone();
  }
  async put(key: string, res: Response) {
    this.entries.set(key, res);
  }
  async keys() {
    return [...this.entries.keys()];
  }
}

class MemoryCacheStorage {
  caches = new Map<string, MemoryCache>();
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new MemoryCache());
    return this.caches.get(name)!;
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
}

const scope = globalThis as Record<string, unknown>;
const storage = new MemoryStorage();
scope.localStorage = storage;
scope.caches = new MemoryCacheStorage();

const { platform } = await import('../platform/node.ts');
const { platform: browser } = await import('../platform/browser.ts');
Object.defineProperties(platform, Object.getOwnPropertyDescriptors(browser));

const { cachedFetch, clearCache, configureCache, CorsError } =
  await import('../cache.ts');
const { clearCompaniesCache, findCompany, listCompanies, registerCompany } =
  await import('../companies.ts');
const { companiesFile } = await import('../paths.ts');
const { createScraper, resolveCompany, UnresolvedCompanyError } =
  await import('../resolve.ts');
const { canSearch, getSearchConfig } = await import('../search.ts');
const { seedCompanies } = await import('../companies.seed.ts');
const { time } = await import('../utils/misc.ts');

const realFetch = globalThis.fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  configureCache({ enabled: true, ttl: null, dir: undefined });
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

/**
 * Stubs the network so that Acme's SmartRecruiters board answers, hosts
 * matching `blocked` fail the way a CORS block does, and everything else 404s
 */
function stubBoards(blocked: RegExp | null) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (blocked?.test(url)) throw new TypeError('Failed to fetch');
    if (!url.startsWith('https://api.smartrecruiters.com/v1/companies/Acme/')) {
      return new Response('Not Found', { status: 404 });
    }

    const content = ['Engineer', 'Designer'].map((name, i) => ({
      id: String(i),
      name,
      location: { fullLocation: 'San Francisco, CA, United States' },
    }));
    return new Response(
      JSON.stringify({ offset: 0, limit: 100, totalFound: 2, content }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

test('the registry persists to localStorage, seed included', async () => {
  clearCompaniesCache();
  assert.equal((await listCompanies()).length, seedCompanies.length);

  await registerCompany({
    name: 'Zentrix',
    scraper: 'LeverScraper',
    slug: 'z',
  });
  const stored = JSON.parse(storage.getItem(companiesFile)!);
  assert.ok(stored.companies.some((c: any) => c.name === 'Zentrix'));
});

test('the registry carries on in memory when localStorage throws', async () => {
  scope.localStorage = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };

  try {
    await registerCompany({
      name: 'Quillo',
      scraper: 'LeverScraper',
      slug: 'q',
    });
    clearCompaniesCache();
    assert.equal((await findCompany('Quillo'))?.slug, 'q');
  } finally {
    scope.localStorage = storage;
  }
});

test("another tab's registry writes aren't shadowed by this one's", async () => {
  await registerCompany({ name: 'Ourtab', scraper: 'LeverScraper', slug: 'o' });

  // another tab discovers a company and saves the registry
  const stored = JSON.parse(storage.getItem(companiesFile)!);
  stored.companies.push({
    name: 'Othertab',
    scraper: 'LeverScraper',
    slug: 't',
    source: 'discovered',
  });
  storage.setItem(companiesFile, JSON.stringify(stored));

  clearCompaniesCache();
  assert.equal((await findCompany('Othertab'))?.slug, 't');
  assert.equal((await findCompany('Ourtab'))?.slug, 'o');
});

test('responses are cached in the Cache API, with the same TTL rules', async () => {
  const net = stubFetch();
  const url = 'https://example.com/a';

  await cachedFetch(url);
  const res = await cachedFetch(url);
  assert.equal(net.calls, 1);
  assert.equal(await res.text(), 'hello');
  // the write-time stamp is bookkeeping, not part of the response
  assert.equal(res.headers.get('x-job-scraper-cached-at'), null);

  configureCache({ ttl: 0 });
  await cachedFetch(url);
  assert.equal(net.calls, 2);

  configureCache({ ttl: time.day });
  assert.equal(await clearCache(), 1);
  await cachedFetch(url);
  assert.equal(net.calls, 3);
});

test('without the Cache API, every request hits the network', async () => {
  const caches = scope.caches;
  delete scope.caches;

  try {
    const net = stubFetch();
    await cachedFetch('https://example.com/b');
    await cachedFetch('https://example.com/b');
    assert.equal(net.calls, 2);
    assert.equal(await clearCache(), 0);
  } finally {
    scope.caches = caches;
  }
});

test('a request that never got a response becomes a CorsError', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => cachedFetch.call({ cache: false }, 'https://example.com/c'),
    (err) => err instanceof CorsError && err.url === 'https://example.com/c'
  );

  // anything else is left as it was
  globalThis.fetch = (async () => {
    throw new RangeError('nope');
  }) as unknown as typeof fetch;
  await assert.rejects(
    () => cachedFetch.call({ cache: false }, 'https://example.com/c'),
    RangeError
  );
});

test('a blocked board is no match, and discovery carries on', async () => {
  stubBoards(/workable\.com/);

  const resolved = await resolveCompany({
    company: 'Acme',
    search: false,
    minJobs: 1,
  });
  assert.equal(resolved.scraper, 'SmartRecruitersScraper');
});

test('failing resolution says when boards were blocked', async () => {
  stubBoards(/workable\.com/);
  await assert.rejects(
    () => resolveCompany({ company: 'Nowhereco', search: false }),
    (err) =>
      err instanceof UnresolvedCompanyError &&
      err.blocked &&
      /CORS/.test(err.message)
  );

  stubBoards(null);
  await assert.rejects(
    () => resolveCompany({ company: 'Nowhereco', search: false }),
    (err) => err instanceof UnresolvedCompanyError && !err.blocked
  );
});

test('a resolved company on a blocked board throws CorsError', async () => {
  stubBoards(/myworkdayjobs\.com/);
  using scraper = createScraper({
    name: 'Acme',
    scraper: 'WorkdayScraper',
    slug: 'acme.wd1.Acme',
  });
  await assert.rejects(() => scraper.getJobsList(), CorsError);
});

test('search ignores the environment and is off without a key', async () => {
  assert.equal(getSearchConfig().apiKey, null);
  assert.equal(await canSearch(), false);
});
