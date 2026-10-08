import { afterAll, test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// `paths.ts` reads this at import time, so it precedes the dynamic import
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-scraper-resolve-'));
process.env.JOB_SCRAPER_DATA_DIR = tmpDir;
for (const key of ['SERP_API_TOKEN', 'SERPAPI_KEY', 'SERPAPI_API_KEY']) {
  delete process.env[key];
}

const { resolveCompany, UnresolvedCompanyError } =
  await import('../resolve.ts');

const realFetch = globalThis.fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/**
 * Stubs the network so that only Acme's SmartRecruiters board answers, with
 * the given postings. Every other board 404s, as it would for a slug it
 * doesn't serve.
 */
function stubSmartRecruiters(titles: string[]): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.smartrecruiters.com/v1/companies/Acme/')) {
      return new Response('Not Found', { status: 404 });
    }

    const content = titles.map((name, i) => ({
      id: String(i),
      name,
      location: { fullLocation: 'San Francisco, CA, United States' },
    }));
    return new Response(
      JSON.stringify({
        offset: 0,
        limit: 100,
        totalFound: content.length,
        content,
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

test('a board holding only a placeholder posting is not adopted', async () => {
  // exactly what a forgotten SmartRecruiters trial account serves
  stubSmartRecruiters(['Test UAT']);

  await assert.rejects(
    () => resolveCompany({ company: 'Acme', search: false }),
    UnresolvedCompanyError
  );
  // placeholders never count, however low the bar
  await assert.rejects(
    () => resolveCompany({ company: 'Acme', search: false, minJobs: 1 }),
    UnresolvedCompanyError
  );
});

test('a board is adopted once it clears minJobs', async () => {
  stubSmartRecruiters(['Engineer', 'Designer']);

  await assert.rejects(
    () => resolveCompany({ company: 'Acme', search: false }),
    UnresolvedCompanyError
  );

  const resolved = await resolveCompany({
    company: 'Acme',
    search: false,
    minJobs: 2,
  });
  assert.equal(resolved.scraper, 'SmartRecruitersScraper');
  assert.equal(resolved.slug, 'Acme');
  assert.equal(resolved.discovered, true);
});
