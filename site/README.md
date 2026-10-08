# Documentation site

This directory owns the Astro/Starlight documentation site. Its
[`astro.config.mjs`](./astro.config.mjs) defines framework and site integration
configuration. [`check.ts`](./check.ts) is the root checker entrypoint; the
isolated `checker/` package supplies Astro's checker engine. Keep these roots
recognizable because the root package scripts and tooling invoke them directly.

- [`src/content/docs/`](./src/content/docs/): guides, reference pages, and
  site prose.
- [`snippets/`](./snippets/): standalone TypeScript examples extracted for
  display and checked during site builds.
- [`src/demo/`](./src/demo/README.md): browser-run package demo and its
  presentation helpers.
- [`src/utils/`](./src/utils/README.md): site-wide snippet and legacy-link
  helpers.
- `src/components/`, `src/styles/`, and `src/assets/`: Astro components,
  styles, fonts, and brand assets.

`bun run site:build` also generates a 1200×630 PNG alongside each documentation
page (excluding the 404). The `astro-opengraph-images` integration renders the
page's Open Graph title and description using IBM Plex Sans and the site colors.
`src/components/Head.astro` extends Starlight's default metadata with absolute
Open Graph and Twitter image URLs; `check.ts` verifies those URLs and PNG sizes.
React is a build-only dependency, with no runtime fetches. All font files are
vendored in `src/assets/fonts/`: browsers use WOFF2, while Satori uses static WOFF
files because it does not support WOFF2. See that directory's README for sources.

`patches/astro-opengraph-images@1.20.3.patch` fixes upstream image-path validation
to account for Astro's deployment base. Bun applies it on installation; retain
it until an upstream version correctly supports `/job-scraper/` and passes the
site build gates.

Keep browser-demo behavior under `src/demo/` and site/build helpers under
`src/utils/`. When editing snippets, preserve their standalone typechecking and
the named-region convention used by the `Snippet` component.
