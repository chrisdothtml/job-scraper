import { platform } from '#platform';

/**
 * Where this package keeps its mutable state: the company registry, the HTTP
 * response cache, and search accounting.
 *
 * It lives in the user's home directory rather than the working directory so
 * that every project on the machine shares it: a company should only need
 * discovering once, and a board fetched by one project shouldn't be fetched
 * again by the next. Override with `JOB_SCRAPER_DATA_DIR`.
 *
 * Node only. Browsers have no filesystem, so there these are just the names
 * the same state goes by (the Cache API cache, and `localStorage` keys).
 */
export const dataDir: string = platform.dataDir;

export const cacheDir: string = platform.cacheDir;
export const companiesFile: string = platform.companiesFile;
