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

// #region search-config
import { configureSearch } from '@chrisdothtml/job-scraper';

configureSearch({
  apiKey: 'your SerpApi key',
  limit: 100,
  period: 'month',
});

await resolveCompany('Whatnot');
// { name: 'Whatnot', scraper: 'WorkdayScraper', slug: 'whatnot.wd1.Whatnot', discovered: true }
// #endregion

// #region search-batch
import {
  clearSearchCache,
  searchForBoardsBatch,
} from '@chrisdothtml/job-scraper';

await searchForBoardsBatch(['Klaviyo', 'Notion', 'Whatnot']); // one search
await clearSearchCache(); // start over
// #endregion

// #region search-off
await resolveCompany({ company: 'Whatnot', search: false });
// #endregion

// #region cache-config
import { clearCache, configureCache, time } from '@chrisdothtml/job-scraper';

configureCache({ ttl: time.hour }); // override every scraper's TTL
configureCache({ enabled: false }); // always hit the network
configureCache({ dir: '/tmp/jobs' }); // put it somewhere else
configureCache({ ttl: undefined }); // drop the override again

await clearCache(); // returns how many entries went
// #endregion
