/**
 * Builds the docs site into `site-dist/`. With `--dev`, rebuilds on change and
 * serves it on localhost instead.
 */
import * as esbuild from 'esbuild';
import { watch } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as pkg from '../src/index.ts';
import { highlightTs } from './highlight.ts';

const siteDir = import.meta.dirname;
const outdir = join(siteDir, '..', 'site-dist');
const dev = process.argv.includes('--dev');

/**
 * Reads the code for a `<pre data-snippet="file#region">`: the lines of
 * `snippets/<file>.ts` inside every `// #region` naming `region` (or the whole
 * file, when there's no region), minus the markers themselves. The snippets
 * are real modules, so `yarn typecheck` keeps them honest against `src/`.
 */
async function readSnippet(file: string, region?: string): Promise<string> {
  const source = await readFile(
    join(siteDir, 'snippets', `${file}.ts`),
    'utf8'
  );
  const whole: string[] = [];
  const segments: string[][] = [];
  const open: { names: string[]; lines: string[] }[] = [];

  for (const line of source.split('\n')) {
    const start = /^\s*\/\/ #region (.+)$/.exec(line);
    if (start) {
      open.push({ names: start[1]!.trim().split(/\s+/), lines: [] });
    } else if (/^\s*\/\/ #endregion/.test(line)) {
      const segment = open.pop();
      if (region && segment?.names.includes(region)) {
        segments.push(segment.lines);
      }
    } else {
      whole.push(line);
      for (const segment of open) segment.lines.push(line);
    }
  }

  if (region && !segments.length) {
    throw new Error(`No region '${region}' in snippets/${file}.ts`);
  }

  return (region ? segments : [whole]).map(tidy).join('\n\n');
}

/** Drops blank lines at either end, and the common indentation */
function tidy(lines: string[]): string {
  const text = lines
    .join('\n')
    .replace(/^\s*\n/, '')
    .trimEnd();
  const indents = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => /^ */.exec(line)![0].length);
  const indent = Math.min(...indents);
  return text
    .split('\n')
    .map((line) => line.slice(indent))
    .join('\n');
}

/**
 * Throws when a snippet uses one of the package's exports without importing
 * it, so every code block still runs when copied on its own
 */
function checkImports(code: string, where: string) {
  const imported = new Set(
    [...code.matchAll(/import\s*{([^}]*)}/g)].flatMap(([, names]) =>
      names!.split(',').map((name) => name.replace(/^\s*type\s/, '').trim())
    )
  );
  // comments and strings say plenty of words that happen to be exports
  const bare = code.replace(/\/\/.*|'[^'\n]*'|`[^`]*`/g, '');
  const missing = Object.keys(pkg).filter(
    (name) =>
      !imported.has(name) && new RegExp(`(?<![.\\w])${name}\\b`).test(bare)
  );
  if (missing.length) {
    throw new Error(`snippets/${where} uses ${missing.join(', ')} unimported`);
  }
}

/**
 * Renders the page: inlines `docs.html` into `index.html`, and swaps each
 * snippet placeholder for its highlighted code
 */
async function renderHtml() {
  const [page, docs] = await Promise.all(
    ['index.html', 'docs.html'].map((name) =>
      readFile(join(siteDir, name), 'utf8')
    )
  );
  let html = page!.replace('<!-- docs.html -->', docs!.trim());

  const placeholder = /<pre data-snippet="([\w-]+)(?:#([\w-]+))?"><\/pre>/g;
  for (const [tag, file, region] of [...html.matchAll(placeholder)]) {
    const snippet = await readSnippet(file!, region);
    checkImports(snippet, region ? `${file}#${region}` : file!);
    const code = highlightTs(snippet);
    // a function, so `$` in the code isn't read as a replacement pattern
    html = html.replace(
      tag,
      () => `<div class="code-block"><pre><code>${code}</code></pre></div>`
    );
  }

  await writeFile(join(outdir, 'index.html'), html);
}

// esbuild only sees the entry points, so the page itself is rendered after
// every build
const renderPage: esbuild.Plugin = {
  name: 'render-page',
  setup(build) {
    build.onEnd(() => renderHtml());
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
  plugins: [renderPage],
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (dev) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // nor does esbuild watch the page and snippets
  watch(siteDir, { recursive: true }, (_, file) => {
    if (file && /\.html$|^snippets\//.test(file)) {
      renderHtml().catch((error) => console.error(error));
    }
  });
  const { port } = await ctx.serve({ servedir: outdir, host: 'localhost' });
  console.log(`Serving http://localhost:${port}/`);
} else {
  await esbuild.build(options);
}
