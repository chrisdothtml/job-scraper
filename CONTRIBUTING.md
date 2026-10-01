# Contributing Guide

## Recommended tools

- [Volta](https://volta.sh/): auto downloads/uses the node/yarn versions from the package.json `volta` field
- [direnv](https://direnv.net/docs/installation.html#from-binary-builds): not required, but nice for putting [bin](./bin/) on your `PATH`
- [vscode](https://code.visualstudio.com/): local tooling/formatting is already configured in this repo. Install the extensions from [.vscode/extensions.json](./.vscode/extensions.json)

`./bin/tsn` is a drop-in for the `node` binary that runs TypeScript modules directly, so there's no build step during development.

## Getting set up

```sh
yarn install
yarn typecheck
```

## Adding a scraper

Run the [`create-scraper`](./.claude/skills/create-scraper/SKILL.md) skill with a careers page URL. It explores the page with a browser, finds the JSON API behind it, and writes the subclass.

Prefer a scraper for the **board** over one for a single company: a board scraper serves everyone on it.

If your board only exposes full postings through its list endpoint, keep a `Map` and read from it with the base class's `fromJobsList(cache, id)`. It fetches the list when the cache is cold and raises `JobNotFoundError` when the id genuinely isn't there. Never make callers fetch the list first.

## Adding a company

If an existing scraper covers it, add an entry to `src/companies.seed.ts`:

```ts
{ name: 'Acme', scraper: 'GreenhouseScraper', slug: 'acme' },

// when they run a careers site of their own, record it: a URL on it then
// resolves with no requests at all
{
  name: 'Pinterest',
  scraper: 'GreenhouseScraper',
  slug: 'pinterest',
  domains: ['pinterestcareers.com'],
},
```

Only domains the company itself owns belong in `domains`. A shared board host (`boards.greenhouse.io`) is refused at runtime, and an aggregator's (`linkedin.com`) would hand every later link on it to whoever claimed it first.

Keep the list sorted by name, and make sure the name doesn't collide with an existing one once normalized. There's a test for that.

You don't have to do this by hand for discoverable boards; looking the company up once writes it to `~/.job-scraper/companies.json`. The seed list is pretty much just to pre-hydrate the cache with known companies.

## Web search

`search.ts` is optional and off unless `SERPAPI_KEY` is set. It's the only route to Workday tenants, whose slugs can't be derived from a company name.

Its tests stub `globalThis.fetch` and point `JOB_SCRAPER_DATA_DIR` at a temp dir, so they live in their own file: `node:test` gives each file its own process, which keeps the stub from leaking into the live scraper tests. Keep it that way.

## Caching

`cachedFetch` throws `HttpError` on a non-2xx, so scrapers never need to check `res.ok`, and a board's error body can't be mistaken for job content.

Users can retune or disable the cache via `configureCache`, so don't assume a response is cached. Scrapers pass their own TTL, which a user override supersedes; passing `cache: false` (as the `testing` path does) is honoured regardless of config.

## Tests

```sh
yarn test
```

Tests live in `src/__tests__/`. Anything that touches global state (stubbing `fetch`, overriding config, writing to the data dir) belongs in its own file: `node:test` gives each file its own process, which is what keeps a stub from leaking into the live scraper tests. Point `JOB_SCRAPER_DATA_DIR` at a temp dir in any test that writes.

The scraper tests hit live APIs, so they're slow and can fail for reasons that aren't your fault (a board changing shape, rate limiting). To test one company:

```sh
TEST_COMPANIES="Airbnb, Canva" yarn test
```

## Before opening a PR

```sh
yarn lint-fix
yarn typecheck
yarn test
```

## Releasing

Publish a [GitHub release](https://github.com/chrisdothtml/job-scraper/releases/new) with a tag like `v1.2.3`. The [release workflow](.github/workflows/release.yml) typechecks, lints, sets `package.json`'s version from the tag (not committed), and publishes to npm with provenance. Prerelease tags (`v1.2.3-beta.1`) publish under the `next` dist-tag.

One-time setup: on npmjs.com, add a trusted publisher for the package pointing at the `chrisdothtml/job-scraper` repo and the `release.yml` workflow. No npm token is needed. (npm only lets you configure a trusted publisher on a package that already exists, so the very first publish has to be done manually.)

## Dependencies

This package ships with zero runtime dependencies, and that's deliberate: it's a thin wrapper over `fetch`. If something genuinely needs a dependency (a DOM-scraping fallback needing Playwright, say), raise it before writing the code.
