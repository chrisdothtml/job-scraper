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

Keep browser-demo behavior under `src/demo/` and site/build helpers under
`src/utils/`. When editing snippets, preserve their standalone typechecking and
the named-region convention used by the `Snippet` component.
