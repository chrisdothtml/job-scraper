import { cachedFetch } from '../cache.ts';
import { buildUrl, time } from '../utils.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

const BASE_URL = 'https://www.github.careers';
const PAGE_SIZE = 100;

interface GitHubJobData {
  slug: string;
  title: string;
  description: string;
  full_location: string;
  location_name: string;
  country: string;
  categories: string[];
  qualifications: string;
  responsibilities: string;
  salary_min_value: number | null;
  salary_max_value: number | null;
  employment_type: string;
  posted_date: string;
  apply_url: string;
}

interface GitHubJobsResponse {
  jobs: Array<{ data: GitHubJobData }>;
  totalCount: number;
}

export default class GitHubScraper extends Scraper {
  static parseUrl(url: URL): ParsedUrl | null {
    if (url.hostname !== 'www.github.careers') return null;
    const match = url.pathname.match(/^\/careers-home\/jobs\/([^/]+)/);
    return { slug: 'github', jobId: match?.[1] ?? null };
  }

  jobUrl(id: string): string {
    return `${BASE_URL}/careers-home/jobs/${id}?lang=en-us`;
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const jobs: ListedJob[] = [];
    let page = 1;

    paginateLoop: while (true) {
      const url = buildUrl(BASE_URL, '/api/jobs', {
        page,
        sortBy: 'relevance',
        descending: false,
        internal: false,
        limit: testing ? 1 : PAGE_SIZE,
      });
      const data = (await cachedFetch
        .call({ cache: !testing, cacheTTL: time.day }, url)
        .then((r) => r.json())) as GitHubJobsResponse;

      for (const { data: job } of data.jobs) {
        jobs.push({
          id: job.slug,
          url: `${BASE_URL}/careers-home/jobs/${job.slug}?lang=en-us`,
          title: job.title,
          location: job.full_location || job.location_name || job.country,
        });
        if (testing) break paginateLoop;
      }

      if (jobs.length >= data.totalCount || data.jobs.length === 0) break;
      page++;
    }

    return jobs;
  }

  async getJobContent(id: string): Promise<string> {
    const url = buildUrl(BASE_URL, '/api/jobs', {
      page: 1,
      sortBy: 'relevance',
      descending: false,
      internal: false,
      limit: 1,
      req_id: id,
    });
    const data = (await cachedFetch
      .call({ cacheTTL: time.day }, url)
      .then((r) => r.json())) as GitHubJobsResponse;
    return JSON.stringify(data.jobs[0]?.data ?? {});
  }
}
