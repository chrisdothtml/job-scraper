import { cachedFetch } from '../cache.ts';
import { time } from '../utils/misc.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

interface WorkableLocation {
  country: string;
  city: string;
  region: string | null;
}

interface WorkableListedJob {
  shortcode: string;
  title: string;
  remote: boolean;
  location: WorkableLocation;
  locations: WorkableLocation[];
}

interface WorkableJobsResponse {
  total: number;
  results: WorkableListedJob[];
}

function formatLocation(loc: WorkableLocation): string {
  return [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
}

export default class WorkableScraper extends Scraper {
  private baseUrl: string;

  static readonly discoverable = true;
  static readonly boardDomains = ['apply.workable.com'];

  static parseUrl(url: URL): ParsedUrl | null {
    if (url.hostname !== 'apply.workable.com') return null;

    const [slug, j, id] = url.pathname.split('/').filter(Boolean);
    // `/j/{id}` is a short link that names the posting but not the account,
    // so there's no board to resolve
    if (!slug || slug === 'j') return null;

    return { slug, jobId: j === 'j' ? (id ?? null) : null };
  }

  // the account record carries the website the company set in Workable
  static async fetchHomepage(
    slug: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const res = await cachedFetch.call(
      { cacheTTL: time.day },
      `https://apply.workable.com/api/v1/accounts/${slug}`,
      { signal }
    );
    const data = (await res.json()) as { url?: string | null };
    return data.url ?? null;
  }

  jobUrl(id: string): string {
    return `https://apply.workable.com/${this.companySlug}/j/${id}/`;
  }

  constructor(...args: ConstructorParameters<typeof Scraper>) {
    super(...args);
    this.baseUrl = `https://apply.workable.com/api/v3/accounts/${this.companySlug}`;
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const res = (await cachedFetch
      .call({ cache: !testing, cacheTTL: time.day }, `${this.baseUrl}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '',
          department: [],
          location: [],
          workplace: [],
          worktype: [],
        }),
      })
      .then((r) => r.json())) as WorkableJobsResponse;

    return res.results.map((job) => {
      const locations = [job.location, ...job.locations]
        .map(formatLocation)
        .filter(Boolean);

      return {
        id: job.shortcode,
        url: `https://apply.workable.com/${this.companySlug}/j/${job.shortcode}/`,
        title: job.title,
        location: [...new Set(locations)].join(', ') || 'Remote',
      };
    });
  }

  async getJobContent(id: string): Promise<string> {
    const res = (await cachedFetch(
      `https://apply.workable.com/api/v2/accounts/${this.companySlug}/jobs/${id}`
    ).then((res) => res.json())) as WorkableListedJob;

    // `location`/`locations` are structured objects here, not the plain
    // string `readListingFields` looks for
    const locations = [res.location, ...(res.locations ?? [])]
      .map(formatLocation)
      .filter(Boolean);

    return JSON.stringify({
      ...res,
      location: [...new Set(locations)].join(', ') || 'Remote',
    });
  }
}
