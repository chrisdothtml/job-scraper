# Discovery

Turns a company name, board/careers URL, or posting URL into a company record,
scraper, or job. Resolution reads and updates the company registry and uses the
scraper registry to identify board formats. Network access uses shared HTTP/CORS
helpers; caching depends on the operation. Optional SerpApi search is configured
here and stays inactive without a key.

- [`resolve.ts`](./resolve.ts): inputs, matching/probing, and scraper creation.
- [`homepage.ts`](./homepage.ts): find and remember a company's own homepage.
- [`sniff.ts`](./sniff.ts): inspect page markup for company names and known
  board URLs.
- [`search.ts`](./search.ts): optional board/homepage search and its accounting.
- `__tests__/`: isolated tests for resolution, homepage lookup, and search.

Keep candidate discovery and URL interpretation here; durable company records
belong in `../companies/`, and board-specific parsing belongs in
`../scrapers/`.
