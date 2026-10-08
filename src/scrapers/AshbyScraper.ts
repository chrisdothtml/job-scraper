import { cachedFetch, HttpError } from '../cache.ts';
import { time } from '../utils.ts';
import {
  BoardShapeError,
  JobNotFoundError,
  Scraper,
  type ListedJob,
  type ParsedUrl,
} from './Scraper.ts';

interface AshbyAddress {
  postalAddress: {
    addressLocality: string;
    addressRegion: string;
    addressCountry: string;
  };
}

interface AshbySecondaryLocation {
  location: string;
  address: AshbyAddress | null;
}

interface AshbyPosting {
  id: string;
  title: string;
  department: string;
  team: string;
  employmentType: string;
  location: string;
  secondaryLocations: AshbySecondaryLocation[];
  isListed: boolean;
  isRemote: boolean | null;
  workplaceType: string | null;
  jobUrl: string;
  descriptionPlain: string;
  compensation: unknown;
}

interface AshbyJobBoard {
  jobs: AshbyPosting[];
}

// the shape of `window.__appData` embedded in a hosted board page, used as a
// fallback for orgs that have disabled the public posting-api but still
// serve the page itself
interface AshbyAppDataListing {
  jobBoard: {
    jobPostings: {
      id: string;
      title: string;
      locationName: string;
      secondaryLocations?: { locationName: string }[];
    }[];
  };
}

interface AshbyAppDataDetail {
  posting: {
    id: string;
    title: string;
    descriptionHtml: string;
    locationName: string;
    secondaryLocationNames?: string[];
  };
}

function formatAddress(sec: AshbySecondaryLocation): string {
  if (!sec.address) return sec.location;
  const { addressLocality, addressCountry } = sec.address.postalAddress;
  return (
    [addressLocality, addressCountry].filter(Boolean).join(', ') || sec.location
  );
}

/**
 * Pulls the `window.__appData = {...}` object out of a hosted board page.
 * It's JSON.stringify output inlined into a `<script>` tag, so braces inside
 * strings are always escaped and can't unbalance a depth count; that makes
 * bracket-matching safe here in a way it wouldn't be for hand-written JS.
 */
function extractAppData(
  html: string,
  scraperName: string,
  slug: string
): unknown {
  const marker = 'window.__appData = ';
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new BoardShapeError(
      scraperName,
      slug,
      `page loaded but '${marker.trim()}' wasn't found in it`
    );
  }

  let depth = 0;
  let end = -1;
  for (let i = start + marker.length; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end === -1) {
    throw new BoardShapeError(
      scraperName,
      slug,
      'found the app data marker, but its object never closed'
    );
  }

  try {
    return JSON.parse(html.slice(start + marker.length, end));
  } catch {
    throw new BoardShapeError(
      scraperName,
      slug,
      'found the app data marker, but its content is not valid JSON'
    );
  }
}

// `jobBoard`/`posting` being explicitly `null` is Ashby's own way of saying
// "no such org" or "no such job", for a page that otherwise loads fine (200,
// well-formed app data). Callers check for that themselves before calling
// these, so anything reaching these asserts and still not matching really is
// an unexpected shape, not a plain miss.

function isNullField(data: unknown, key: string): boolean {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>)[key] === null
  );
}

function assertListingShape(
  data: unknown,
  scraperName: string,
  slug: string
): asserts data is AshbyAppDataListing {
  const jobBoard = (data as { jobBoard?: unknown })?.jobBoard;
  const jobPostings = (jobBoard as { jobPostings?: unknown })?.jobPostings;

  if (
    !jobBoard ||
    typeof jobBoard !== 'object' ||
    !Array.isArray(jobPostings) ||
    !jobPostings.every(
      (job) =>
        job && typeof job.id === 'string' && typeof job.title === 'string'
    )
  ) {
    throw new BoardShapeError(
      scraperName,
      slug,
      'app data no longer has the expected `jobBoard.jobPostings[]` shape'
    );
  }
}

function assertDetailShape(
  data: unknown,
  scraperName: string,
  slug: string
): asserts data is AshbyAppDataDetail {
  const posting = (data as { posting?: unknown })?.posting as
    | Record<string, unknown>
    | undefined;

  if (
    !posting ||
    typeof posting !== 'object' ||
    typeof posting.id !== 'string' ||
    typeof posting.title !== 'string' ||
    typeof posting.descriptionHtml !== 'string'
  ) {
    throw new BoardShapeError(
      scraperName,
      slug,
      'app data no longer has the expected `posting` shape'
    );
  }
}

export default class AshbyScraper extends Scraper {
  private jobsCache = new Map<string, AshbyPosting>();
  // set once getJobsList has had to fall back, so getJobContent knows not
  // to expect the API-shaped cache above to ever fill
  private usingFallback = false;

  static readonly discoverable = true;
  static readonly boardDomains = ['jobs.ashbyhq.com'];
  static readonly urlHintParams = ['ashby_jid'];

  static parseUrl(url: URL): ParsedUrl | null {
    if (url.hostname !== 'jobs.ashbyhq.com') return null;

    const [slug, id] = url.pathname.split('/').filter(Boolean);
    if (!slug) return null;
    return { slug, jobId: id ?? null };
  }

  // the organization record behind the hosted board holds the website the
  // company entered in Ashby's settings
  static async fetchHomepage(
    slug: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const query =
      'query Org($name: String!) { organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $name, searchContext: JobBoard) { publicWebsite } }';
    const res = await cachedFetch.call(
      { cacheTTL: time.day },
      'https://jobs.ashbyhq.com/api/non-user-graphql?op=Org',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { name: slug } }),
        signal,
      }
    );
    const data = (await res.json()) as {
      data?: { organization?: { publicWebsite?: string | null } | null };
    };
    return data.data?.organization?.publicWebsite ?? null;
  }

  jobUrl(id: string): string {
    return `https://jobs.ashbyhq.com/${this.companySlug}/${id}`;
  }

  dispose() {
    this.jobsCache.clear();
  }

  async getJobsList(testing = false): Promise<ListedJob[]> {
    try {
      return await this.getJobsListViaApi(testing);
    } catch (err) {
      // only a missing board falls back; any other failure (network, rate
      // limit, a genuine 5xx) should surface as itself
      if (!(err instanceof HttpError) || err.status !== 404) throw err;
      return this.getJobsListViaAppData(testing);
    }
  }

  private async getJobsListViaApi(testing: boolean): Promise<ListedJob[]> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${this.companySlug}?includeCompensation=true`;
    const res = (await cachedFetch
      .call({ cache: !testing, cacheTTL: time.day }, url)
      .then((r) => r.json())) as AshbyJobBoard;

    this.jobsCache.clear();
    for (const posting of res.jobs) {
      this.jobsCache.set(posting.id, posting);
    }

    return res.jobs.map((posting) => {
      const locations = [posting.location];
      for (const sec of posting.secondaryLocations) {
        const loc = formatAddress(sec);
        if (loc && !locations.includes(loc)) locations.push(loc);
      }
      return {
        id: posting.id,
        url: posting.jobUrl,
        title: posting.title,
        location: locations.join(', '),
      };
    });
  }

  // some orgs disable the public posting-api but still serve the hosted
  // page, which server-renders the same data into `window.__appData`
  private async getJobsListViaAppData(testing: boolean): Promise<ListedJob[]> {
    const url = `https://jobs.ashbyhq.com/${this.companySlug}`;
    const res = await cachedFetch.call(
      { cache: !testing, cacheTTL: time.day },
      url
    );
    const html = await res.text();
    const data = extractAppData(html, this.constructor.name, this.companySlug);

    this.usingFallback = true;
    this.jobsCache.clear();

    // a page that loads fine but explicitly says there's no board here
    // (rather than an unexpected shape) is a plain miss, same as the API's
    // own 404 for an unknown slug
    if (isNullField(data, 'jobBoard')) return [];

    assertListingShape(data, this.constructor.name, this.companySlug);

    return data.jobBoard.jobPostings.map((posting) => {
      const locations = [posting.locationName];
      for (const sec of posting.secondaryLocations ?? []) {
        if (sec.locationName && !locations.includes(sec.locationName)) {
          locations.push(sec.locationName);
        }
      }
      return {
        id: posting.id,
        url: this.jobUrl(posting.id),
        title: posting.title,
        location: locations.filter(Boolean).join(', '),
      };
    });
  }

  async getJobContent(id: string): Promise<string> {
    // whether the API works or not is only known once a listing has been
    // fetched at least once on this instance; `fetchJob` builds a fresh
    // scraper per call, so this can't assume `getJobsList` already ran
    if (this.jobsCache.size === 0 && !this.usingFallback) {
      await this.getJobsList();
    }

    if (!this.usingFallback) {
      return JSON.stringify(await this.fromJobsList(this.jobsCache, id));
    }

    const url = this.jobUrl(id);
    let res;
    try {
      res = await cachedFetch.call({ cacheTTL: time.day }, url);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        throw new JobNotFoundError(id, this.companySlug);
      }
      throw err;
    }
    const html = await res.text();
    const data = extractAppData(html, this.constructor.name, this.companySlug);

    // same as the listing page: a page that loads fine but explicitly says
    // there's no such posting is a plain miss, not a shape mismatch
    if (isNullField(data, 'posting')) {
      throw new JobNotFoundError(id, this.companySlug);
    }

    assertDetailShape(data, this.constructor.name, this.companySlug);

    const { posting } = data;
    const location = [
      posting.locationName,
      ...(posting.secondaryLocationNames ?? []),
    ]
      .filter(Boolean)
      .join(', ');

    // key names match what `readListingFields` (Scraper.ts) already looks
    // for, so `getJob()` picks up title/location/url without a scraper-side
    // override
    return JSON.stringify({
      title: posting.title,
      location,
      jobUrl: url,
      descriptionHtml: posting.descriptionHtml,
    });
  }
}
