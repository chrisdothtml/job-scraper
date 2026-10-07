import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * Sweeps every seeded company's job board. A board that throws (after one
 * retry) is a failure and exits 1; one that serves no real postings is only
 * a warning, since a company can legitimately have nothing open. Hits ~all
 * live boards. In CI, also writes tables to the job summary and annotates
 * warnings on the run page.
 */

const CONCURRENCY = 6;
const RETRY_DELAY_MS = 2000;

// the data dir is read when the package loads, so set it before importing
process.env.JOB_SCRAPER_DATA_DIR ||= fs.mkdtempSync(
  path.join(os.tmpdir(), 'job-scraper-boards-')
);

const { seedCompanies } = await import('../companies.seed.ts');
const { getScraper } = await import('../scrapers/index.ts');
const { isPlaceholderJob } = await import('../scrapers/Scraper.ts');

type Seed = (typeof seedCompanies)[number];
type Finding = Seed & { problem: string };
type Result = { failure?: Finding; warning?: Finding };

async function countRealJobs(company: Seed) {
  using scraper = new (getScraper(company.scraper))(company.slug);
  const jobs = await scraper.getJobsList(true);
  return Array.isArray(jobs)
    ? jobs.filter((job) => !isPlaceholderJob(job)).length
    : 0;
}

async function check(company: Seed): Promise<Result> {
  let count: number;
  try {
    try {
      count = await countRealJobs(company);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      count = await countRealJobs(company);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { failure: { ...company, problem: `Threw: ${message}` } };
  }
  return count > 0
    ? {}
    : { warning: { ...company, problem: 'No real jobs listed' } };
}

const failures: Finding[] = [];
const warnings: Finding[] = [];
const queue = [...seedCompanies];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const { failure, warning } = await check(c);
      if (failure) {
        failures.push(failure);
        console.log(
          `FAIL ${failure.name} (${failure.scraper}, ${failure.slug}): ${failure.problem}`
        );
      }
      if (warning) {
        warnings.push(warning);
        console.log(
          `WARN ${warning.name} (${warning.scraper}, ${warning.slug}): ${warning.problem}`
        );
        if (process.env.GITHUB_ACTIONS) {
          console.log(
            `::warning title=No jobs::${warning.name} (${warning.scraper}, ${warning.slug}): ${warning.problem}`
          );
        }
      }
    }
  })
);

const byName = (a: Finding, b: Finding) => a.name.localeCompare(b.name);
failures.sort(byName);
warnings.sort(byName);

const total = seedCompanies.length;
const ok = total - failures.length - warnings.length;
const counts = `${ok}/${total} boards OK, ${failures.length} failed, ${warnings.length} with no jobs`;
console.log(counts);

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const cell = (text: string) =>
    text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 300);
  const table = (title: string, rows: Finding[]) =>
    rows.length
      ? `\n### ${title}\n\n| Company | Scraper | Slug | Problem |\n| --- | --- | --- | --- |\n` +
        rows
          .map(
            (f) =>
              `| ${[f.name, f.scraper, f.slug, f.problem].map(cell).join(' | ')} |\n`
          )
          .join('')
      : '';

  const md =
    `## Board sweep\n\n${counts}\n` +
    table('Failing boards', failures) +
    table('Boards with no jobs', warnings);
  fs.appendFileSync(summaryPath, md + '\n');
}

process.exit(failures.length ? 1 : 0);
