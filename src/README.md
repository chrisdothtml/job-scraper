# Library source map

The package entry is [`index.ts`](./index.ts), the intentional public API
facade. It exposes the high-level [`jobs.ts`](./jobs.ts) functions,
company/discovery/cache/rendering APIs, and the scraper types. The main flow is
jobs API → discovery → company registry and scraper registry → a board scraper.
The CLI is a separate entry path and does not define the library API.

Cross-cutting pieces are [`cache.ts`](./cache.ts) (cached network reads,
abort-signal handling, and HTTP/CORS errors), [`paths.ts`](./paths.ts) (runtime data locations),
[`constants.ts`](./constants.ts) (package version), and `platform/` (runtime
implementations selected through `#platform`). `rendering/` turns scraped
postings into text/Markdown; it is independent of discovery. `cli/` handles
command-line input and output. Rendering HTML conversion is not a sanitizer;
the documentation demo has its own browser-side sanitizer.

Each feature owns its helpers and tests. Add a helper beside the code that uses
it; reserve `utils/misc.ts` for small generic functions. Import implementation
files directly rather than introducing internal barrels. The public
[`index.ts`](./index.ts) facade and [`scrapers/index.ts`](./scrapers/index.ts)
registry are intentional exceptions. Tests follow
`<module-dir>/__tests__/<module-name>.test.ts`; the root `__tests__/preload.ts`
is shared setup and is intentionally retained. Build configuration excludes
tests and their helpers from published output.

## Areas

- [`companies/`](./companies/README.md): company seed and persisted registry.
- [`discovery/`](./discovery/README.md): resolve company, board, job, and
  homepage inputs; optional search and page inspection.
- [`scrapers/`](./scrapers/README.md): common scraper contract, board
  implementations, and their ordered registry.
- [`rendering/`](./rendering/README.md): convert scraped posting content to
  useful text and Markdown.
- [`cli/`](./cli/README.md): command-line runner, with the executable source
  shim retained at `src/cli.ts`.
- [`platform/`](./platform/README.md): Node and browser implementations behind
  the package's platform condition.
- [`utils/`](./utils/README.md): generic utilities shared across library areas.
- [`scripts/`](./scripts/README.md): development and maintenance scripts.
