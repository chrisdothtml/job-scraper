import { cachedFetch } from '../cache.ts';
import { time } from '../utils/misc.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

interface RipplingListing {
  uuid: string;
  name: string;
  url: string;
  department: { id: string; label: string } | null;
  workLocation: { id: string; label: string } | null;
}

// Rippling's public job board API. The board page itself calls a paginated
// `ats.rippling.com/api/v2` twin, but this one is documented and returns
// every job in a single response
const API_BASE = 'https://api.rippling.com/platform/api/ats/v1/board';

export default class RipplingScraper extends Scraper {
  static readonly discoverable = true;
  static readonly boardDomains = ['ats.rippling.com'];

  // `ats.rippling.com/{slug}/jobs/{id}`, optionally behind a locale segment
  // (`/en-GB/{slug}/jobs`), plus both API hosts
  static parseUrl(url: URL): ParsedUrl | null {
    const segments = url.pathname.split('/').filter(Boolean);

    if (url.hostname === 'api.rippling.com') {
      const board = segments.indexOf('board');
      const slug = board >= 0 ? segments[board + 1] : undefined;
      if (!slug) return null;
      return { slug, jobId: segments[board + 3] ?? null };
    }

    if (url.hostname !== 'ats.rippling.com') return null;

    if (segments[0] === 'api') {
      const board = segments.indexOf('board');
      const slug = board >= 0 ? segments[board + 1] : undefined;
      if (!slug) return null;
      return { slug, jobId: segments[board + 3] ?? null };
    }

    // the slug is whatever comes right before `jobs`
    const jobs = segments.indexOf('jobs');
    const slug = jobs > 0 ? segments[jobs - 1] : segments[0];
    if (!slug) return null;
    return { slug, jobId: jobs > 0 ? (segments[jobs + 1] ?? null) : null };
  }

  jobUrl(id: string): string {
    return `https://ats.rippling.com/${this.companySlug}/jobs/${id}`;
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const jobs = (await cachedFetch
      .call(
        { cache: !testing, cacheTTL: time.day },
        `${API_BASE}/${this.companySlug}/jobs`
      )
      .then((res) => res.json())) as RipplingListing[];

    return jobs.map((job) => ({
      id: job.uuid,
      url: job.url || this.jobUrl(job.uuid),
      title: job.name,
      location: job.workLocation?.label ?? '',
    }));
  }

  async getJobContent(id: string): Promise<string> {
    const res = (await cachedFetch
      .call(
        { cacheTTL: time.day },
        `${API_BASE}/${this.companySlug}/jobs/${id}`
      )
      .then((res) => res.json())) as { workLocations?: string[] };

    // location lives in `workLocations` here, not the `location` key
    // `readListingFields` looks for
    return JSON.stringify({
      ...res,
      location: (res.workLocations ?? []).join(', '),
    });
  }
}
