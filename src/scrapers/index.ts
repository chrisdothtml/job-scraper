import AshbyScraper from './AshbyScraper.ts';
import GitHubScraper from './GitHubScraper.ts';
import GoogleScraper from './GoogleScraper.ts';
import GreenhouseScraper from './GreenhouseScraper.ts';
import LeverScraper from './LeverScraper.ts';
import NetflixScraper from './NetflixScraper.ts';
import NvidiaScraper from './NvidiaScraper.ts';
import RipplingScraper from './RipplingScraper.ts';
import { type ScraperSubclass } from './Scraper.ts';
import ShopifyScraper from './ShopifyScraper.ts';
import SmartRecruitersScraper from './SmartRecruitersScraper.ts';
import UberScraper from './UberScraper.ts';
import WorkableScraper from './WorkableScraper.ts';
import WorkdayScraper from './WorkdayScraper.ts';

/**
 * Every scraper this package ships. Ordered by how widely the board is used,
 * which is the order company discovery probes them in.
 */
export const scrapers = {
  GreenhouseScraper,
  AshbyScraper,
  LeverScraper,
  WorkableScraper,
  SmartRecruitersScraper,
  RipplingScraper,
  WorkdayScraper,
  GitHubScraper,
  GoogleScraper,
  NetflixScraper,
  NvidiaScraper,
  ShopifyScraper,
  UberScraper,
} satisfies Record<string, ScraperSubclass>;

export type ScraperName = keyof typeof scrapers;

export const scraperNames = Object.keys(scrapers) as ScraperName[];

export function isScraperName(name: string): name is ScraperName {
  return Object.hasOwn(scrapers, name);
}

export function getScraper(name: string): ScraperSubclass {
  if (!isScraperName(name)) throw new Error(`Unknown scraper: ${name}`);
  return scrapers[name];
}

/** The scrapers whose board slugs can be guessed from a company name */
export const discoverableScrapers = scraperNames.filter(
  (name) => scrapers[name].discoverable
);

export {
  Scraper,
  type Job,
  type ListedJob,
  type ParsedUrl,
  type ScraperSubclass,
} from './Scraper.ts';
