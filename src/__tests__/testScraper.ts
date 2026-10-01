import builtinAssert from 'node:assert';
import { type TestContext } from 'node:test';
import { type Scraper } from '../scrapers/Scraper.ts';

/**
 * Smoke-tests a scraper against its live board: lists jobs, then fetches the
 * first one. Lives here rather than on `Scraper` so that `node:assert` and
 * `node:test` stay out of the package, and out of browser bundles.
 */
export async function testScraper(scraper: Scraper, t?: TestContext) {
  // allow to be called manually or as part of a node test run
  const assert: typeof builtinAssert = (t?.assert ??
    builtinAssert) as typeof builtinAssert;
  const jobs = await scraper.getJobsList(true);

  const firstJob = jobs[0];
  assert.ok(isListedJob(firstJob));

  const content = await scraper.getJobContent(firstJob.id);
  assert.ok(typeof content === 'string', 'Job content is a string');
  assert.ok(content.length > 0, 'Job content is not empty');

  // a per-job fetch commonly drops fields the listing had (location is the
  // usual casualty); catch that here rather than downstream, since
  // `getJobContent` alone can't tell the difference
  const job = await scraper.getJob(firstJob.id);
  assert.ok(isListedJob(job));
}

const listedJobType = {
  title: 'Software Engineer',
  location: 'United States',
  id: '00000',
  url: 'https://foo.com/bar',
};

function isListedJob(job: { [key: string]: any }): boolean {
  const missingKeys: string[] = [];
  const typeMisMatches: string[] = [];
  const emptyValues: string[] = [];
  for (const [key, value] of Object.entries(listedJobType)) {
    if (!job.hasOwnProperty(key)) {
      missingKeys.push(key);
      continue;
    }

    const actualValue = job[key];
    const expectedType = typeof value;
    const actualType = typeof actualValue;
    if (actualType !== expectedType) {
      typeMisMatches.push(
        `'${key}': '${actualType}' expected to be '${expectedType}'`
      );
      continue;
    }

    if (expectedType === 'string' && actualValue.length === 0) {
      emptyValues.push(key);
      continue;
    }
  }

  const errorLines: string[] = [];
  if (missingKeys.length > 0) {
    errorLines.push(`Missing keys: ${missingKeys.join(', ')}`);
  }
  if (typeMisMatches.length > 0) {
    errorLines.push(`Incorrect value types: ${typeMisMatches.join(', ')}`);
  }
  if (emptyValues.length > 0) {
    errorLines.push(`Empty values: ${emptyValues.join(', ')}`);
  }

  if (errorLines.length > 0) {
    throw new Error(
      `Job validation errors:\n` + errorLines.map((l) => '  - ' + l).join('\n')
    );
  }

  return true;
}
