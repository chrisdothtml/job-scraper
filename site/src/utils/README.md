# Site utilities

Helpers shared by site pages or build-time integrations live here. They are
separate from the browser demo's owner-local helpers in `../demo/utils/`.

- [`snippets.ts`](./snippets.ts): load and extract complete or named-region
  examples from `site/snippets/`.
- [`legacy.ts`](./legacy.ts) and
  [`legacy-links.ts`](./legacy-links.ts): redirect old documentation anchors.
- [`headings.mjs`](./headings.mjs): preserve explicit public API heading IDs
  in the Astro table of contents.

Keep site-wide build/browser utilities here; code used only by the live demo
belongs in `../demo/`.
