import { cachedFetch } from '../cache.ts';
import { buildUrl, time } from '../utils/misc.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

interface LeverJob {
  id: string;
  text: string;
  categories: {
    location?: string;
    allLocations?: string[];
  };
  descriptionPlain: string;
  descriptionBodyPlain: string;
  hostedUrl: string;
  lists: { text: string; content: string }[];
  additionalPlain: string;
}

export default class LeverScraper extends Scraper {
  private jobsCache = new Map<string, LeverJob>();

  static readonly discoverable = true;
  static readonly boardDomains = ['jobs.lever.co'];
  static readonly urlHintParams = ['lever-origin', 'lever-source'];

  static parseUrl(url: URL): ParsedUrl | null {
    if (url.hostname !== 'jobs.lever.co') return null;

    const [slug, id] = url.pathname.split('/').filter(Boolean);
    if (!slug) return null;
    return { slug, jobId: id ?? null };
  }

  jobUrl(id: string): string {
    return `https://jobs.lever.co/${this.companySlug}/${id}`;
  }

  [Symbol.dispose]() {
    // force this out of memory just to be sure
    this.jobsCache.clear();
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const url = buildUrl(
      'https://api.lever.co',
      `/v0/postings/${this.companySlug}`,
      {
        mode: 'json',
        // enough to clear discovery's job threshold, which counts these
        ...(testing ? { limit: 20 } : {}),
      }
    );
    const jobs = (await cachedFetch
      .call({ cache: !testing, cacheTTL: time.day }, url)
      .then((res) => res.json())) as LeverJob[];

    this.jobsCache.clear();
    for (const job of jobs) {
      this.jobsCache.set(job.id, job);
    }

    return jobs.map((job) => ({
      id: job.id,
      url: job.hostedUrl,
      title: job.text,
      location:
        job.categories.allLocations?.join(', ') ??
        job.categories.location ??
        '',
    }));
  }

  async getJobContent(id: string): Promise<string> {
    const job = await this.fromJobsList(this.jobsCache, id);
    // `location` lives nested under `categories` on the raw payload, so
    // surface it at the top level for `readListingFields` to pick up
    return JSON.stringify({
      ...job,
      location:
        job.categories.allLocations?.join(', ') ??
        job.categories.location ??
        '',
    });
  }
}
