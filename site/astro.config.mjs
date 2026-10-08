import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import opengraphImages from 'astro-opengraph-images';
import { defineConfig } from 'astro/config';
import fs from 'node:fs';
import publicApiHeadings from './src/utils/headings.mjs';
import { renderShareImage } from './src/utils/share-images.ts';

export default defineConfig({
  site: 'https://chrisdothtml.github.io',
  base: '/job-scraper/',
  output: 'static',
  outDir: '../site-dist',
  trailingSlash: 'always',
  markdown: {
    processor: unified({ remarkPlugins: [publicApiHeadings] }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
  integrations: [
    starlight({
      title: 'job-scraper',
      components: { Head: './src/components/Head.astro' },
      // Astro Code snippets also need themes outside Expressive Code's own set.
      expressiveCode: { removeUnusedThemes: false },
      description: 'HTTP-only job board scrapers and discovery utilities.',
      logo: {
        light: './src/assets/brand-mark-light.svg',
        dark: './src/assets/brand-mark-dark.svg',
        alt: '',
        replacesTitle: false,
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/chrisdothtml/job-scraper',
        },
      ],
      sidebar: [
        { label: 'Home', slug: '' },
        { label: 'Use with Agents', slug: 'agents' },
        { label: 'API reference', slug: 'reference' },
        { label: 'CLI reference', slug: 'cli' },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
      ],
      customCss: ['./src/styles/theme.css', './src/styles/demo.css'],
    }),
    opengraphImages({
      options: {
        // Satori requires WOFF/TTF/OTF; browsers use the adjacent WOFF2 files.
        fonts: [400, 600].map((weight) => ({
          name: 'IBM Plex Sans',
          weight,
          style: 'normal',
          data: fs.readFileSync(
            new URL(
              `./src/assets/fonts/plex-sans-${weight}.woff`,
              import.meta.url
            )
          ),
        })),
      },
      render: renderShareImage,
      pathFilter: ({ pathname }) => !/^\/?404\/?$/.test(pathname),
    }),
  ],
  vite: {
    // The demo bundles library sources for browsers, never dist/platform/node.
    resolve: { conditions: ['job-scraper-source', 'browser', 'module'] },
  },
});
