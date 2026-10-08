# Rendering

Converts a scraped posting's content into readable Markdown or text. This is a
library formatting feature independent of how companies and boards are
resolved. HTML conversion here does not sanitize untrusted markup for browser
insertion; the site demo's sanitizer is in `site/src/demo/utils/`.

Add formatting helpers here when they serve posting output. Keep browser demo
presentation and sanitization in the site-owned demo area.
