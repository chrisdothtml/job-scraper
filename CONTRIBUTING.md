# Contributing Guide

## Recommended tools

- [Bun](https://bun.sh/): the package manager, script runner, test runner and TypeScript runner for development (version in the package.json `packageManager` field). The published package is plain JS built by `tsc`, so consumers don't need Bun
- [direnv](https://direnv.net/docs/installation.html#from-binary-builds): not required, but nice for pointing `JOB_SCRAPER_DATA_DIR` at a repo-local `.data` dir (see [.envrc](./.envrc))
- [vscode](https://code.visualstudio.com/): local tooling/formatting is already configured in this repo. Install the extensions from [.vscode/extensions.json](./.vscode/extensions.json)

Bun runs TypeScript modules directly, so there's no build step during development. To run a file (or `-e` snippet) against the sources rather than `dist`, pass the package's own resolve condition: `bun --conditions=job-scraper-source <file>`. Bun loads `.env` automatically.

## Claude Code skills

The repo ships two [Claude Code](https://claude.com/claude-code) skills in [.claude/skills](./.claude/skills):

- [`/create-scraper`](./.claude/skills/create-scraper/SKILL.md): writes a new `Scraper` subclass, e.g. `/create-scraper https://explore.jobs.netflix.net/careers`. It first checks whether an existing scraper already covers the company (see [Adding a scraper](#adding-a-scraper)).
- [`/fix-health-check`](./.claude/skills/fix-health-check/SKILL.md): diagnoses and fixes the daily [scraper health](#tests) run. It pulls the latest failed run with the [`gh` CLI](https://cli.github.com/) (which must be authenticated), then works out whether each failure is a company that moved boards, a broken scraper or a flake. It then updates the seed data or the scraper. Pass a run id or URL to target a specific run.

## Getting set up

```sh
bun install
bun run typecheck
```

## Adding a scraper

See the [source architecture map](./src/README.md) for module ownership and
the [site map](./site/README.md) for documentation-site ownership.

Run the [`create-scraper`](./.claude/skills/create-scraper/SKILL.md) skill with a careers page URL. It explores the page with a browser, finds the JSON API behind it, and writes the subclass.

Prefer a scraper for the **board** over one for a single company: a board scraper serves everyone on it.

If your board only exposes full postings through its list endpoint, keep a `Map` and read from it with the base class's `fromJobsList(cache, id)`. It fetches the list when the cache is cold and raises `JobNotFoundError` when the id genuinely isn't there. Never make callers fetch the list first.

## Adding a company

If an existing scraper covers it, add an entry to `src/companies/seed.ts`:

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

Its tests stub `globalThis.fetch` and point `JOB_SCRAPER_DATA_DIR` at a temp dir, so they live in their own file: `bun run test` runs each file isolated (`--isolate`), which keeps the stub from leaking into the live scraper tests. Keep it that way.

## Caching

`cachedFetch` throws `HttpError` on a non-2xx, so scrapers never need to check `res.ok`, and a board's error body can't be mistaken for job content.

Users can retune or disable the cache via `configureCache`, so don't assume a response is cached. Scrapers pass their own TTL, which a user override supersedes; passing `cache: false` (as the `testing` path does) is honoured regardless of config.

## Tests

```sh
bun run test
```

Tests live beside their owning module in `<module-dir>/__tests__/<module-name>.test.ts` (or `.test.tsx`), for example `src/companies/__tests__/registry.test.ts` and `src/cli/__tests__/runCli.test.ts`. Anything that touches global state (stubbing `fetch`, overriding config, writing to the data dir) belongs in its own file: `bun run test` passes `--isolate`, giving each file a fresh global object, module registry and `process.env`, which is what keeps a stub from leaking into the live scraper tests. Run the tests through `bun run test` rather than a bare `bun test`, which lacks that flag and the `job-scraper-source` condition (the preload refuses to run without them).

The root [`src/__tests__/preload.ts`](./src/__tests__/preload.ts) remains shared setup: it points `JOB_SCRAPER_DATA_DIR` at a fresh temp dir for every file. A test that inspects the data dir should still set its own before importing the package. Nested test files and helpers are excluded from the published build; the source resolution condition lets Bun tests and development scripts load `src/` instead of `dist/`.

The scraper tests hit live APIs, so they're slow and can fail for reasons that aren't your fault (a board changing shape, rate limiting). To test one company:

```sh
TEST_COMPANIES="Airbnb, Canva" bun run test
```

A daily workflow (`.github/workflows/scraper-health.yml`) runs these live scraper tests plus `bun run check-boards`, which sweeps every seeded company's board and lists any that throw or serve no real jobs. You can run it locally too; it hits every live board, so expect it to take a while. Failures show up as a red run with a job summary.

## Docs

The [docs site](https://chrisdothtml.github.io/job-scraper/) uses Astro and Starlight. Edit `site/src/content/docs/`: `index.mdx` is the home page, `reference/index.mdx` covers the public API, and `guides/` holds topic guides. Every public export, including types, has an exact, case-sensitive reference anchor.

Code examples live in `site/snippets/` as checked TypeScript modules. Use `<Snippet file="api" region="list-name" />` to display a complete file or named `// #region`; repeated regions are joined, including their imports. `bun run typecheck` checks the modules and Astro components. Astro currently needs a TypeScript 6 language-service engine, so the private `site/checker` package isolates that engine for the standard Astro checker; the library and snippets keep the TypeScript 7 compiler. `bun run site:build` also checks extracted examples independently, public-export coverage, and built internal links and anchors.

Run `bun run site:dev` for editing. Run `bun run site:build` then `bun run site:preview` to check the static site with its search index. Both serve under `/job-scraper/`. Output goes to `site-dist/` for GitHub Pages; framework dependencies are development-only.

## Before opening a PR

```sh
bun run lint-fix
bun run typecheck
bun run knip
bun run test
```

### knip

Finds unused files, exports and dependencies with [knip](https://knip.dev), configured in `knip.json`.

```
Usage: bun run knip
```

Code that's only reached dynamically (the `#platform` targets, dev scripts, site snippets) is listed under `entry` in `knip.json`; add new dynamically loaded paths there rather than silencing them. To keep a specific unused export on purpose, tag it with a `/** @knipignore */` JSDoc comment. Everything exported from `src/index.ts` is public API and counts as used.

## Releasing

Publish a [GitHub release](https://github.com/chrisdothtml/job-scraper/releases/new) with a tag like `v1.2.3`. The [release workflow](.github/workflows/release.yml) typechecks, lints, sets `package.json`'s version from the tag (not committed), and publishes to npm with provenance. Prerelease tags (`v1.2.3-beta.1`) publish under the `next` dist-tag.

One-time setup: on npmjs.com, add a trusted publisher for the package pointing at the `chrisdothtml/job-scraper` repo and the `release.yml` workflow. No npm token is needed. (npm only lets you configure a trusted publisher on a package that already exists, so the very first publish has to be done manually.)

## Dependencies

This package ships with zero runtime dependencies, and that's deliberate: it's a thin wrapper over `fetch`. If something genuinely needs a dependency (a DOM-scraping fallback needing Playwright, say), raise it before writing the code.

Keep utilities next to their owning feature when they only serve that feature; use `src/utils.ts` for small general helpers. Import implementation modules by their source path so ownership stays clear. `src/index.ts` is the deliberate public export facade and `src/scrapers/index.ts` is the deliberate scraper registry; avoid adding internal barrels elsewhere.
