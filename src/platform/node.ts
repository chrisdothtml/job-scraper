import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { type Platform, type ResponseCache } from './types.ts';

// read on access rather than at import, so that whatever imports this first
// (`constants.ts`, say) doesn't pin the data dir before a caller sets it
function dataDir(): string {
  return path.resolve(
    process.env.JOB_SCRAPER_DATA_DIR || path.join(os.homedir(), '.job-scraper')
  );
}

const ensured = new Set<string>();

/** Creates a directory once per process; safe to call on every write */
async function ensureDir(dir: string): Promise<string> {
  if (!ensured.has(dir)) {
    await fs.mkdir(dir, { recursive: true });
    ensured.add(dir);
  }
  return dir;
}

/**
 * Writes a file atomically. The data dir is shared across every project on
 * the machine, so two processes can be writing the registry at once; a
 * temp-then-rename keeps a reader from ever seeing a half-written file. The
 * temp name is unique per call, not just per process: concurrent writes within
 * one process would otherwise share it, and the later rename would hit ENOENT.
 */
let tempCounter = 0;
async function writeFileAtomic(
  filePath: string,
  contents: string
): Promise<void> {
  await ensureDir(path.dirname(filePath));

  const temp = `${filePath}.${process.pid}.${tempCounter++}.tmp`;
  await fs.writeFile(temp, contents);
  await fs.rename(temp, filePath);
}

function cacheFilePath(dir: string, key: string): string {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(dir, hash + '.json');
}

const responseCache: ResponseCache = {
  async get(dir, key, ttl) {
    const file = cacheFilePath(dir, key);

    try {
      const { mtimeMs } = await fs.stat(file);
      // `mtimeMs` carries sub-millisecond precision that `Date.now()`
      // truncates, so a just-written entry can read as slightly negative age;
      // clamping keeps `ttl: 0` meaning "always stale" rather than "always
      // fresh"
      const age = Math.max(0, Date.now() - mtimeMs);
      if (age >= ttl) return null;

      const cached = JSON.parse(await fs.readFile(file, 'utf8'));

      return new Response(Buffer.from(cached.body, 'base64'), {
        status: cached.status,
        statusText: cached.statusText,
        headers: cached.headers,
      });
    } catch {
      return null;
    }
  },

  async put(dir, key, { body, ...res }) {
    await ensureDir(dir);
    const payload = { ...res, body: Buffer.from(body).toString('base64') };
    await fs.writeFile(cacheFilePath(dir, key), JSON.stringify(payload));
  },

  async clear(dir) {
    try {
      const files = await fs.readdir(dir);
      const cached = files.filter((file) => file.endsWith('.json'));
      await Promise.all(cached.map((file) => fs.rm(path.join(dir, file))));
      return cached.length;
    } catch {
      return 0;
    }
  },
};

export const platform: Platform = {
  enforcesCors: false,
  env: (name) => process.env[name],
  get dataDir() {
    return dataDir();
  },
  get cacheDir() {
    return path.join(dataDir(), 'cache');
  },
  get companiesFile() {
    return path.join(dataDir(), 'companies.json');
  },
  dataFile: (name) => path.join(dataDir(), name),

  async readText(file) {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
  },

  writeText: writeFileAtomic,
  responseCache,

  sourceVersion() {
    // the same depth from both `src/platform` and `dist/platform`
    const pkgFile = path.resolve(import.meta.dirname, '../../package.json');
    return JSON.parse(fsSync.readFileSync(pkgFile, 'utf8')).version;
  },
};
