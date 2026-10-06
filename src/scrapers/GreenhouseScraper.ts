import { cachedFetch } from '../cache.ts';
import { time } from '../utils/misc.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

export interface GreenhouseListedJob {
  absolute_url: string;
  id: number;
  title: string;
  location: { name: string };
  metadata?: { name: string; value: string | string[] }[];
}

export interface GreenhouseJobList {
  jobs: GreenhouseListedJob[];
}

export default class GreenhouseScraper extends Scraper {
  private baseUrl: string;

  static readonly discoverable = true;
  // both the legacy `boards.` and current `job-boards.` hosts stay in service,
  // and embedded boards link back through them with a `gh_jid` query param
  static readonly boardDomains = [
    'boards.greenhouse.io',
    'job-boards.greenhouse.io',
  ];
  static readonly urlHintParams = ['gh_jid', 'gh_src'];

  static parseUrl(url: URL): ParsedUrl | null {
    if (!/^(boards|job-boards|boards-api)\.greenhouse\.io$/.test(url.hostname))
      return null;

    const segments = url.pathname.split('/').filter(Boolean);

    // the embed script a company drops on its own careers page names the
    // board in a query param rather than the path
    if (segments[0] === 'embed') {
      const slug = url.searchParams.get('for');
      return slug ? { slug, jobId: url.searchParams.get('gh_jid') } : null;
    }

    // the API host prefixes the slug with `v1/boards`
    if (segments[0] === 'v1' && segments[1] === 'boards') segments.splice(0, 2);

    const [slug, jobs, id] = segments;
    if (!slug) return null;

    const jobId =
      jobs === 'jobs' ? (id ?? null) : url.searchParams.get('gh_jid');
    return { slug, jobId };
  }

  // the hosted board embeds its settings, including where the logo links;
  // companies that set one point it at their own site (often its careers
  // path, which `resolveHomepage` trims to the origin)
  static async fetchHomepage(
    slug: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const res = await cachedFetch.call(
      { cacheTTL: time.day },
      `https://job-boards.greenhouse.io/${slug}`,
      { signal }
    );
    const html = await res.text();
    return /"logo":\{"href":"([^"]+)"/.exec(html)?.[1] ?? null;
  }

  jobUrl(id: string): string {
    return `https://job-boards.greenhouse.io/${this.companySlug}/jobs/${id}`;
  }

  constructor(...args: ConstructorParameters<typeof Scraper>) {
    super(...args);
    this.baseUrl = `https://boards-api.greenhouse.io/v1/boards/${this.companySlug}/jobs`;
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const res = (await cachedFetch
      .call({ cache: !testing, cacheTTL: time.day }, this.baseUrl)
      .then((res) => res.json())) as GreenhouseJobList;

    return res.jobs.map((job) => {
      let location = job.location.name;
      if (Array.isArray(job.metadata)) {
        const secLocation = job.metadata.find(
          (m) => m.name === 'Job Posting Location'
        );

        if (secLocation?.value) {
          location += ' - ';
          location += Array.isArray(secLocation.value)
            ? secLocation.value.join(', ')
            : secLocation.value;
        }
      }

      return {
        id: job.id.toString(),
        url: job.absolute_url,
        title: job.title,
        location,
      };
    });
  }

  async getJobContent(id: string): Promise<string> {
    const res = await cachedFetch(`${this.baseUrl}/${id}`).then((res) =>
      res.json()
    );
    return JSON.stringify(res);
  }
}
