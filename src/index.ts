export {
  clearCache,
  configureCache,
  CorsError,
  getCacheConfig,
  HttpError,
  type CacheConfig,
} from './cache.ts';
export { seedCompanies } from './companies/seed.ts';
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
} from './companies/registry.ts';
export {
  findHomepage,
  resolveHomepage,
  type FoundHomepage,
  type HomepageOptions,
  type HomepageSource,
} from './discovery/homepage.ts';
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
} from './discovery/resolve.ts';
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
} from './discovery/search.ts';
export {
  findBoardsInPage,
  findNamesInPage,
  sniffBoards,
  sniffPage,
  type SniffedBoard,
  type SniffedPage,
} from './discovery/sniff.ts';
export { time } from './utils/misc.ts';

export { listCompanyJobs, fetchJob, type FetchJobInput } from './jobs.ts';

export {
  renderScrapedPosting,
  richTextToMarkdown,
  type RenderedPosting,
  type RenderPostingOptions,
} from './rendering/posting.ts';
export {
  decodeHtmlEntities,
  htmlToMarkdown,
  htmlToText,
  looksLikeEscapedHtml,
  looksLikeHtml,
} from './rendering/utils/html.ts';
