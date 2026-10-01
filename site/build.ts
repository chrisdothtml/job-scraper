/**
 * Builds the docs site into `site-dist/`. With `--dev`, rebuilds on change and
 * serves it on localhost instead.
 */
import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const siteDir = import.meta.dirname;
const outdir = join(siteDir, '..', 'site-dist');
const dev = process.argv.includes('--dev');

// esbuild only sees the entry points, so the page itself is copied over after
// every build
const copyHtml: esbuild.Plugin = {
  name: 'copy-html',
  setup(build) {
    build.onEnd(async () => {
      await copyFile(join(siteDir, 'index.html'), join(outdir, 'index.html'));
    });
  },
};

const options: esbuild.BuildOptions = {
  entryPoints: [join(siteDir, 'main.ts'), join(siteDir, 'style.css')],
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  // points the package's own `#platform` import at `src/platform/browser.ts`
  // (see `imports` in package.json)
  conditions: ['job-scraper-source'],
  minify: !dev,
  sourcemap: dev,
  logLevel: 'info',
  plugins: [copyHtml],
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (dev) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: outdir, host: 'localhost' });
  console.log(`Serving http://localhost:${port}/`);
} else {
  await esbuild.build(options);
}
