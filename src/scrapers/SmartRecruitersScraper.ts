import { cachedFetch } from '../cache.ts';
import { time } from '../utils/misc.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

interface SmartRecruitersLocation {
  city: string;
  region: string;
  country: string;
  fullLocation: string;
}

interface SmartRecruitersPosting {
  id: string;
  name: string;
  location: SmartRecruitersLocation;
}

interface SmartRecruitersPostingsResponse {
  offset: number;
  limit: number;
  totalFound: number;
  content: SmartRecruitersPosting[];
}

export default class SmartRecruitersScraper extends Scraper {
  private baseUrl: string;

  static readonly discoverable = true;
  static readonly boardDomains = ['jobs.smartrecruiters.com'];

  // SmartRecruiters slugs are PascalCase with no separators, so the shared
  // lowercase candidates never match
  static slugCandidates(companyName: string): string[] {
    const words = companyName
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);

    if (words.length === 0) return [];
    return [
      ...new Set([
        words.map((w) => w[0].toUpperCase() + w.slice(1)).join(''),
        words.join(''),
      ]),
    ];
  }

  static parseUrl(url: URL): ParsedUrl | null {
    if (!/(^|\.)smartrecruiters\.com$/.test(url.hostname)) return null;

    const [slug, id] = url.pathname.split('/').filter(Boolean);
    if (!slug) return null;
    return { slug, jobId: id ?? null };
  }

  // the hosted careers page links back to the company's site from its nav
  static async fetchHomepage(
    slug: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const res = await cachedFetch.call(
      { cacheTTL: time.day },
      `https://careers.smartrecruiters.com/${slug}`,
      { signal }
    );
    const html = await res.text();
    return (
      /<a[^>]+href=["']([^"']+)["'][^>]*>\s*Home Page\s*<\/a>/i.exec(
        html
      )?.[1] ?? null
    );
  }

  jobUrl(id: string): string {
    return `https://jobs.smartrecruiters.com/${this.companySlug}/${id}`;
  }

  constructor(...args: ConstructorParameters<typeof Scraper>) {
    super(...args);
    this.baseUrl = `https://api.smartrecruiters.com/v1/companies/${this.companySlug}/postings`;
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const postings: SmartRecruitersPosting[] = [];
    let offset = 0;

    while (true) {
      const res = (await cachedFetch
        .call(
          { cache: !testing, cacheTTL: time.day },
          `${this.baseUrl}?offset=${offset}`
        )
        .then((r) => r.json())) as SmartRecruitersPostingsResponse;

      postings.push(...res.content);
      if (testing || postings.length >= res.totalFound) break;
      offset += res.limit;
    }

    return postings.map((posting) => ({
      id: posting.id,
      url: `https://jobs.smartrecruiters.com/${this.companySlug}/${posting.id}`,
      title: posting.name,
      location: posting.location.fullLocation,
    }));
  }

  async getJobContent(id: string): Promise<string> {
    const res = (await cachedFetch(`${this.baseUrl}/${id}`).then((res) =>
      res.json()
    )) as SmartRecruitersPosting;

    // `location` is a structured object here, not the plain string
    // `readListingFields` looks for
    return JSON.stringify({ ...res, location: res.location.fullLocation });
  }
}
