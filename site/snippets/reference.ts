// Snippets for the docs' reference sections. Each `#region` names the code
// blocks its lines go to; a name can appear more than once
// #region resolve
import {
  listCompanies,
  registerCompany,
  resolveCompany,
} from '@chrisdothtml/job-scraper';

await resolveCompany('Klaviyo');
// { name: 'Klaviyo', scraper: 'GreenhouseScraper', slug: 'klaviyo', discovered: true }

await listCompanies(); // everything currently known
await registerCompany({ name: 'Acme', scraper: 'LeverScraper', slug: 'acme' });
// #endregion

// #region homepage
import { configureSearch, resolveHomepage } from '@chrisdothtml/job-scraper';

await resolveHomepage('Ramp'); // 'https://ramp.com'
await resolveHomepage('https://jobs.ashbyhq.com/zapier'); // anything resolveCompany takes

// let it fall back to a web search when the free sources aren't conclusive
configureSearch({ apiKey: 'your SerpApi key', homepages: true });

// e.g. a company's icon, via Google's favicon service
const homepage = await resolveHomepage('Ramp');
const icon =
  homepage &&
  `https://www.google.com/s2/favicons?domain=${new URL(homepage).hostname}&sz=64`;
// #endregion

// #region direct bulk
import { scrapers } from '@chrisdothtml/job-scraper';
// #endregion

{
  // #region direct
  using scraper = new scrapers.WorkdayScraper('autodesk.wd1.Ext');
  const jobs = await scraper.getJobsList();
  const job = await scraper.getJob(jobs[0]!.id);
  // #endregion
}

{
  // #region bulk
  using scraper = new scrapers.AshbyScraper('zapier');
  const jobs = await scraper.getJobsList();
  for (const job of jobs) await scraper.getJob(job.id); // one list fetch, not one per job
  // #endregion
}

// #region cache-config
import { clearCache, configureCache, time } from '@chrisdothtml/job-scraper';

configureCache({ ttl: time.hour }); // override every scraper's TTL
configureCache({ enabled: false }); // always hit the network
configureCache({ dir: '/tmp/jobs' }); // put it somewhere else
configureCache({ ttl: undefined }); // drop the override again

await clearCache(); // returns how many entries went
// #endregion
