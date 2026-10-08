# Discovery

Turns a company name, board/careers URL, or posting URL into a company record,
scraper, or job. Resolution reads and updates the company registry and uses the
scraper registry to identify board formats. Network access uses shared HTTP/CORS
helpers; caching depends on the operation. Optional SerpApi search is configured
here and stays inactive without a key.

Keep candidate discovery and URL interpretation here; durable company records
belong in `../companies/`, and board-specific parsing belongs in
`../scrapers/`.
