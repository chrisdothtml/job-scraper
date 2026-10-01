import { cachedFetch } from '../cache.ts';
import { time } from '../utils/misc.ts';
import { Scraper, type ListedJob, type ParsedUrl } from './Scraper.ts';

const BASE_URL = 'https://www.shopify.com';

// Shopify careers uses React Router 7 SSR with turbo-stream encoding.
// All job data is embedded in a single streamController.enqueue() call as a
// flat reference array. Strings, numbers, and objects are stored by index,
// with encoded objects using {"_K": V} where K is the key's index in the array
// and V is the value's index (or -5 for null).
function parseTurboStreamArray(html: string): any[] {
  const match = html.match(/streamController\.enqueue\("((?:[^"\\]|\\.)*)"\)/);
  if (!match) throw new Error('Could not find turbo-stream data in page');
  return JSON.parse(JSON.parse('"' + match[1] + '"')) as any[];
}

function decodeStreamObj(
  arr: any[],
  obj: Record<string, number>
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [kStr, vIdx] of Object.entries(obj) as [string, number][]) {
    const key = arr[parseInt(kStr.slice(1))];
    if (typeof key !== 'string') continue;
    result[key] = vIdx === -5 ? null : arr[vIdx];
  }
  return result;
}

export default class ShopifyScraper extends Scraper {
  static parseUrl(url: URL): ParsedUrl | null {
    if (url.hostname !== 'www.shopify.com') return null;
    const match = url.pathname.match(/^\/careers\/?(?:[^/]*_)?([^/_]*)/);
    if (!match) return null;
    return { slug: 'shopify', jobId: match[1] || null };
  }

  jobUrl(id: string): string {
    return `${BASE_URL}/careers/x_${id}`;
  }

  /**
   * The data returned by fetching a single job by ID doesn't include
   * the full job info (e.g. it has the job description but not the
   * location), but when we fetch all the jobs, we do have access to
   * the missing info (but not the description). So we cache this info
   * to supplement the individual job when it's fetched
   */
  private jobPostingsById = new Map<string, Record<string, unknown>>();

  async getJobsList(testing = false): Promise<ListedJob[]> {
    const html = await cachedFetch
      .call({ cache: !testing, cacheTTL: time.day }, `${BASE_URL}/careers`)
      .then((r) => r.text());

    const arr = parseTurboStreamArray(html);

    const jpwjIdx = arr.findIndex((v) => v === 'jobPostingsWithJobs');
    if (jpwjIdx === -1)
      throw new Error('Could not find jobPostingsWithJobs in page data');

    const jobIndices = arr[jpwjIdx + 1] as number[];
    const limit = testing ? 1 : jobIndices.length;
    const jobs: ListedJob[] = [];

    for (let i = 0; i < limit; i++) {
      const jobEntry = arr[jobIndices[i]] as Record<string, number>;

      // Find the jobPosting field within the entry
      let jpIdx = -1;
      for (const [kStr, vIdx] of Object.entries(jobEntry) as [
        string,
        number,
      ][]) {
        if (arr[parseInt(kStr.slice(1))] === 'jobPosting') {
          jpIdx = vIdx;
          break;
        }
      }
      if (jpIdx === -1) continue;

      const jp = decodeStreamObj(arr, arr[jpIdx] as Record<string, number>);
      const locationName = jp.locationName as string | null;
      const workplaceType = jp.workplaceType as string | null;
      const id = jp.id as string;

      const location = [workplaceType, locationName]
        .filter(Boolean)
        .join(' - ');
      this.jobPostingsById.set(id, { ...jp, location });
      jobs.push({
        id,
        url: `${BASE_URL}/careers/x_${jp.id}`,
        title: jp.title as string,
        location,
      });
    }

    return jobs;
  }

  async getJobContent(id: string): Promise<string> {
    const jobPosting = await this.fromJobsList(this.jobPostingsById, id);
    const html = await cachedFetch
      .call({ cacheTTL: time.day }, `${BASE_URL}/careers/x_${id}`)
      .then((r) => r.text());

    const arr = parseTurboStreamArray(html);
    // In the flat array, jobPosting fields appear in order: id, title, descriptionPlain, ...
    const descIdx = arr.findIndex((v) => v === 'descriptionPlain');
    if (descIdx === -1)
      throw new Error(`Could not find description for job ${id}`);

    return JSON.stringify({
      ...jobPosting,
      id,
      title: arr[descIdx - 1] as string,
      descriptionPlain: arr[descIdx + 1] as string,
    });
  }
}
