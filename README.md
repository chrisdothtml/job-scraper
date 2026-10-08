<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <img alt="job-scraper — List jobs for 15k+ companies, for free" src=".github/assets/banner-light.svg" width="100%">
  </picture>
  <p>
    <a href="https://www.npmjs.com/package/@chrisdothtml/job-scraper"><img alt="npm version" src="https://img.shields.io/npm/v/@chrisdothtml/job-scraper"></a>
    <a href="https://github.com/chrisdothtml/job-scraper/actions/workflows/scraper-health.yml"><img alt="Scraper health" src="https://github.com/chrisdothtml/job-scraper/actions/workflows/scraper-health.yml/badge.svg"></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@chrisdothtml/job-scraper"></a>
  </p>
  <p><a href="https://chrisdothtml.github.io/job-scraper/">Live demo</a> · <a href="https://chrisdothtml.github.io/job-scraper/#docs">Docs</a> · <a href="https://www.npmjs.com/package/@chrisdothtml/job-scraper">npm</a></p>
</div>

> List jobs for 15k+ companies for free. Runs locally; no headless browsers or API tokens.

This package provides lightweight, reliable, http-only scrapers for the most popular job board providers. It ships with a small list of pre-mapped companies, but it learns new ones as you look them up.

For coding agents, the repository includes a portable [`job-scraper` skill](./skills/job-scraper/) for listing public jobs and fetching relevant postings. See the [agent guide](https://chrisdothtml.github.io/job-scraper/agents/) for setup and CLI examples.

Install it with the [Skills CLI](https://github.com/vercel-labs/skills) and choose your agent:

```sh
npx skills add chrisdothtml/job-scraper --skill job-scraper
```

Add `--global` to make it available across projects.

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
npm i @chrisdothtml/job-scraper
```

Or the equivalent for your package manager (`bun add`, `deno add npm:`, `yarn add`, `pnpm add`). No runtime dependencies. Requires Node 22+, Bun, Deno, or a bundler for browsers (where only some boards are reachable).

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

## Rendering postings

```ts
import {
  fetchJob,
  renderScrapedPosting,
  htmlToMarkdown,
} from '@chrisdothtml/job-scraper';

const job = await fetchJob('https://job-boards.greenhouse.io/acme/jobs/123');
const { markdown, body, raw } = renderScrapedPosting(job);
const compact = renderScrapedPosting(job, {
  mode: 'compact',
  postingUrl: 'https://example.com/careers/123',
});
htmlToMarkdown('<p>Build <strong>things</strong>.</p>'); // Build **things**.
```

`renderScrapedPosting(job, options?)` defaults to `mode: 'complete'`. Descriptions and rich text become readable sections; every parsed JSON node is accounted for with JSON pointer paths (the empty pointer identifies the root). Other values, including structured compensation, eligibility, unknown fields, nulls, false, zero, empty strings and containers, appear in **Additional posting data**. Container labels distinguish objects from arrays. Exact outer job metadata appears in **Source job metadata**, preserving the scraper URL even with a `postingUrl` override. `body` includes these sections; `markdown` adds the title and summary header.

Complete mode neither deduplicates nor truncates fields. HTML conversion preserves readable text and structure, not original markup, attributes or hidden content. It is not a sanitizer. `raw` is the original `Job`, including its exact `content` string, and rendering never mutates it. JSON primitives and root arrays are supported; malformed JSON is treated as text or HTML. JSON numbers use JavaScript parsing precision and range; numbers outside its finite range are explicitly labelled with their parsed numeric value. The original numeric spelling remains in `raw.content`. Unfinished Markdown code fences are closed before generated sections.

Use `mode: 'compact'` for a selective prose summary: it skips metadata and application fields, selects rich text or long prose, deduplicates description variants and moves closing sections to the end. It can omit short plain text and structured data. Both modes retain the original job in `raw`.

The package also exports `richTextToMarkdown`, `htmlToText`, `decodeHtmlEntities`, `looksLikeHtml`, `looksLikeEscapedHtml`, and the `RenderPostingOptions` and `RenderedPosting` types. These utilities work without a DOM or runtime dependencies.

## License

[MIT](./LICENSE)
