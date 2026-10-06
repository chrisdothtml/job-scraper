import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, beforeEach, test } from 'node:test';

// `paths.ts` reads this at import time, so it precedes the dynamic import
const tmpDir = await fs.mkdtemp(
  path.join(os.tmpdir(), 'job-scraper-homepage-')
);
process.env.JOB_SCRAPER_DATA_DIR = tmpDir;
// persistence of hits and misses is under test here
delete process.env.DISABLE_COMPANY_REGISTRY;
for (const key of ['SERP_API_TOKEN', 'SERPAPI_KEY', 'SERPAPI_API_KEY']) {
  delete process.env[key];
}

const { configureCache } = await import('../cache.ts');
const { configureSearch } = await import('../search.ts');
const { pkgVersion } = await import('../constants.ts');
const {
  clearCompaniesCache,
  findCompany,
  registerCompany,
  setCompanyHomepage,
} = await import('../companies.ts');
const { findHomepage, resolveHomepage } = await import('../homepage.ts');

const realFetch = globalThis.fetch;
// every test stubs its own network, which a cached response would bypass
configureCache({ enabled: false });

after(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(path.join(tmpDir, 'companies.json'), { force: true });
  await fs.rm(path.join(tmpDir, 'search-usage.json'), { force: true });
  clearCompaniesCache();
  configureSearch({ apiKey: undefined, homepages: undefined });
});

type Route = Response | (() => Response);

/**
 * Stubs the network with responses keyed by URL prefix. Anything unrouted
 * fails the way an unregistered domain does, and every request is logged.
 */
function stubNetwork(routes: Record<string, Route>): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    for (const [prefix, route] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return typeof route === 'function' ? route() : route.clone();
      }
    }
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  }) as typeof fetch;
  return requested;
}

const page = (title: string, body = '') =>
  new Response(`<html><head><title>${title}</title></head>${body}</html>`);
const json = (data: unknown) => new Response(JSON.stringify(data));

const acme = {
  name: 'Acme',
  scraper: 'GreenhouseScraper',
  slug: 'acme',
} as const;

test('the website a board declares wins, trimmed to its origin', async () => {
  const requested = stubNetwork({
    'https://job-boards.greenhouse.io/acme': new Response(
      '{"logo":{"href":"https://careers.acme.com/jobs?src=gh","url":"x"}}'
    ),
  });

  assert.deepStrictEqual(await findHomepage(acme), {
    url: 'https://acme.com',
    source: 'board',
  });
  // nothing past the board was needed
  assert.strictEqual(requested.length, 1);
});

test('a lookalike that names someone else is passed over', async () => {
  stubNetwork({
    'https://autocomplete.clearbit.com/': json([
      { name: 'Acme', domain: 'acmestore.com' },
    ]),
    'https://acmestore.com': page('Acme Store | Kitchenware'),
    'https://acme.com': page('Acme — Rockets', '<a href="/about">About</a>'),
  });

  assert.deepStrictEqual(await findHomepage(acme), {
    url: 'https://acme.com',
    source: 'guess',
  });
});

test('a page linking to the board beats one that merely shares the name', async () => {
  stubNetwork({
    'https://autocomplete.clearbit.com/': json([
      { name: 'Acme', domain: 'acme.com' },
    ]),
    'https://acme.com': page('Acme'),
    'https://acme.io': page(
      'Rockets, built better',
      '<a href="https://job-boards.greenhouse.io/acme">Careers</a>'
    ),
  });

  assert.strictEqual((await findHomepage(acme))?.url, 'https://acme.io');
});

test('a guess never outranks a likelier domain that exists', async () => {
  stubNetwork({
    // acme.com is up, but behind bot protection
    'https://acme.com': new Response('Forbidden', { status: 403 }),
    'https://acme.io': page('Acme'),
  });

  assert.strictEqual(await findHomepage(acme), null);
});

test('a trusted lookup behind bot protection is taken as live', async () => {
  stubNetwork({
    'https://autocomplete.clearbit.com/': json([
      { name: 'Acme', domain: 'acme.com' },
    ]),
    'https://acme.com': new Response('Forbidden', { status: 403 }),
  });

  assert.deepStrictEqual(await findHomepage(acme), {
    url: 'https://acme.com',
    source: 'clearbit',
  });
});

test('Wikidata entities that are not organizations are ignored', async () => {
  stubNetwork({
    'https://www.wikidata.org/w/api.php?action=wbsearchentities': json({
      search: [
        { id: 'Q1', label: 'Acme', description: 'programming language' },
      ],
    }),
    'https://www.wikidata.org/w/api.php?action=wbgetentities': json({
      entities: {
        Q1: {
          claims: {
            P856: [{ mainsnak: { datavalue: { value: 'https://acme.dev' } } }],
          },
        },
      },
    }),
    'https://acme.dev': new Response('Forbidden', { status: 403 }),
  });

  assert.strictEqual(await findHomepage(acme), null);
});

test('broken sources fail quietly', async () => {
  stubNetwork({
    'https://job-boards.greenhouse.io/': new Response('', { status: 500 }),
    'https://autocomplete.clearbit.com/': new Response('<html>gone</html>'),
    'https://www.wikidata.org/': json({ unexpected: true }),
    'https://acme.com': () => {
      throw new Error('socket hang up');
    },
  });

  assert.strictEqual(await findHomepage(acme), null);
});

test('a parked domain is never a homepage', async () => {
  stubNetwork({
    'https://acme.com': page('Acme', 'This domain is for sale!'),
  });

  assert.strictEqual(await findHomepage(acme), null);
});

test('a found homepage is remembered on the registry', async () => {
  await registerCompany(acme);
  const requested = stubNetwork({
    'https://job-boards.greenhouse.io/acme': new Response(
      '{"logo":{"href":"https://acme.com"}}'
    ),
  });

  assert.strictEqual(await resolveHomepage('Acme'), 'https://acme.com');
  assert.strictEqual((await findCompany('Acme'))?.homepage, 'https://acme.com');

  requested.length = 0;
  assert.strictEqual(await resolveHomepage('Acme'), 'https://acme.com');
  assert.strictEqual(requested.length, 0);
});

test('a miss is remembered, but not past a release or a request to search', async () => {
  await registerCompany(acme);
  const requested = stubNetwork({});

  assert.strictEqual(await resolveHomepage('Acme'), null);
  const stored = await findCompany('Acme');
  assert.strictEqual(stored?.homepageMiss?.searched, false);

  // remembered: no second round of lookups
  requested.length = 0;
  assert.strictEqual(await resolveHomepage('Acme'), null);
  assert.strictEqual(requested.length, 0);

  // without a key, asking for search changes nothing
  assert.strictEqual(await resolveHomepage('Acme', { search: true }), null);
  assert.strictEqual(requested.length, 0);

  // with one, a caller asking for search hasn't had its question answered
  // yet, so it looks again (and still misses)
  configureSearch({ apiKey: 'test' });
  const retried = stubNetwork({
    'https://serpapi.com/': json({ organic_results: [] }),
  });
  assert.strictEqual(await resolveHomepage('Acme', { search: true }), null);
  assert.ok(retried.some((url) => url.startsWith('https://serpapi.com/')));
  assert.strictEqual((await findCompany('Acme'))?.homepageMiss?.searched, true);

  // and a miss recorded by another release isn't trusted by this one
  await setCompanyHomepage('Acme', {
    miss: { ts: Date.now(), searched: true, version: '0.0.0-older' },
  });
  retried.length = 0;
  assert.strictEqual(await resolveHomepage('Acme'), null);
  assert.ok(retried.length > 0);
  assert.strictEqual(
    (await findCompany('Acme'))?.homepageMiss?.version,
    pkgVersion
  );
});

const serp = (...links: string[]) =>
  json({ organic_results: links.map((link) => ({ link })) });

test('with search on, a search result naming the company beats a lookalike lookup', async () => {
  configureSearch({ apiKey: 'test', homepages: true });
  stubNetwork({
    'https://autocomplete.clearbit.com/': json([
      { name: 'Acme', domain: 'acmestore.com' },
    ]),
    'https://acmestore.com': page('Acme'),
    'https://serpapi.com/': serp(
      'https://www.linkedin.com/company/acme',
      'https://acme.rocks/about'
    ),
    'https://acme.rocks': page('Acme | Rockets'),
  });

  assert.deepStrictEqual(await findHomepage(acme), {
    url: 'https://acme.rocks',
    source: 'search',
  });
});

test('a page linking back to the board needs no search', async () => {
  configureSearch({ apiKey: 'test', homepages: true });
  const requested = stubNetwork({
    'https://autocomplete.clearbit.com/': json([
      { name: 'Acme', domain: 'acme.com' },
    ]),
    'https://acme.com': page(
      'Acme',
      '<a href="https://job-boards.greenhouse.io/acme">Careers</a>'
    ),
    'https://serpapi.com/': serp('https://acme.rocks'),
  });

  assert.strictEqual((await findHomepage(acme))?.url, 'https://acme.com');
  assert.ok(!requested.some((url) => url.startsWith('https://serpapi.com/')));
});

test('homepage search stays off unless configured', async () => {
  configureSearch({ apiKey: 'test' });
  const requested = stubNetwork({
    'https://serpapi.com/': serp('https://acme.rocks'),
  });

  assert.strictEqual(await findHomepage(acme), null);
  assert.ok(!requested.some((url) => url.startsWith('https://serpapi.com/')));
});
