# job-scraper

> List jobs for 15k+ companies for free. Runs locally; no headless browsers or API tokens.

This package provides lightweight, reliable, http-only scrapers for the most popular job board providers. It ships with a small list of pre-mapped companies, but it learns new ones as you look them up.

**[Try it live in your browser](https://chrisdothtml.github.io/job-scraper/)**

One benefit this package provides (in addition to reliable job board scrapers) is its ability to infer the correct job board for a company from a variety of different input formats (e.g. company name, careers homepage URL, individual job post URL).

<details>
<summary>Where does the 15k+ number come from?</summary>

[Bloomberry](https://bloomberry.com/) tracks software adoption by discovering and validating companies using known URL patterns and other public signals.

These are its current counts for the job boards this package supports:

| Provider                                                                |  Companies |
| ----------------------------------------------------------------------- | ---------: |
| [Greenhouse](https://bloomberry.com/data/greenhouse/)                   |      4,250 |
| [Ashby](https://bloomberry.com/data/ashby/)                             |      3,655 |
| [Workday Recruiting](https://bloomberry.com/data/workday-recruiting/)   |      2,334 |
| [Lever](https://bloomberry.com/data/lever/)                             |      1,849 |
| [SmartRecruiters](https://bloomberry.com/data/smartrecruiters/)         |      1,250 |
| [Rippling Recruiting](https://bloomberry.com/data/rippling-recruiting/) |        851 |
| [Workable](https://bloomberry.com/data/workable/)                       |        844 |
| **Total**                                                               | **15,033** |

</details>

## Install

```sh
yarn add @chrisdothtml/job-scraper
```

No runtime dependencies. Requires Node 22+, or a bundler for browsers (where only some boards are reachable).

## Usage

**List company jobs**

```ts
import { listCompanyJobs } from '@chrisdothtml/job-scraper';

// works by name alone, across whichever board the company happens to use
await listCompanyJobs('Airbnb'); // Greenhouse
await listCompanyJobs('Klaviyo'); // also Greenhouse, but you didn't need to know that
await listCompanyJobs('Whatnot'); // Workday, found via search

// or by any URL a person would actually paste: a board link, or the
// company's own careers page with a board embedded in it
await listCompanyJobs('https://jobs.ashbyhq.com/zapier');
await listCompanyJobs(
  'https://careers.airbnb.com/positions/8184174?gh_jid=8184174'
);
```

**Fetch a single job**

```ts
import { fetchJob } from '@chrisdothtml/job-scraper';

await fetchJob('https://job-boards.greenhouse.io/airbnb/jobs/7712345');
```

See the [docs](https://chrisdothtml.github.io/job-scraper/) for the full API, recipes, how resolution works, caching, and configuration.

## License

[MIT](./LICENSE)
