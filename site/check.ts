/** Static documentation gates: public API, examples, links, and share images. */
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readSnippet } from './src/utils/snippets.ts';
import { legacy } from './src/utils/legacy-links.ts';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'site-dist');
const base = '/job-scraper/';
const failures: string[] = [];

async function files(dir: string, extension: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory()
        ? files(path, extension)
        : entry.name.endsWith(extension)
          ? [path]
          : [];
    })
  );
  return nested.flat();
}

// Match the entry's explicit exports, including type-only exports and aliases.
// Refuse export-star syntax so a future API change cannot silently weaken coverage.
const index = await readFile(join(root, 'src/index.ts'), 'utf8');
if (/export\s*\*/.test(index))
  throw new Error(
    'Expand export-star declarations before checking API coverage'
  );
const exports = [
  ...[...index.matchAll(/export\s*{([^}]+)}/g)].flatMap(([, names]) =>
    names!
      .split(',')
      .map(
        (name) =>
          name
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)
            .at(-1)!
      )
      .filter(Boolean)
  ),
  ...[
    ...index.matchAll(
      /export\s+(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+(\w+)/g
    ),
  ].map(([, name]) => name!),
];

const pages = new Map<string, { html: string; ids: Set<string> }>();
for (const path of await files(output, '.html')) {
  const html = await readFile(path, 'utf8');
  const ids = new Set<string>();
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) {
    if (ids.has(id!))
      failures.push(`Duplicate anchor ${id} in ${relative(output, path)}`);
    ids.add(id!);
  }
  pages.set(path, { html, ids });
}
const reference = pages.get(join(output, 'reference/index.html'));
if (!reference) failures.push('Missing API reference page');
for (const name of exports) {
  if (!reference?.ids.has(name))
    failures.push(`Undocumented public export: ${name}`);
}

for (const [old, route] of Object.entries(legacy)) {
  const [path, anchor] = route.split('#');
  const page = pages.get(join(output, path!, 'index.html'));
  if (!page || (anchor && !page.ids.has(anchor)))
    failures.push(`Broken legacy redirect #${old}: ${route}`);
}

for (const [path, page] of pages) {
  const metadata = new Map<string, string[]>();
  for (const [tag] of page.html.matchAll(/<meta\b[^>]*>/g)) {
    const key = /\b(?:property|name)="([^"]+)"/.exec(tag)?.[1];
    const value = /\bcontent="([^"]*)"/.exec(tag)?.[1];
    if (key && value !== undefined) {
      metadata.set(key, [...(metadata.get(key) ?? []), value]);
    }
  }
  if (path !== join(output, '404.html')) {
    const imagePath = path.replace(/\.html$/, '.png');
    const imageUrl = new URL(
      base + relative(output, imagePath).replaceAll('\\', '/'),
      'https://chrisdothtml.github.io'
    ).href;
    for (const [key, expected] of [
      ['og:image', imageUrl],
      ['twitter:image', imageUrl],
      ['og:image:width', '1200'],
      ['og:image:height', '630'],
      ['og:image:type', 'image/png'],
      ['twitter:card', 'summary_large_image'],
    ]) {
      const values = metadata.get(key!);
      if (values?.length !== 1 || values[0] !== expected) {
        failures.push(`Invalid ${key} in ${relative(output, path)}`);
      }
    }
    try {
      const png = await readFile(imagePath);
      if (
        !png
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        png.readUInt32BE(16) !== 1200 ||
        png.readUInt32BE(20) !== 630
      ) {
        failures.push(`Invalid share image: ${relative(output, imagePath)}`);
      }
    } catch {
      failures.push(`Missing share image: ${relative(output, imagePath)}`);
    }
  } else if (metadata.has('og:image') || metadata.has('twitter:image')) {
    failures.push('404 advertises an ungenerated share image');
  }
  const url = new URL(base + relative(output, path), 'https://docs.invalid');
  for (const [, raw] of page.html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const target = new URL(raw!.replaceAll('&amp;', '&'), url);
    if (target.origin !== url.origin) continue;
    if (!target.pathname.startsWith(base)) {
      failures.push(
        `Link escapes deployed base in ${relative(output, path)}: ${raw}`
      );
      continue;
    }
    let local = decodeURIComponent(target.pathname.slice(base.length));
    if (!local || local.endsWith('/')) local += 'index.html';
    if (!local.endsWith('.html')) {
      try {
        if (!(await stat(join(output, local))).isFile())
          throw new Error('Not a file');
      } catch {
        failures.push(`Missing asset in ${relative(output, path)}: ${raw}`);
      }
      continue;
    }
    const destination = pages.get(join(output, local));
    if (!destination)
      failures.push(`Missing page in ${relative(output, path)}: ${raw}`);
    else if (
      target.hash &&
      !destination.ids.has(decodeURIComponent(target.hash.slice(1)))
    ) {
      failures.push(`Missing anchor in ${relative(output, path)}: ${raw}`);
    }
  }
}

// Type-check the exact rendered excerpts as standalone modules. Whole source
// modules alone miss a region that forgot its imports or relies on other locals.
const virtual = new Map<string, string>();
for (const page of await files(join(root, 'site/src/content/docs'), '.mdx')) {
  const source = await readFile(page, 'utf8');
  for (const [tag] of source.matchAll(/<Snippet\s[^>]*\/>/g)) {
    const file = /\bfile="([^"]+)"/.exec(tag)?.[1];
    const region = /\bregion="([^"]+)"/.exec(tag)?.[1];
    if (!file) throw new Error(`Snippet without a literal file prop: ${page}`);
    const key = join(
      root,
      'site/snippets',
      `__checked-${file}-${region ?? 'whole'}.ts`
    );
    virtual.set(key, await readSnippet(file, region));
  }
}
const scratch = await mkdtemp(join(root, 'site/.astro/checked-'));
try {
  const checkedFiles: string[] = [];
  for (const [path, code] of virtual) {
    const destination = join(scratch, path.split('/').at(-1)!);
    await writeFile(destination, code);
    checkedFiles.push(destination);
  }
  const configPath = join(scratch, 'tsconfig.json');
  await writeFile(
    configPath,
    JSON.stringify({
      extends: join(root, 'site/tsconfig.json'),
      files: checkedFiles,
      include: [],
      exclude: [],
    })
  );
  execFileSync(
    join(root, 'node_modules/.bin/tsc'),
    ['--noEmit', '-p', configPath],
    { stdio: 'pipe' }
  );
} catch (error) {
  const output =
    error instanceof Error && 'stdout' in error
      ? String(error.stdout)
      : String(error);
  failures.push(output);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

if (failures.length)
  throw new Error(`Documentation checks failed:\n${failures.join('\n')}`);
console.log(
  `Docs checked: ${exports.length} public exports, ${pages.size} pages, ${virtual.size} standalone snippets.`
);
