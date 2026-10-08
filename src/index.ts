import {
  createScraper,
  resolveCompany,
  resolveJob,
  type CompanyInput,
} from './resolve.ts';
import { type Job, type ListedJob } from './scrapers/Scraper.ts';

export {
  clearCache,
  configureCache,
  CorsError,
  getCacheConfig,
  HttpError,
  type CacheConfig,
} from './cache.ts';
export { seedCompanies } from './companies.seed.ts';
export {
  addCompanyDomain,
  clearCompaniesCache,
  findCompany,
  findCompanyByDomain,
  isBoardDomain,
  listCompanies,
  loadCompanies,
  mergeRegistry,
  normalizeCompanyName,
  normalizeDomain,
  registerCompany,
  setCompanyHomepage,
  type Company,
  type HomepageMiss,
  type StoredCompany,
} from './companies.ts';
export {
  findHomepage,
  resolveHomepage,
  type FoundHomepage,
  type HomepageOptions,
  type HomepageSource,
} from './homepage.ts';
export { cacheDir, companiesFile, dataDir } from './paths.ts';
export {
  boardHints,
  companyNameCandidates,
  companyNameFromUrl,
  createScraper,
  jobIdFromUrl,
  parseJobUrl,
  resolveCompany,
  resolveJob,
  UnresolvedCompanyError,
  type CompanyInput,
  type ResolvedCompany,
  type ResolvedJob,
} from './resolve.ts';
export {
  discoverableScrapers,
  getScraper,
  isScraperName,
  Scraper,
  scraperNames,
  scrapers,
  type Job,
  type ListedJob,
  type ParsedUrl,
  type ScraperName,
  type ScraperSubclass,
} from './scrapers/index.ts';
export { JobNotFoundError } from './scrapers/Scraper.ts';
export {
  canSearch,
  clearSearchCache,
  configureSearch,
  getSearchConfig,
  searchForBoards,
  searchForBoardsBatch,
  searchForHomepage,
  type BatchedSearch,
  type SearchConfig,
  type SearchedBoard,
} from './search.ts';
export {
  findBoardsInPage,
  findNamesInPage,
  sniffBoards,
  sniffPage,
  type SniffedBoard,
  type SniffedPage,
} from './sniff.ts';
export { time } from './utils/misc.ts';

/**
 * Lists every job a company currently has posted.
 *
 * Accepts a company name, a careers board URL, or an explicit
 * `{ scraper, slug }` pair. When only a name is given and the company isn't
 * in the registry yet, the known job boards are probed for a matching slug;
 * a match is remembered for next time.
 *
 * @throws {UnresolvedCompanyError} when no scraper serves the company
 *
 * @example
 * await listCompanyJobs('Airbnb');
 * await listCompanyJobs('https://jobs.ashbyhq.com/zapier');
 * await listCompanyJobs({ company: 'Ramp', scraper: 'GreenhouseScraper' });
 */
export async function listCompanyJobs(
  input: CompanyInput | string
): Promise<ListedJob[]> {
  const company = await resolveCompany(input);
  const scraper = createScraper(company);
  try {
    return await scraper.getJobsList();
  } finally {
    scraper.dispose();
  }
}

export interface FetchJobInput extends CompanyInput {
  /** The job's id within its board. Required unless `url` is given */
  id?: string;
}

/**
 * Fetches a single job posting, including its full content.
 *
 * Takes either a job posting URL, or a company (name, or explicit
 * scraper/slug) plus the job's `id`.
 *
 * @throws {UnresolvedCompanyError} when no scraper serves the company
 *
 * @example
 * await fetchJob('https://job-boards.greenhouse.io/airbnb/jobs/7712345');
 * await fetchJob({ company: 'Airbnb', id: '7712345' });
 */
export async function fetchJob(input: FetchJobInput | string): Promise<Job> {
  const options: FetchJobInput =
    typeof input === 'string'
      ? URL.canParse(input)
        ? { url: input }
        : { company: input }
      : input;
  const resolved = await resolveJob(options);
  const id = options.id ?? resolved.jobId;

  if (!id) {
    throw new TypeError(
      `No job id given, and none could be read from '${options.url ?? ''}'`
    );
  }

  const scraper = createScraper(resolved);
  try {
    return await scraper.getJob(id);
  } finally {
    scraper.dispose();
  }
}

export {
  renderScrapedPosting,
  richTextToMarkdown,
  type RenderedPosting,
  type RenderPostingOptions,
} from './render.ts';
export {
  decodeHtmlEntities,
  htmlToMarkdown,
  htmlToText,
  looksLikeEscapedHtml,
  looksLikeHtml,
} from './utils/html.ts';
