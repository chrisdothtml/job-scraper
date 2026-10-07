/**
 * Runs before every test file (see `bunfig.toml`). `bun run test` passes
 * `--isolate`, so each file gets a fresh global object, module registry and
 * `process.env`; stubbed `fetch`, swapped platform exports and config can't
 * leak from one file into the next.
 *
 * Points the data dir at a throwaway temp dir, so nothing a test writes
 * lands in a real one. Suites that inspect the data dir set their own.
 */
import { afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// without the condition, `#platform` resolves to `dist`: a stale build at best
if (!import.meta.resolve('#platform').endsWith('/src/platform/node.ts')) {
  throw new Error(
    'Run the tests with `bun run test`, which sets the resolve conditions and per-file isolation they need'
  );
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-scraper-test-'));
process.env.JOB_SCRAPER_DATA_DIR = dataDir;

// (a global hook, since it's registered in a preload)
afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
