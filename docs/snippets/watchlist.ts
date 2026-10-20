// Run on a schedule (cron, a CI job, ...) to print postings that appeared
// since the last run. The first run prints everything
import { readFile, writeFile } from 'node:fs/promises';
import { configureCache, listCompanyJobs } from '@chrisdothtml/job-scraper';

const watchlist = ['Airbnb', 'Klaviyo', 'https://jobs.ashbyhq.com/zapier'];
const seenFile = './seen-jobs.json';

// board responses are cached for about a day by default; a daily diff wants
// today's list
configureCache({ enabled: false });

const seen: Record<string, string[]> = JSON.parse(
  await readFile(seenFile, 'utf8').catch(() => '{}')
);

const results = await Promise.allSettled(
  watchlist.map((company) => listCompanyJobs(company))
);

results.forEach((result, i) => {
  const company = watchlist[i]!;
  if (result.status === 'rejected') {
    console.error(`${company}: ${result.reason}`);
    return;
  }

  const known = new Set(seen[company]);
  for (const job of result.value) {
    if (known.has(job.id)) continue;
    if (!job.title.toLowerCase().includes('engineer')) continue;
    console.log(`${company}: ${job.title} (${job.location}) ${job.url}`);
  }
  seen[company] = result.value.map((job) => job.id);
});

await writeFile(seenFile, JSON.stringify(seen, null, 2));
