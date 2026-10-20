// Snippets for the API reference. Each `#region` names the code blocks its
// lines go to; a name can appear more than once
// #region list-name list-url list-board
import { listCompanyJobs } from '@chrisdothtml/job-scraper';
// #endregion
// #region job-url job-embedded job-id
import { fetchJob } from '@chrisdothtml/job-scraper';
// #endregion

// #region list-name
// resolved from the registry, or discovered and remembered for next time
await listCompanyJobs('Airbnb');
// #endregion

// #region list-url
// a board URL, or a company's own careers page with a board embedded in it
await listCompanyJobs('https://jobs.ashbyhq.com/zapier');
await listCompanyJobs('https://careers.duolingo.com');
// #endregion

// #region list-board
// pin the board yourself
await listCompanyJobs({ scraper: 'GreenhouseScraper', slug: 'figma' });

// or pin just the board, and let the slug be discovered
await listCompanyJobs({ company: 'Ramp', scraper: 'GreenhouseScraper' });
// #endregion

// #region job-url
await fetchJob('https://job-boards.greenhouse.io/airbnb/jobs/7712345');
// #endregion

// #region job-embedded
// boards embedded on the company's own domain work too
await fetchJob('https://careers.airbnb.com/positions/8184174?gh_jid=8184174');
// #endregion

// #region job-id
// a company (or `url`, or `scraper` + `slug`) plus the job's id
await fetchJob({ company: 'Airbnb', id: '7712345' });
// #endregion
