// Astro's CLI currently double-slices argv. Use its public check API with
// explicit paths; this workspace supplies the TS6 engine Astro requires.
import { check } from '@astrojs/check';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failed = await check({
  root,
  tsconfig: resolve(root, 'tsconfig.json'),
  minimumSeverity: 'warning',
});
if (failed) process.exitCode = 1;
