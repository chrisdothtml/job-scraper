import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * Where this package keeps its mutable state: the company registry, the HTTP
 * response cache, and search accounting.
 *
 * It lives in the user's home directory rather than the working directory so
 * that every project on the machine shares it: a company should only need
 * discovering once, and a board fetched by one project shouldn't be fetched
 * again by the next. Override with `JOB_SCRAPER_DATA_DIR`.
 */
export const dataDir = path.resolve(
  process.env.JOB_SCRAPER_DATA_DIR || path.join(os.homedir(), '.job-scraper')
);

export const cacheDir = path.join(dataDir, 'cache');
export const companiesFile = path.join(dataDir, 'companies.json');

const ensured = new Set<string>();

/** Creates a directory once per process; safe to call on every write */
export async function ensureDir(dir: string): Promise<string> {
  if (!ensured.has(dir)) {
    await fs.mkdir(dir, { recursive: true });
    ensured.add(dir);
  }
  return dir;
}

/**
 * Writes a file atomically. The data dir is shared across every project on
 * the machine, so two processes can be writing the registry at once; a
 * temp-then-rename keeps a reader from ever seeing a half-written file.
 */
export async function writeFileAtomic(
  filePath: string,
  contents: string
): Promise<void> {
  await ensureDir(path.dirname(filePath));

  const temp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temp, contents);
  await fs.rename(temp, filePath);
}
