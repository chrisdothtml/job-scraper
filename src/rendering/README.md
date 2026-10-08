# Rendering

Converts a scraped posting's content into readable Markdown or text. This is a
library formatting feature independent of how companies and boards are
resolved. HTML conversion here does not sanitize untrusted markup for browser
insertion; the site demo's sanitizer is in `site/src/demo/utils/`.

- [`posting.ts`](./posting.ts): posting-level rendering and rich-text
  conversion.
- [`utils/html.ts`](./utils/html.ts): HTML decoding, inspection, and conversion
  helpers used by the posting renderer.
- [`__tests__/posting.test.ts`](./__tests__/posting.test.ts): rendering tests.

Add formatting helpers here when they serve posting output. Keep browser demo
presentation and sanitization in the site-owned demo area.
