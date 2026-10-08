# Scrapers

Owns the shared board scraper contract and each board-specific implementation.
Scrapers parse a board's URLs and responses, list postings, and fetch posting
content. Discovery consults the registry here when it probes possible boards.

- [`Scraper.ts`](./Scraper.ts): base class and shared `Job`, `ListedJob`, and
  URL types/errors.
- [`index.ts`](./index.ts): intentional scraper registry and ordered list used
  for discovery; register new scraper classes here.
- `*Scraper.ts`: one implementation per supported board.
- [`__tests__/`](./__tests__/): shared scraper tests and test-only helper.

Preserve registry order because discovery probes in that order. Put scraper
tests/helpers under `__tests__`; they are excluded from published build output.
