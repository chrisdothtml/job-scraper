import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const siteDir = import.meta.dirname;

export async function readSnippet(
  file: string,
  region?: string
): Promise<string> {
  if (!/^[\w-]+$/.test(file))
    throw new Error(`Invalid snippet basename: ${file}`);
  const source = await readFile(
    join(siteDir, 'snippets', `${file}.ts`),
    'utf8'
  );
  return extractSnippet(source, region);
}

export function extractSnippet(source: string, region?: string): string {
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
    throw new Error(`No region '${region}' in snippet`);
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
