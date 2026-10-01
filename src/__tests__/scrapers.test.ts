import assert from 'node:assert';
import process from 'node:process';
import { test } from 'node:test';
import { seedCompanies } from '../companies.seed.ts';
import { normalizeCompanyName } from '../companies.ts';
import {
  boardHints,
  companyNameCandidates,
  companyNameFromUrl,
  jobIdFromUrl,
  parseJobUrl,
} from '../resolve.ts';
import { getScraper, scraperNames, scrapers } from '../scrapers/index.ts';
import {
  JobNotFoundError,
  Scraper,
  type ListedJob,
} from '../scrapers/Scraper.ts';
import { configureSearch, getSearchConfig } from '../search.ts';
import { findBoardsInPage, findNamesInPage } from '../sniff.ts';

// hand-picked so that every scraper is exercised at least once
const TEST_COMPANIES = [
  'Airbnb',
  'AppLovin',
  'Arcadia',
  'Block',
  'Canva',
  'CrewAI',
  'GitHub',
  'Netflix',
  'Shopify',
  'Snowflake',
  'Spotify',
  'Autodesk',
  'Google',
  'NVIDIA',
];

test('every seeded company names a real scraper', () => {
  for (const company of seedCompanies) {
    assert.ok(
      scraperNames.includes(company.scraper),
      `${company.name} references unknown scraper '${company.scraper}'`
    );
  }
});

test('seeded companies have unique lookup keys', () => {
  const seen = new Map<string, string>();
  for (const { name } of seedCompanies) {
    const key = normalizeCompanyName(name);
    const clash = seen.get(key);
    assert.ok(!clash, `'${name}' and '${clash}' both normalize to '${key}'`);
    seen.set(key, name);
  }
});

test('job URLs round-trip through parseJobUrl', () => {
  const cases: [url: string, scraper: string, slug: string, id: string][] = [
    [
      'https://job-boards.greenhouse.io/airbnb/jobs/7712345',
      'GreenhouseScraper',
      'airbnb',
      '7712345',
    ],
    [
      'https://jobs.ashbyhq.com/zapier/abc-123',
      'AshbyScraper',
      'zapier',
      'abc-123',
    ],
    [
      'https://jobs.lever.co/crewai/xyz-789',
      'LeverScraper',
      'crewai',
      'xyz-789',
    ],
    [
      'https://apply.workable.com/crewai/j/ABC123/',
      'WorkableScraper',
      'crewai',
      'ABC123',
    ],
    [
      'https://jobs.smartrecruiters.com/Canva/744000',
      'SmartRecruitersScraper',
      'Canva',
      '744000',
    ],
    [
      'https://autodesk.wd1.myworkdayjobs.com/en-US/Ext/job/Toronto/Engineer_25WD1',
      'WorkdayScraper',
      'autodesk.wd1.Ext',
      '/job/Toronto/Engineer_25WD1',
    ],
  ];

  for (const [url, scraper, slug, jobId] of cases) {
    assert.deepEqual(
      parseJobUrl(url),
      { name: slug, scraper, slug, jobId, discovered: false },
      url
    );
  }

  // every greenhouse host form lands on the same board
  for (const url of [
    'https://boards.greenhouse.io/figma/jobs/5364702004?gh_jid=5364702004',
    'https://job-boards.greenhouse.io/figma/jobs/5364702004',
    'https://boards-api.greenhouse.io/v1/boards/figma/jobs/5364702004',
  ]) {
    assert.deepEqual(
      parseJobUrl(url),
      {
        name: 'figma',
        scraper: 'GreenhouseScraper',
        slug: 'figma',
        jobId: '5364702004',
        discovered: false,
      },
      url
    );
  }

  // the embed script names the board in a query param, not the path
  assert.deepEqual(
    parseJobUrl('https://boards.greenhouse.io/embed/job_board?for=airbnb'),
    {
      name: 'airbnb',
      scraper: 'GreenhouseScraper',
      slug: 'airbnb',
      jobId: null,
      discovered: false,
    }
  );

  assert.equal(parseJobUrl('https://example.com/careers'), null);
  assert.equal(parseJobUrl('not a url'), null);
});

test('scrapers rebuild the URLs they parse', () => {
  const scraper = new scrapers.GreenhouseScraper('airbnb');
  assert.equal(
    scraper.jobUrl('7712345'),
    'https://job-boards.greenhouse.io/airbnb/jobs/7712345'
  );
});

test('company names come out of embedded board URLs', () => {
  const cases: [url: string, name: string | null][] = [
    ['https://careers.airbnb.com/positions/123', 'airbnb'],
    ['https://jobs.acme.io/openings', 'acme'],
    ['https://www.example.co.uk/careers', 'example'],
    ['https://acme.com', 'acme'],
    ['https://localhost/careers', null],
  ];

  for (const [url, name] of cases) {
    assert.equal(companyNameFromUrl(new URL(url)), name, url);
  }
});

test('job ids come out of URLs no scraper claims', () => {
  const cases: [url: string, id: string | null][] = [
    ['https://careers.airbnb.com/positions/8184174?gh_jid=8184174', '8184174'],
    ['https://careers.acme.com/roles/99887', '99887'],
    ['https://boards.acme.com/jobs?pid=4242', '4242'],
    // a plain careers page is not a posting
    ['https://careers.acme.com/openings', null],
  ];

  for (const [url, id] of cases) {
    assert.equal(jobIdFromUrl(new URL(url)), id, url);
  }
});

test('normalizeCompanyName collapses the ways a name gets written', () => {
  const key = normalizeCompanyName('Apollo.io');
  for (const variant of ['apollo io', 'Apollo.io, Inc.', 'APOLLO IO']) {
    assert.equal(normalizeCompanyName(variant), key, variant);
  }

  // distinct companies must stay distinct
  assert.notEqual(
    normalizeCompanyName('Block'),
    normalizeCompanyName('Blockchain')
  );
});

test('slug candidates cover both board conventions', () => {
  assert.deepEqual(scrapers.GreenhouseScraper.slugCandidates('Wispr Flow'), [
    'wisprflow',
    'wispr-flow',
  ]);
  assert.deepEqual(
    scrapers.SmartRecruitersScraper.slugCandidates('rapt studio'),
    ['RaptStudio', 'raptstudio']
  );
  // no duplicate probes when the name is already capitalized
  assert.deepEqual(
    scrapers.SmartRecruitersScraper.slugCandidates('Rapt Studio'),
    ['RaptStudio']
  );
});

test('Ensure Scrapers work', async (t) => {
  const names = getCompaniesFromEnv() ?? TEST_COMPANIES;

  for (const name of names) {
    const company = seedCompanies.find(
      (c) => normalizeCompanyName(c.name) === normalizeCompanyName(name)
    );
    assert.ok(company, `'${name}' is not in the seeded companies list`);

    const ScraperClass = getScraper(company.scraper);
    await t.test(`${ScraperClass.name} (${company.slug})`, async (t) => {
      using scraper = new ScraperClass(company.slug);
      await scraper._test(t);
    });
  }
});

function getCompaniesFromEnv(): string[] | null {
  const env = process.env.TEST_COMPANIES;
  return env ? env.split(/, ?/).filter(Boolean) : null;
}

test('boards are found in the markup of a bespoke careers page', () => {
  const html = `
    <html><body>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>
      <a href="https://boards.greenhouse.io/acme/jobs/123">A role</a>
      <a href="https://twitter.com/acme">Not a board</a>
    </body></html>
  `;

  assert.deepEqual(findBoardsInPage(html), [
    { slug: 'acme', jobId: '123', scraper: 'GreenhouseScraper', hits: 2 },
  ]);
});

test('the most-referenced board wins over a stray mention', () => {
  const html = `
    <a href="https://jobs.lever.co/someoneelse/abc">a job elsewhere</a>
    <script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>
    <a href="https://boards.greenhouse.io/acme/jobs/1">1</a>
    <a href="https://boards.greenhouse.io/acme/jobs/2">2</a>
  `;

  const [first, ...rest] = findBoardsInPage(html);
  assert.equal(first.slug, 'acme');
  assert.equal(first.scraper, 'GreenhouseScraper');
  assert.equal(rest.length, 1);
});

test('single-company scrapers are never sniffed for', () => {
  // a careers page linking Google's board doesn't make it Google's board
  const html =
    '<a href="https://www.google.com/about/careers/applications/jobs/results/123-eng">x</a>';
  assert.deepEqual(findBoardsInPage(html), []);
});

test('search config falls back env -> defaults, and overrides win', () => {
  const before = getSearchConfig();
  assert.equal(before.limit, 250);
  assert.equal(before.period, 'month');

  configureSearch({ apiKey: 'test-key', limit: 5, period: 'day' });
  const after = getSearchConfig();
  assert.equal(after.apiKey, 'test-key');
  assert.equal(after.limit, 5);
  assert.equal(after.period, 'day');

  // leave the module as we found it
  configureSearch({ apiKey: before.apiKey, limit: 250, period: 'month' });
});

test('every searchable board declares the domains it serves', () => {
  for (const name of scraperNames) {
    const { boardDomains, discoverable } = scrapers[name];
    if (!discoverable) continue;
    assert.ok(
      boardDomains.length > 0,
      `${name} is discoverable but declares no boardDomains`
    );
  }
});

/** A cache-backed scraper, like Ashby/Lever/Shopify, that counts its listings */
class CacheBackedScraper extends Scraper {
  listCalls = 0;
  private jobsCache = new Map<string, { id: string; title: string }>();

  async getJobsList(): Promise<ListedJob[]> {
    this.listCalls++;
    this.jobsCache.set('j1', { id: 'j1', title: 'Engineer' });
    return [
      { id: 'j1', title: 'Engineer', location: 'Remote', url: 'https://x/j1' },
    ];
  }

  async getJobContent(id: string): Promise<string> {
    return JSON.stringify(await this.fromJobsList(this.jobsCache, id));
  }
}

test('a cold cache-backed scraper fetches its own list', async () => {
  const scraper = new CacheBackedScraper('acme');

  // the caller never asked for the list; the scraper needs it anyway
  const content = await scraper.getJobContent('j1');
  assert.equal(JSON.parse(content).title, 'Engineer');
  assert.equal(scraper.listCalls, 1);

  // and it doesn't re-list once warm
  await scraper.getJobContent('j1');
  assert.equal(scraper.listCalls, 1);
});

test('a missing job says so, rather than blaming the cache', async () => {
  const scraper = new CacheBackedScraper('acme');

  await assert.rejects(
    () => scraper.getJobContent('nope'),
    (error: Error) => {
      assert.ok(error instanceof JobNotFoundError);
      assert.match(error.message, /No job 'nope' on board 'acme'/);
      return true;
    }
  );
});

test('getJob lifts listing fields out of the content', async () => {
  const scraper = new CacheBackedScraper('acme');
  const job = await scraper.getJob('j1');

  assert.equal(job.id, 'j1');
  assert.equal(job.title, 'Engineer');
});

/** A board serving exactly the titles it's given */
class FixedListScraper extends Scraper {
  constructor(private titles: string[]) {
    super('acme');
  }

  async getJobsList(): Promise<ListedJob[]> {
    return this.titles.map((title, i) => ({
      id: String(i),
      title,
      location: 'Remote',
      url: `https://x/${i}`,
    }));
  }

  async getJobContent(): Promise<string> {
    return '';
  }
}

test('a board has to hold enough real postings to count as in use', async () => {
  // Uber's forgotten SmartRecruiters account, verbatim
  const trial = new FixedListScraper(['Test UAT']);
  assert.equal(await trial.hasCompanyBoard(), false);

  const small = new FixedListScraper(['Engineer', 'Designer']);
  assert.equal(await small.hasCompanyBoard(), true);
  assert.equal(await small.hasCompanyBoard(3), false);

  // whole-title placeholders don't count; a real role that says "test" does
  const mixed = new FixedListScraper([
    'Test Job - Do Not Apply',
    'Sample Posting',
    'Join Our Talent Community!',
    'General Application',
    'Test Engineer',
    'QA Automation Lead',
  ]);
  assert.equal(await mixed.hasCompanyBoard(2), true);
  assert.equal(await mixed.hasCompanyBoard(3), false);
});

test('a careers-site name also reads as the company behind it', () => {
  assert.deepEqual(companyNameCandidates('pinterestcareers'), [
    'pinterestcareers',
    'pinterest',
  ]);
  assert.deepEqual(companyNameCandidates('lifeatacme'), ['lifeatacme', 'acme']);
  assert.deepEqual(companyNameCandidates('Figma Careers'), [
    'Figma Careers',
    'Figma',
  ]);

  // a name that is nothing but the suffix has no other reading
  assert.deepEqual(companyNameCandidates('careers'), ['careers']);
  assert.deepEqual(companyNameCandidates('Airbnb'), ['Airbnb']);
});

test("a board's own tracking params give away which board it is", () => {
  const hinted = (url: string) => boardHints(new URL(url));

  assert.deepEqual(hinted('https://www.pinterestcareers.com/jobs/1?gh_jid=1'), [
    'GreenhouseScraper',
  ]);
  assert.deepEqual(hinted('https://careers.acme.com/x?ashby_jid=abc'), [
    'AshbyScraper',
  ]);
  assert.deepEqual(hinted('https://careers.acme.com/x?utm_source=y'), []);
});

test('a page can name the company it belongs to', () => {
  assert.deepEqual(
    findNamesInPage(
      '<meta property="og:site_name" content="Pinterest Careers">'
    ),
    ['Pinterest Careers', 'Pinterest']
  );

  assert.deepEqual(
    findNamesInPage(
      '<script>{"hiringOrganization":{"name":"Acme &amp; Co"}}</script>'
    ),
    ['Acme & Co']
  );

  assert.deepEqual(findNamesInPage('<title>Staff Engineer</title>'), []);
});
