---
name: create-scraper
description: Given a careers page URL, uses Playwright browser tools to explore the page, identify reliable scraping patterns (preferring hidden JSON APIs over DOM scraping), then writes a TypeScript Scraper subclass for that job board
---

Your goal is to explore a careers page and write a permanent, reliable `Scraper` subclass. Prefer writing a scraper for the **job board** (Greenhouse, Ashby, Workday, ...) over one for a single company: a board scraper serves every company on it, which is the main value of this package. Only write a company-specific scraper when the company runs its own bespoke careers site.

The argument is either:

1. a company name, e.g. `/create-scraper netflix`
2. a careers page URL, e.g. `/create-scraper https://explore.jobs.netflix.net/careers`, or
3. a json file containing a list of company names (go through each, determine whether an existing scraper covers it or a new one is needed)

## Step 0: Check whether it's already covered

Before exploring anything, try the package's own resolution:

```sh
./bin/tsn -e "
  import { resolveCompany } from './src/index.ts';
  console.log(await resolveCompany('COMPANY_OR_URL'));
"
```

If that resolves, there's nothing to build. Report the result and stop. Run it against a throwaway `JOB_SCRAPER_DATA_DIR` if you don't want the lookup writing to the shared registry.

## Step 1a: Identify the careers page URL

If it was provided as the argument, move on; otherwise search "[company-name] careers" via `WebSearch` and navigate until you find the careers page.

## Step 1b: Identify the scraper name

Name the class after the **board**, falling back to the company for bespoke sites:

- `jobs.ashbyhq.com` → `AshbyScraper` → `src/scrapers/AshbyScraper.ts`
- `explore.jobs.netflix.net` → `NetflixScraper` → `src/scrapers/NetflixScraper.ts`

## Step 2: Navigate and capture network traffic

The goal is to find a JSON API the page calls internally: far more reliable than DOM scraping.

1. Navigate to the URL with `browser_navigate`
2. Immediately inject a network monitor via `browser_evaluate`:

```js
window.__reqs = [];
const _f = window.fetch.bind(window);
window.fetch = function (input, init) {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  window.__reqs.push({ url, method: (init?.method || 'GET').toUpperCase() });
  return _f(input, init);
};
const _open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
  window.__reqs.push({ url: String(url), method: method.toUpperCase() });
  return _open.apply(this, arguments);
};
```

3. Take a `browser_snapshot` to understand the page structure
4. Interact with the page to trigger data loads: scroll to the bottom, wait a moment, then retrieve what was captured:

```js
window.__reqs;
```

5. Look for job listing APIs: JSON endpoints with paths like `/api/jobs`, `/search`, `/v1/positions`, `/careers/api`. Filter out analytics, fonts, images, and tracking pixels.

## Step 3: Probe the API (if found)

1. Use `browser_evaluate` to call it directly and inspect the response shape:

```js
const res = await fetch('ENDPOINT_URL');
const data = await res.json();
JSON.stringify(data, null, 2).slice(0, 3000); // preview
```

2. Understand the response structure: where are jobs listed? What fields are available (title, location, id, url)?
3. Identify pagination: `total`, `offset`, `limit`, `page`, `cursor`. Test by modifying query params.
4. Find the job detail endpoint: try appending a job ID to the base URL, or look for a detail URL in the job object.

**If the site is served by a board this package already has** (see `src/scrapers/index.ts`), stop. Register the company instead (Step 7).

## Step 4: Explore pagination

Click through to page 2 (or trigger a "Load more"), confirm the data pattern holds, and understand the full pagination mechanism.

## Step 5: Inspect a job detail page

Navigate to 1–2 individual job listings: either call the detail API endpoint directly, or click a job link and `browser_snapshot`. This is what `getJobContent` will return.

Note the **company's own careers domain** if the posting is reachable on one (`pinterestcareers.com`). That goes in the company's `domains` in Step 7, and makes every later URL on it resolve with no requests.

Also note the **shape of the posting URL**, since you'll implement `parseUrl` and `jobUrl` from it. Check whether the board offers more than one host for the same job (Greenhouse serves `boards.`, `job-boards.` and `boards-api.`) and whether companies embed it on their own domain: `parseUrl` should accept all of those forms.

## Step 6: Write the Scraper

Write `src/scrapers/{Name}Scraper.ts`. Every scraper must implement `getJobsList` and `getJobContent`; the rest of the members below are what let the package resolve a company _without_ being told which scraper to use, so fill them in whenever you can.

```typescript
import { cachedFetch } from '../cache.ts';
import { time } from '../utils/misc.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

export default class {Name}Scraper extends Scraper {
  // true only for multi-tenant boards whose slug can be guessed from a
  // company name; this opts the board into company discovery
  static readonly discoverable = true;

  // override only when the board's slugs don't match the default
  // `acmecorp` / `acme-corp` guesses (e.g. SmartRecruiters uses PascalCase)
  static slugCandidates(companyName: string): string[] {
    return super.slugCandidates(companyName);
  }

  // hostnames this board serves, used to build `site:` search queries and
  // to decide whether the board is worth sniffing for in page markup
  static readonly boardDomains = ['jobs.example.com'];

  // query params this board tags outbound links with. When a company embeds
  // the board on its own domain these often survive in the URL, and are the
  // only clue a bespoke careers site gives about which board is behind it
  static readonly urlHintParams = ['example_jid'];

  // recognize this board's URLs, so a pasted link resolves without a name.
  // Cover every host form the board answers on, including the API host and
  // any embed URL, since page sniffing runs markup links back through this
  static parseUrl(url: URL): ParsedUrl | null {
    if (url.hostname !== 'jobs.example.com') return null;
    const [slug, id] = url.pathname.split('/').filter(Boolean);
    if (!slug) return null;
    return { slug, jobId: id ?? null };
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    // Fetch all pages via the API and return the full list.
    // When `testing` is true, fetch as little as possible (one page/job).
  }

  async getJobContent(id: string): Promise<string> {
    // Call the job detail API endpoint and return JSON.stringify(data)
  }

  // the public posting URL, when it can be built from the id alone
  jobUrl(id: string): string {
    return `https://jobs.example.com/${this.companySlug}/${id}`;
  }
}
```

### If no usable API exists

**Do not write a Playwright (or any other browser-automation/DOM) scraper.** This package is pure-HTTP only and ships with no runtime dependencies; a Playwright scraper is a non-starter here, not a fallback to reach for.

If Steps 2–4 turn up no usable JSON API and the board can't be scraped via plain HTTP requests, stop and report that back to the user: name the board/company, say that pure-HTTP scraping isn't possible for it, and let them decide how to proceed. Don't write the scraper.

### Conventions

- **Use `cachedFetch`, not raw `fetch`.** It's a drop-in that caches responses to disk
- `id` in `ListedJob` must be stable and usable in `getJobContent`
- `getJobContent` should return a rich string: `JSON.stringify(apiResponse)` or the posting's full text
- Handle pagination fully in `getJobsList`. Return all jobs, not just page 1
- `location` can be a comma-joined string when there are several
- Leave `discoverable` off for single-company scrapers and for boards whose slug can't be derived from a name (Workday's `tenant.pod.site`); `parseUrl` and `jobUrl` are still worth implementing for those
- Set `urlHintParams` to whatever the board appends to links it hands out (Greenhouse's `gh_jid`/`gh_src`, Ashby's `ashby_jid`). Check a posting URL on a company's own careers domain: the leftover params are what resolution uses to guess the board before probing every other one
- Set `boardDomains` on any board serving more than one company, even when `discoverable` is false. It's what lets web search and page sniffing find the board. Leave it empty for single-company scrapers, or their marketing links will be mistaken for board embeds
- Don't check `res.ok` after `cachedFetch`. It throws `HttpError` on a non-2xx, so a board's error body can never be mistaken for job content
- If the board only serves full postings through its list endpoint, keep a `Map` and read it via the base class's `fromJobsList(cache, id)`. It fetches the list when the cache is cold and raises `JobNotFoundError` for an id the board really doesn't have; callers must never have to fetch the list first
- **The per-job detail response often drops or renames fields the list had; location is the usual casualty.** `getJob()` (what `fetchJob()` actually returns) pulls `title`/`location`/`url` out of `getJobContent`'s JSON by looking for specific top-level keys (`title`/`name`/`text`, `location`/`locationsText`/`full_location`, `absolute_url`/`jobUrl`/`hostedUrl`/`apply_url`; see `readListingFields` in `Scraper.ts`). Compare the detail payload against those key names, not just against what the list returned. When they don't match (a different key name, the value nested under another object, or missing entirely), merge a corrected `title`/`location`/`url` into what `getJobContent` returns (caching the listing's `ListedJob` in a `Map` during `getJobsList` when the detail endpoint doesn't carry the value at all, e.g. Shopify/Uber). Step 8's test run catches this. Don't skip it
- Pass your own `cacheTTL` to `cachedFetch`; a user's `configureCache` override supersedes it. Keep passing `cache: !testing` so test runs stay live

## Step 7: Register the scraper and any companies

1. Add the class to the `scrapers` object in `src/scrapers/index.ts`. The object's order is the order discovery probes boards in, so put widely-used boards near the top.
2. Add any companies you confirmed to `src/companies.seed.ts` as `{ name, scraper, slug }`, plus `domains` if they run a careers site of their own (`pinterestcareers.com`), never a shared board host, keeping the list sorted by name. Only the seed file needs editing. The registry in `~/.job-scraper/companies.json` reconciles itself against the seed on the next version bump, keeping the user's own discoveries.

## Step 8: Verify

```sh
yarn typecheck
TEST_COMPANIES="Company Name" yarn test
```

This exercises `getJob()`, not just `getJobContent()`: it'll fail if the individual job fetch is missing `title`/`location`/`url` (see the detail-response note above). Fix any failures before reporting done. If the scraper is `discoverable`, also confirm that resolution finds it cold:

```sh
JOB_SCRAPER_DATA_DIR=/tmp/scraper-check ./bin/tsn -e "
  import { resolveCompany } from './src/index.ts';
  console.log(await resolveCompany('Company Name'));
"
```

Use a throwaway `JOB_SCRAPER_DATA_DIR` rather than deleting the real one: it lives in `~/.job-scraper` and is shared with every other project on the machine.
