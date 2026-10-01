import { cachedFetch } from '../cache.ts';
import { time } from '../utils/misc.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

interface WorkdayJobPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  bulletFields?: string[];
}

interface WorkdayJobsResponse {
  total: number;
  jobPostings: WorkdayJobPosting[];
}

const PAGE_SIZE = 20;

// Workday tenants are split across pods (e.g. wd1, wd5) and each posts jobs
// under a site slug (e.g. "Ext", "careers") that varies per company and
// can't be derived from the tenant name, so the companySlug in companies.ts
// must be the dot-joined `tenant.pod.site`, e.g. "autodesk.wd1.Ext".
export default class WorkdayScraper extends Scraper {
  private baseUrl: string;
  /** The base url format used when deeplinking to a job */
  private deeplinkUrl: string;
  private siteUrl: string;

  // a Workday URL is `https://{tenant}.{pod}.myworkdayjobs.com/[locale/]{site}{externalPath}`
  static readonly boardDomains = ['myworkdayjobs.com'];

  static parseUrl(url: URL): ParsedUrl | null {
    const host = url.hostname.match(/^([^.]+)\.([^.]+)\.myworkdayjobs\.com$/);
    if (!host) return null;

    const [, tenant, pod] = host;
    const segments = url.pathname.split('/').filter(Boolean);
    // some tenants prefix the site with a locale segment
    if (/^[a-z]{2}-[A-Z]{2}$/.test(segments[0] ?? '')) segments.shift();

    const site = segments.shift();
    if (!site) return null;

    const externalPath = segments.length > 0 ? '/' + segments.join('/') : null;
    return { slug: `${tenant}.${pod}.${site}`, jobId: externalPath };
  }

  constructor(...args: ConstructorParameters<typeof Scraper>) {
    super(...args);
    const [tenant, pod, site] = this.companySlug.split('.');
    this.siteUrl = `https://${tenant}.${pod}.myworkdayjobs.com`;
    this.deeplinkUrl = `${this.siteUrl}/${site}`;
    this.baseUrl = `${this.siteUrl}/wday/cxs/${tenant}/${site}`;
  }

  jobUrl(id: string): string {
    return `${this.deeplinkUrl}${id}`;
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const jobs: ListedJob[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const res = (await cachedFetch
        .call({ cache: !testing, cacheTTL: time.day }, `${this.baseUrl}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appliedFacets: {},
            limit: PAGE_SIZE,
            offset,
            searchText: '',
          }),
        })
        .then((res) => res.json())) as WorkdayJobsResponse;

      total = res.total;
      jobs.push(
        ...res.jobPostings.map((job) => ({
          id: job.externalPath,
          url: `${this.deeplinkUrl}${job.externalPath}`,
          title: job.title,
          // some tenants omit `locationsText`; the last bullet field is
          // consistently the most specific location in that case
          location: job.locationsText ?? job.bulletFields?.at(-1) ?? '',
        }))
      );

      if (testing) break;
      offset += PAGE_SIZE;
    }

    return jobs;
  }

  async getJobContent(id: string): Promise<string> {
    const res = (await cachedFetch(`${this.baseUrl}${id}`).then((res) =>
      res.json()
    )) as {
      jobPostingInfo: {
        title: string;
        location: string;
        additionalLocations?: string[];
      };
    };
    const info = res.jobPostingInfo;

    // title/location live nested under `jobPostingInfo` here, not at the
    // top level `readListingFields` looks for
    return JSON.stringify({
      ...res,
      title: info.title,
      location: [info.location, ...(info.additionalLocations ?? [])].join(', '),
    });
  }
}
