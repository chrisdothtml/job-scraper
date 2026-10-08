import {
  createScraper,
  resolveCompany,
  resolveJob,
  type CompanyInput,
} from './discovery/resolve.ts';
import { type Job, type ListedJob } from './scrapers/Scraper.ts';

/**
 * Lists every job a company currently has posted.
 *
 * Accepts a company name, a careers board URL, or an explicit
 * `{ scraper, slug }` pair. When only a name is given and the company isn't
 * in the registry yet, the known job boards are probed for a matching slug;
 * a match is remembered for next time.
 *
 * @throws {UnresolvedCompanyError} when no scraper serves the company
 *
 * @example
 * await listCompanyJobs('Airbnb');
 * await listCompanyJobs('https://jobs.ashbyhq.com/zapier');
 * await listCompanyJobs({ company: 'Ramp', scraper: 'GreenhouseScraper' });
 */
export async function listCompanyJobs(
  input: CompanyInput | string
): Promise<ListedJob[]> {
  const company = await resolveCompany(input);
  const scraper = createScraper(company);
  try {
    return await scraper.getJobsList();
  } finally {
    scraper.dispose();
  }
}

export interface FetchJobInput extends CompanyInput {
  /** The job's id within its board. Required unless `url` is given */
  id?: string;
}

/**
 * Fetches a single job posting, including its full content.
 *
 * Takes either a job posting URL, or a company (name, or explicit
 * scraper/slug) plus the job's `id`.
 *
 * @throws {UnresolvedCompanyError} when no scraper serves the company
 *
 * @example
 * await fetchJob('https://job-boards.greenhouse.io/airbnb/jobs/7712345');
 * await fetchJob({ company: 'Airbnb', id: '7712345' });
 */
export async function fetchJob(input: FetchJobInput | string): Promise<Job> {
  const options: FetchJobInput =
    typeof input === 'string'
      ? URL.canParse(input)
        ? { url: input }
        : { company: input }
      : input;
  const resolved = await resolveJob(options);
  const id = options.id ?? resolved.jobId;

  if (!id) {
    throw new TypeError(
      `No job id given, and none could be read from '${options.url ?? ''}'`
    );
  }

  const scraper = createScraper(resolved);
  try {
    return await scraper.getJob(id);
  } finally {
    scraper.dispose();
  }
}
