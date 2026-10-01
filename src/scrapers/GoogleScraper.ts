import { cachedFetch } from '../cache.ts';
import { time } from '../utils/misc.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

const BASE_URL =
  'https://www.google.com/about/careers/applications/jobs/results';

type JobData = [
  id: string,
  title: string,
  applyUrl: string,
  responsibilities: [null, string],
  qualifications: [null, string],
  tenantPath: string,
  unknown: null,
  company: string,
  locale: string,
  locations: [string, string[], string, string | null, string, string][],
  description: [null, string],
  ...unknown: unknown[],
];

type ListPageData = [
  jobs: JobData[],
  null: null,
  total: number,
  pageSize: number,
];

function parseCallbackData(html: string, key: string): unknown {
  const callbackIdx = html.indexOf(`AF_initDataCallback({key: '${key}'`);
  if (callbackIdx === -1) throw new Error(`Missing ${key} callback in page`);
  const dataIdx = html.indexOf('data:', callbackIdx);
  if (dataIdx === -1) throw new Error(`Missing data field in ${key} callback`);
  const start = dataIdx + 'data:'.length;
  const end = html.indexOf(', sideChannel:', start);
  if (end === -1)
    throw new Error(`Missing sideChannel sentinel in ${key} callback`);
  return JSON.parse(html.slice(start, end));
}

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default class GoogleScraper extends Scraper {
  static parseUrl(url: URL): ParsedUrl | null {
    if (url.hostname !== 'www.google.com') return null;
    const match = url.pathname.match(
      /^\/about\/careers\/applications\/jobs\/results\/?([^/]*)/
    );
    if (!match) return null;
    return { slug: 'google', jobId: match[1] || null };
  }

  jobUrl(id: string): string {
    return `${BASE_URL}/${id}`;
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const jobs: ListedJob[] = [];
    let page = 1;

    while (true) {
      const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/?page=${page}`;
      const html = await cachedFetch
        .call({ cache: !testing, cacheTTL: time.day }, url)
        .then((r) => r.text());

      const data = parseCallbackData(html, 'ds:1') as ListPageData;
      const pageJobs = data[0];
      const total = data[2];

      for (const job of pageJobs) {
        const slug = `${job[0]}-${titleToSlug(job[1])}`;
        const locations = (job[9] ?? []).map((l) => l[0]);
        jobs.push({
          id: slug,
          title: job[1],
          location: locations.join(', '),
          url: `${BASE_URL}/${slug}`,
        });
        if (testing) return jobs;
      }

      if (jobs.length >= total) break;
      page++;
    }

    return jobs;
  }

  async getJobContent(id: string): Promise<string> {
    const url = `${BASE_URL}/${id}`;
    const html = await cachedFetch
      .call({ cacheTTL: time.day }, url)
      .then((r) => r.text());

    const data = parseCallbackData(html, 'ds:0') as [JobData];
    const job = data[0];
    const locations = (job[9] ?? []).map((l) => l[0]);

    // the raw payload is a positional tuple, not an object with the keys
    // `readListingFields` looks for
    return JSON.stringify({
      data: job,
      title: job[1],
      location: locations.join(', '),
      url,
    });
  }
}
