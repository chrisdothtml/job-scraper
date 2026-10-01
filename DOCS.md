# Documentation

## `listCompanyJobs(input)`

```ts
import { listCompanyJobs } from '@chrisdothtml/job-scraper';

// by name: resolved from the registry, or discovered and remembered
await listCompanyJobs('Airbnb');

// by board URL
await listCompanyJobs('https://jobs.ashbyhq.com/zapier');

// pin the board yourself
await listCompanyJobs({ scraper: 'GreenhouseScraper', slug: 'figma' });
```

Returns `ListedJob[]`, shaped `{ id, title, location, url }`. Throws `UnresolvedCompanyError` when no scraper can be resolved for the company.

## `fetchJob(input)`

```ts
import { fetchJob } from '@chrisdothtml/job-scraper';

// by posting URL
await fetchJob('https://job-boards.greenhouse.io/airbnb/jobs/7712345');

// works on embedded boards hosted on the company's own domain, too
await fetchJob('https://careers.airbnb.com/positions/8184174?gh_jid=8184174');

// or by company + id
await fetchJob({ company: 'Airbnb', id: '7712345' });
```

Returns a `Job`: a `ListedJob` plus `content`, the full posting. `content` is whatever the board gives up: usually stringified JSON, sometimes markdown or plain text.

## Resolution, without fetching

```ts
import {
  resolveCompany,
  listCompanies,
  registerCompany,
} from '@chrisdothtml/job-scraper';

await resolveCompany('Klaviyo');
// { name: 'Klaviyo', scraper: 'GreenhouseScraper', slug: 'klaviyo', discovered: true }

await listCompanies(); // everything currently known
await registerCompany({ name: 'Acme', scraper: 'LeverScraper', slug: 'acme' });
```

## Scrapers directly

Some boards (Ashby, Lever, Shopify) only hand over full postings through their list endpoint. You don't need to know which: `getJobContent` fetches the list itself when its cache is cold, so a job is always fetchable at will.

```ts
import { scrapers } from '@chrisdothtml/job-scraper';

using scraper = new scrapers.WorkdayScraper('autodesk.wd1.Ext');
const jobs = await scraper.getJobsList();
```

This is also the better tool for bulk work. `listCompanyJobs` and `fetchJob` each build a scraper and let `using` dispose it before returning, which drops any cache the scraper built up (the job list some boards need to answer `getJobContent` from, notably). Fine for a one-off lookup; wasteful for fetching many jobs from the same company, since each call re-fetches that list. Hold onto a scraper yourself instead:

```ts
using scraper = new scrapers.AshbyScraper('zapier');
const jobs = await scraper.getJobsList();
for (const job of jobs) await scraper.getJob(job.id); // one list fetch, not one per job
```

## How a company gets resolved

Given a name or URL, in order:

1. **URL match**: every scraper gets asked whether it recognizes the host. A match yields the board slug and, on a posting URL, the job id.
2. **Domain lookup**: the hostname is checked against the domains companies are known to post on. A company that's been seen on `pinterestcareers.com` once is found there forever after, without a single request.
3. **Registry lookup**: the name is normalized (`"Apollo.io, Inc."` → `apolloio`) and checked against the known companies. A careers site names itself rather than the company, so `pinterestcareers` is also tried as `pinterest`.
4. **Page sniffing**: if none of that lands, the page is fetched. Every link in its markup is run back through step 1, since a company's own careers page is bespoke but the board it embeds leaves its slug there (`boards.greenhouse.io/embed/job_board/js?for=airbnb`). Failing that, the page usually names its own company in `og:site_name` or JSON-LD, which goes back through step 3.
5. **Slug guessing**: the multi-tenant boards are probed in parallel with slugs derived from the name (`acmecorp`, `acme-corp`, and per-board variants). A board's own tracking params (`?gh_jid=`) are a strong hint about which to try first. The first board with at least `minJobs` real postings (3 by default) wins, since a slug answering only proves the board exists, not that the company uses it, and plenty keep a forgotten trial account holding one "Test UAT" posting. Placeholders like that, and talent-community catch-alls, don't count.
6. **Web search**: if a SerpApi key is configured, a `site:`-scoped search over the board domains. See below.
7. Otherwise, `UnresolvedCompanyError`.

Anything found in steps 5 and 6 is written to the registry, so the next lookup is a plain hit. So is the careers domain a company was found on, whichever step found it. That's what collapses the whole pipeline to step 2 the second time around.

A URL is only trusted for the job id it carries itself. Sniffing a careers page turns up plenty of job links, and the first one isn't the one you asked for, so `fetchJob` on a board's landing page raises rather than fetching an arbitrary posting.

## Web search (optional)

Slug guessing only works when the slug looks like the company name. It doesn't for Workday, whose slugs are `tenant.pod.site` triples (`autodesk.wd1.Ext`) that can't be derived from anything. A search finds those.

```ts
import { configureSearch, resolveCompany } from '@chrisdothtml/job-scraper';

configureSearch({
  apiKey: process.env.SERPAPI_KEY,
  limit: 100,
  period: 'month',
});

await resolveCompany('Whatnot');
// { name: 'Whatnot', scraper: 'WorkdayScraper', slug: 'whatnot.wd1.Whatnot', discovered: true }
```

Or by environment (Node only; browsers must use `configureSearch`): `SERP_API_TOKEN` (also `SERPAPI_KEY` / `SERPAPI_API_KEY`), `SERPAPI_SEARCH_LIMIT`, `SERPAPI_SEARCH_PERIOD`.

| Option        | Default                        |                                       |
| ------------- | ------------------------------ | ------------------------------------- |
| `apiKey`      | `SERPAPI_KEY` env, else `null` | Search is skipped entirely when unset |
| `limit`       | `250`                          | Max searches per `period`             |
| `period`      | `'month'`                      | `'day'` or `'month'`                  |
| `resultCount` | `10`                           | Results requested per search          |

The defaults match SerpApi's free tier: 250 searches a month. Check your own dashboard, since the allowance changes. Usage is counted in `~/.job-scraper/search-usage.json` and resets when the period rolls over; a search is counted before its response lands, since a request that errors mid-flight still spends quota. Once the limit is hit, search silently stops being attempted and resolution falls back to the earlier steps.

### Keeping search cheap

Searches cost money, so the package spends them as rarely as it can:

- **Results are remembered**, in `search-results.json`, including fruitless ones. Not finding a company is exactly the case that would otherwise re-search on every lookup. Reused for `resultTtl` (30 days by default), since companies change job boards rarely.
- **Concurrent lookups of the same company share one search**, so resolving a list in parallel can't double-spend.
- **Bulk lookups are batched.** `searchForBoardsBatch(names)` OR's `batchSize` companies (5 by default) into one query at `num=100` and attributes results back by slug: a 5× reduction. Anything already remembered is skipped, so re-running a large list is nearly free.
- Search is only reached when slug guessing has already failed.

```ts
import {
  searchForBoardsBatch,
  clearSearchCache,
} from '@chrisdothtml/job-scraper';

await searchForBoardsBatch(['Klaviyo', 'Notion', 'Whatnot']); // one search
await clearSearchCache(); // start over
```

A search result is never trusted on its own. Searching for a company that other companies' job posts name-drop (an HR platform, say) returns boards belonging to entirely different companies, so a result is only accepted when the slug resembles the company name **and** the board clears the same `minJobs` bar as slug guessing. A board that a search finds but whose API won't serve it is treated as unresolvable, rather than registered as an entry that would always fail.

Search is on whenever a key is configured. Turn it off for a single call with `{ search: false }`:

```ts
await resolveCompany({ company: 'Whatnot', search: false });
```

## The companies registry

`src/companies.seed.ts` is the list the package ships with. Entries carry the board (`scraper` + `slug`) and, where known, the `domains` the company posts on: never a shared board host, which would point every company on that board at one entry. On first run it's copied into the data dir, which then becomes the live registry. Companies discovered at runtime are appended there, not to the seed.

Each entry records where it came from (`seed` or `discovered`), and the file records the package version it was last reconciled against. On the common path that version matches and loading is just a parse. When it doesn't, because you upgraded, the two lists are merged:

- the shipped list wins for anything it covers, since a release may have corrected a slug
- everything you discovered yourself is carried over untouched
- `seed` entries a release has dropped go away, since their removal was deliberate

So upgrading never discards your discoveries, and never leaves you stuck on a stale shipped list.

```ts
import { listCompanies, mergeRegistry } from '@chrisdothtml/job-scraper';
```

## Where state lives

Everything mutable lives in `~/.job-scraper`:

|                       |                                       |
| --------------------- | ------------------------------------- |
| `companies.json`      | the registry above                    |
| `cache/`              | cached board responses                |
| `search-results.json` | what web search turned up per company |
| `search-usage.json`   | search quota accounting               |

It's in your home directory rather than the working directory so every project on the machine shares it: a company should only need discovering once, and a board one project fetched shouldn't be re-fetched by the next. Writes are atomic (temp file then rename), so concurrent processes can't read a half-written registry.

In browsers there's no filesystem: the registry and search state go to `localStorage` (falling back to memory), and `dataDir`/`cacheDir`/`companiesFile` are only Node paths. Override the location with `JOB_SCRAPER_DATA_DIR` (Node only). Delete `companies.json` to reset back to the seed, or set `DISABLE_COMPANY_REGISTRY` to skip the stored file entirely (reads and writes) for the process, so the registry is always the seed, in-memory only. That's handy while changing its shape.

## Supported boards

| Scraper                  | Discoverable | Notes                                              |
| ------------------------ | ------------ | -------------------------------------------------- |
| `GreenhouseScraper`      | ✅           | Also handles boards embedded via `?gh_jid=`        |
| `AshbyScraper`           | ✅           |                                                    |
| `LeverScraper`           | ✅           |                                                    |
| `WorkableScraper`        | ✅           |                                                    |
| `SmartRecruitersScraper` | ✅           | PascalCase slugs                                   |
| `RipplingScraper`        | ✅           |                                                    |
| `WorkdayScraper`         | —            | Slug is `tenant.pod.site`, e.g. `autodesk.wd1.Ext` |
| `GitHubScraper`          | —            | iCIMS-backed                                       |
| `GoogleScraper`          | —            |                                                    |
| `NetflixScraper`         | —            |                                                    |
| `NvidiaScraper`          | —            | Eightfold-backed                                   |
| `ShopifyScraper`         | —            |                                                    |
| `UberScraper`            | —            | Oracle Fusion Recruiting Cloud-backed              |

"Discoverable" means the board can be found by guessing slugs from a company name. The rest still resolve by URL, by web search, or by an explicit `{ scraper, slug }`.

## Caching

Every board request is cached to `~/.job-scraper/cache`, keyed by URL and request body. It's on by default, since scraping the same board twice in a session shouldn't cost two round trips, but the TTLs are the package's opinion, not yours:

```ts
import { configureCache, clearCache, time } from '@chrisdothtml/job-scraper';

configureCache({ ttl: time.hour }); // override every scraper's TTL
configureCache({ enabled: false }); // always hit the network
configureCache({ dir: '/tmp/jobs' }); // put it somewhere else
configureCache({ ttl: undefined }); // drop the override again

await clearCache(); // returns how many entries went
```

Or by environment (Node only): `JOB_SCRAPER_CACHE=off`, `JOB_SCRAPER_CACHE_TTL=3600000`. In browsers responses go to the Cache API instead (named by `dir`), with the same TTLs, and aren't cached at all where it's unavailable.

| Option    | Default                |                                                                      |
| --------- | ---------------------- | -------------------------------------------------------------------- |
| `enabled` | `true`                 |                                                                      |
| `ttl`     | `null`                 | Milliseconds. `null` keeps each scraper's own choice (a day, mostly) |
| `dir`     | `~/.job-scraper/cache` |                                                                      |

Precedence is explicit override → environment → default. `enabled` can only turn caching **off**: scrapers opt out per-call in some places (a discovery probe shouldn't be answered from cache), and config can't force those back on.

Failed responses are never cached: a 404 body must not become an entry a later call would trust as job content.

## Errors

- `UnresolvedCompanyError`: no scraper serves the company. Carries the `input` that failed, and `blocked`: whether the browser's CORS policy blocked any board along the way (so it may resolve from Node).
- `CorsError`: browser only. A request was blocked (most likely by CORS) before any response arrived. Carries `url`. Ashby, Greenhouse, Lever, SmartRecruiters and Rippling allow cross-origin requests; the rest of the boards don't.
- `HttpError`: a board answered non-2xx. Carries `status`, `statusText` and `url`. A stale job id surfaces as a 404 here rather than as job content.
- `JobNotFoundError`: the board served its list, but nothing in it has that id. Carries `jobId` and `companySlug`.

## Adding a scraper

Use the [`/create-scraper`](./.claude/skills/create-scraper/SKILL.md) skill, which drives a browser to find a board's underlying JSON API and writes the subclass. See [CONTRIBUTING.md](./CONTRIBUTING.md).
