import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, beforeEach, test } from 'node:test';

// `paths.ts` reads this at import time, so it has to be set before the
// dynamic import below, hence no static imports from the package here
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-scraper-search-'));
process.env.JOB_SCRAPER_DATA_DIR = tmpDir;
for (const key of ['SERP_API_TOKEN', 'SERPAPI_KEY', 'SERPAPI_API_KEY']) {
  delete process.env[key];
}

const {
  canSearch,
  clearSearchCache,
  configureSearch,
  searchForBoards,
  searchForBoardsBatch,
} = await import('../search.ts');

const realFetch = globalThis.fetch;

after(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Stubs the network and records the URLs it was asked for */
function stubSearch(results: string[]): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({ organic_results: results.map((link) => ({ link })) }),
      { status: 200 }
    );
  }) as typeof fetch;
  return calls;
}

// results are remembered across calls, so most tests want a clean slate
beforeEach(async () => {
  await clearSearchCache();
  // usage is persisted, so it would otherwise carry between tests
  await fs.rm(path.join(tmpDir, 'search-usage.json'), { force: true });
  configureSearch({
    apiKey: 'test-key',
    limit: 10,
    period: 'day',
    batchSize: 5,
  });
});

test('search is a no-op until a key is configured', async () => {
  configureSearch({ apiKey: null });
  assert.equal(await canSearch(), false);
  assert.deepEqual(await searchForBoards('Acme'), []);
});

test('the query is scoped to the domains our scrapers serve', async () => {
  configureSearch({ apiKey: 'test-key', limit: 10, period: 'day' });
  const calls = stubSearch([]);

  await searchForBoards('Acme Corp');

  const query = new URL(calls[0]).searchParams.get('q')!;
  assert.match(query, /^"Acme Corp" \(/);
  for (const domain of ['boards.greenhouse.io', 'jobs.lever.co']) {
    assert.ok(query.includes(`site:${domain}`), `missing ${domain}`);
  }
});

test('board URLs are picked out of the results, and the rest ignored', async () => {
  configureSearch({ apiKey: 'test-key', limit: 10, period: 'day' });
  stubSearch([
    'https://www.linkedin.com/company/whatnot',
    'https://whatnot.wd1.myworkdayjobs.com/en-US/Whatnot/job/SF/Engineer_R123',
    'https://boards.greenhouse.io/whatnot/jobs/999',
  ]);

  const found = await searchForBoards('Whatnot');

  assert.deepEqual(
    found.map(({ scraper, slug }) => ({ scraper, slug })),
    [
      // a Workday tenant is only ever findable this way; its slug can't be
      // guessed from the company name
      { scraper: 'WorkdayScraper', slug: 'whatnot.wd1.Whatnot' },
      { scraper: 'GreenhouseScraper', slug: 'whatnot' },
    ]
  );
});

test('the quota is enforced and survives a reload', async () => {
  configureSearch({ apiKey: 'test-key', limit: 2, period: 'day' });
  await fs.rm(path.join(tmpDir, 'search-usage.json'), { force: true });

  const calls = stubSearch([]);
  await searchForBoards('One');
  assert.equal(await canSearch(), true);

  await searchForBoards('Two');
  assert.equal(await canSearch(), false);

  // the third must not reach the network
  assert.deepEqual(await searchForBoards('Three'), []);
  assert.equal(calls.length, 2);

  const usage = JSON.parse(
    await fs.readFile(path.join(tmpDir, 'search-usage.json'), 'utf8')
  );
  assert.equal(usage.count, 2);
});

test('a remembered result stands in for a second search', async () => {
  const calls = stubSearch(['https://boards.greenhouse.io/acme/jobs/1']);

  const first = await searchForBoards('Acme');
  const second = await searchForBoards('Acme');

  assert.equal(calls.length, 1, 'the second lookup should not search');
  assert.deepEqual(first, second);
});

test('a fruitless search is remembered too', async () => {
  const calls = stubSearch([]);

  assert.deepEqual(await searchForBoards('Ghost Company'), []);
  assert.deepEqual(await searchForBoards('Ghost Company'), []);

  // the whole point: not finding a company must not cost a search every time
  assert.equal(calls.length, 1);
});

test('a stale result is searched for again', async () => {
  const calls = stubSearch([]);
  configureSearch({ resultTtl: 0 });

  await searchForBoards('Acme');
  await searchForBoards('Acme');

  assert.equal(calls.length, 2);
  configureSearch({ resultTtl: undefined });
});

test('concurrent lookups of one company share a single search', async () => {
  const calls = stubSearch(['https://boards.greenhouse.io/acme/jobs/1']);

  const results = await Promise.all([
    searchForBoards('Acme'),
    searchForBoards('Acme'),
    searchForBoards('Acme'),
  ]);

  assert.equal(calls.length, 1);
  for (const result of results) assert.equal(result[0]?.slug, 'acme');
});

test('a batch costs one search and is attributed by slug', async () => {
  const calls = stubSearch([
    'https://boards.greenhouse.io/klaviyo/jobs/1',
    'https://jobs.ashbyhq.com/notion/abc',
    // a board belonging to none of the three
    'https://boards.greenhouse.io/someoneelse/jobs/9',
  ]);

  const batch = await searchForBoardsBatch(['Klaviyo', 'Notion', 'Ghost Co']);

  assert.equal(calls.length, 1);
  assert.deepEqual(
    batch.map(({ companyName, boards }) => [companyName, boards[0]?.slug]),
    [
      ['Klaviyo', 'klaviyo'],
      ['Notion', 'notion'],
      // nothing matched, and someoneelse was not misattributed to it
      ['Ghost Co', undefined],
    ]
  );
});

test('a batch only searches for what is not already known', async () => {
  stubSearch(['https://boards.greenhouse.io/klaviyo/jobs/1']);
  await searchForBoards('Klaviyo');

  const calls = stubSearch(['https://jobs.ashbyhq.com/notion/abc']);
  const batch = await searchForBoardsBatch(['Klaviyo', 'Notion']);

  assert.equal(calls.length, 1);
  assert.equal(batch[0].boards[0].slug, 'klaviyo');
  assert.equal(batch[1].boards[0].slug, 'notion');
});

test('a batch splits into chunks of batchSize', async () => {
  const calls = stubSearch([]);
  configureSearch({ batchSize: 2 });

  await searchForBoardsBatch(['A Co', 'B Co', 'C Co', 'D Co', 'E Co']);

  assert.equal(calls.length, 3);
  configureSearch({ batchSize: 5 });
});

test('quota exhaustion stops a batch rather than partly charging it', async () => {
  const calls = stubSearch([]);
  configureSearch({ batchSize: 1, limit: 2 });

  const batch = await searchForBoardsBatch(['A Co', 'B Co', 'C Co', 'D Co']);

  assert.equal(calls.length, 2);
  assert.equal(batch.length, 4, 'every company still gets an entry');
  assert.equal(await canSearch(), false);
  configureSearch({ batchSize: 5, limit: 10 });
});
