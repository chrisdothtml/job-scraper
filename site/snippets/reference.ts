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
