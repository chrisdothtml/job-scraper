import { cachedFetch } from '../cache.ts';
import { time } from '../utils/misc.ts';
import {
  JobNotFoundError,
  Scraper,
  type ListedJob,
  type ParsedUrl,
} from './Scraper.ts';

// Uber's public careers site (jobs.uber.com) is a Next.js frontend over
// Oracle Fusion Recruiting Cloud, whose REST API is reachable directly with
// no auth or cookies, but the pod host and site number are Uber-specific
// and can't be derived from anything else, so this scraper stays bespoke.
const ORACLE_HOST = 'iaziqy.fa.ocs.oraclecloud.com';
const SITE_NUMBER = 'CX_1';
const PAGE_SIZE = 200;

interface OracleLocation {
  Name: string;
}

interface OracleRequisition {
  Id: string;
  Title: string;
  PrimaryLocation: string | null;
  secondaryLocations?: OracleLocation[] | null;
}

interface OracleSearchResult {
  TotalJobsCount: number;
  requisitionList: OracleRequisition[];
}

interface OracleSearchResponse {
  items: OracleSearchResult[];
}

interface OracleDetailResponse {
  items: Record<string, unknown>[];
}

function jobLocation(job: OracleRequisition): string {
  const locations = [
    job.PrimaryLocation,
    ...(job.secondaryLocations ?? []).map((l) => l.Name),
  ].filter((l): l is string => Boolean(l));
  return [...new Set(locations)].join(', ');
}

export default class UberScraper extends Scraper {
  static parseUrl(url: URL): ParsedUrl | null {
    if (url.hostname !== 'jobs.uber.com') return null;
    const match = url.pathname.match(/^\/[a-z]{2}\/jobs\/([^/]+)\/?$/);
    if (!match || !match[1]) return { slug: 'uber', jobId: null };
    return { slug: 'uber', jobId: match[1] };
  }

  jobUrl(id: string): string {
    return `https://jobs.uber.com/en/jobs/${id}/`;
  }

  /**
   * The per-job detail endpoint doesn't include the location, so we cache
   * the listing fields when we have them (from `getJobsList`) and attach
   * them to the individual job when it's fetched.
   */
  private jobsById = new Map<string, ListedJob>();

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const jobs: ListedJob[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const url = new URL(
        `https://${ORACLE_HOST}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
      );
      url.searchParams.set('onlyData', 'true');
      url.searchParams.set('expand', 'requisitionList.secondaryLocations');
      url.searchParams.set(
        'finder',
        `findReqs;siteNumber=${SITE_NUMBER},limit=${testing ? 1 : PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`
      );

      const res = (await cachedFetch
        .call({ cache: !testing, cacheTTL: time.day }, url.toString(), {
          headers: { Accept: 'application/json' },
        })
        .then((res) => res.json())) as OracleSearchResponse;

      const result = res.items[0];
      total = result?.TotalJobsCount ?? 0;

      for (const job of result?.requisitionList ?? []) {
        const listedJob: ListedJob = {
          id: job.Id,
          title: job.Title,
          location: jobLocation(job),
          url: this.jobUrl(job.Id),
        };
        this.jobsById.set(listedJob.id, listedJob);
        jobs.push(listedJob);
      }

      if (testing) break;
      offset += PAGE_SIZE;
    }

    return jobs;
  }

  async getJobContent(id: string): Promise<string> {
    const url = new URL(
      `https://${ORACLE_HOST}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`
    );
    url.searchParams.set('expand', 'all');
    url.searchParams.set('finder', `ById;Id="${id}",siteNumber=${SITE_NUMBER}`);

    const res = (await cachedFetch(url.toString(), {
      headers: { Accept: 'application/json' },
    }).then((res) => res.json())) as OracleDetailResponse;

    const job = res.items[0];
    if (!job) throw new JobNotFoundError(id, this.companySlug);

    // the detail endpoint doesn't include location, so pull it from the
    // listing cache when we have it; a job can still have detail after
    // falling off the active list, so this is best-effort, not required
    if (this.jobsById.size === 0) await this.getJobsList();
    const listedJob = this.jobsById.get(id);

    return JSON.stringify({
      ...job,
      ...(listedJob && {
        title: listedJob.title,
        location: listedJob.location,
        url: listedJob.url,
      }),
    });
  }
}
