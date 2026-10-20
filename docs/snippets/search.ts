// Snippets for the docs' web search section. Each `#region` is one code block
// #region config
import { configureSearch, resolveCompany } from '@chrisdothtml/job-scraper';

configureSearch({
  apiKey: 'your SerpApi key',
  limit: 100,
  period: 'month',
});

await resolveCompany('Whatnot');
// { name: 'Whatnot', scraper: 'WorkdayScraper', slug: 'whatnot.wd1.Whatnot', discovered: true }
// #endregion

// #region batch
import {
  clearSearchCache,
  searchForBoardsBatch,
} from '@chrisdothtml/job-scraper';

await searchForBoardsBatch(['Klaviyo', 'Notion', 'Whatnot']); // one search
await clearSearchCache(); // start over
// #endregion
