import { afterAll, beforeEach, test } from 'bun:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pkgVersion } from '../constants.ts';

// `paths.ts` reads this at import time, so it precedes the dynamic import
const tmpDir = await fs.mkdtemp(
  path.join(os.tmpdir(), 'job-scraper-companies-')
);
process.env.JOB_SCRAPER_DATA_DIR = tmpDir;
// this suite exercises persistence itself, so a dev's own opt-out (set in
// `.env`, which Bun loads for every run including this one) can't apply
delete process.env.DISABLE_COMPANY_REGISTRY;

const {
  addCompanyDomain,
  clearCompaniesCache,
  findCompany,
  findCompanyByDomain,
  isBoardDomain,
  normalizeDomain,
  listCompanies,
  mergeRegistry,
  registerCompany,
  slugMatchesCompany,
} = await import('../companies.ts');
const { seedCompanies } = await import('../companies.seed.ts');

const registryFile = path.join(tmpDir, 'companies.json');

afterAll(() => fs.rm(tmpDir, { recursive: true, force: true }));

beforeEach(async () => {
  await fs.rm(registryFile, { force: true });
  clearCompaniesCache();
});

async function readRegistry() {
  return JSON.parse(await fs.readFile(registryFile, 'utf8'));
}

test('the registry seeds itself on first run', async () => {
  const companies = await listCompanies();
  assert.equal(companies.length, seedCompanies.length);

  const registry = await readRegistry();
  assert.equal(registry.version, pkgVersion);
  assert.ok(registry.companies.every((c: any) => c.source === 'seed'));
});

test('a discovered company is marked as such and persisted', async () => {
  await registerCompany({
    name: 'Acme',
    scraper: 'LeverScraper',
    slug: 'acme',
  });

  assert.equal((await findCompany('Acme'))?.source, 'discovered');

  clearCompaniesCache();
  assert.equal((await findCompany('acme, inc.'))?.slug, 'acme');
});

test('an upgrade keeps discoveries and refreshes the shipped list', () => {
  const seeded = seedCompanies[0];

  const merged = mergeRegistry([
    // the user found this themselves; it must survive
    {
      name: 'Acme',
      scraper: 'LeverScraper',
      slug: 'acme',
      source: 'discovered',
    },
    // they also had a stale slug for a company we now ship
    { ...seeded, slug: 'stale-slug', source: 'discovered' },
    // and a seed entry this release no longer carries
    {
      name: 'Removed Upstream',
      scraper: 'LeverScraper',
      slug: 'gone',
      source: 'seed',
    },
  ]);

  const byName = new Map(merged.map((c) => [c.name, c]));

  assert.equal(byName.get('Acme')?.slug, 'acme', 'discovery was dropped');
  assert.equal(
    byName.get(seeded.name)?.slug,
    seeded.slug,
    'the shipped list should win for companies it covers'
  );
  assert.equal(
    byName.has('Removed Upstream'),
    false,
    'a seed entry this release dropped should not linger'
  );
});

test('a version bump triggers the merge, a matching version does not', async () => {
  await registerCompany({
    name: 'Acme',
    scraper: 'LeverScraper',
    slug: 'acme',
  });

  // pretend the stored file came from an older release
  const registry = await readRegistry();
  registry.version = '0.0.1-old';
  await fs.writeFile(registryFile, JSON.stringify(registry));
  clearCompaniesCache();

  await listCompanies();

  const rewritten = await readRegistry();
  assert.equal(rewritten.version, pkgVersion);
  assert.equal((await findCompany('Acme'))?.slug, 'acme');
});

test('slugMatchesCompany tolerates real slugs but rejects other companies', () => {
  for (const [slug, name] of [
    ['airbnb', 'Airbnb'],
    ['andurilindustries', 'Anduril'],
    ['whatnot.wd1.Whatnot', 'Whatnot'],
    ['apolloio', 'Apollo.io, Inc.'],
  ] as const) {
    assert.ok(slugMatchesCompany(slug, name), `${slug} / ${name}`);
  }

  // the failure this exists to prevent: a company name-dropped in other
  // companies' job posts must not adopt their boards
  for (const [slug, name] of [
    ['armada', 'Rippling'],
    ['centurycommunitiesinc', 'Rippling'],
    ['pomelocare', 'Rippling'],
  ] as const) {
    assert.equal(slugMatchesCompany(slug, name), false, `${slug} / ${name}`);
  }
});

test('a company is found by a domain it posts on', async () => {
  const found = await findCompanyByDomain('careers.airbnb.com');
  assert.equal(found?.name, 'Airbnb');

  // subdomains resolve to the registered parent
  assert.equal(
    (await findCompanyByDomain('jobs.careers.airbnb.com'))?.name,
    'Airbnb'
  );
  assert.equal(await findCompanyByDomain('example.com'), null);
});

test('domains discovered at runtime are persisted', async () => {
  assert.equal(await findCompanyByDomain('www.lifeatstripe.example'), null);

  const updated = await addCompanyDomain('Stripe', 'www.lifeatstripe.example');
  // `www.` is not part of the identity
  assert.deepEqual(updated?.domains, ['lifeatstripe.example']);

  clearCompaniesCache();
  assert.equal(
    (await findCompanyByDomain('lifeatstripe.example'))?.name,
    'Stripe'
  );
});

test('a shared board host can never be claimed by one company', async () => {
  assert.ok(isBoardDomain('boards.greenhouse.io'));
  // boards are matched by suffix, since tenants get their own subdomain
  assert.ok(isBoardDomain('acme.wd1.myworkdayjobs.com'));
  assert.ok(!isBoardDomain('pinterestcareers.com'));

  const updated = await addCompanyDomain('Airbnb', 'boards.greenhouse.io');
  assert.ok(!updated?.domains?.includes('boards.greenhouse.io'));
  assert.equal(await findCompanyByDomain('boards.greenhouse.io'), null);
});

test('a domain stays with whichever company claimed it first', async () => {
  await addCompanyDomain('Airbnb', 'shared-example.com');
  await addCompanyDomain('Brex', 'shared-example.com');

  assert.equal(
    (await findCompanyByDomain('shared-example.com'))?.name,
    'Airbnb'
  );
  assert.ok(
    !(await findCompany('Brex'))?.domains?.includes('shared-example.com')
  );
});

test('normalizeDomain accepts a URL as readily as a hostname', () => {
  assert.equal(normalizeDomain('https://WWW.Acme.com:443/jobs/1'), 'acme.com');
  assert.equal(normalizeDomain('WWW.Acme.com'), 'acme.com');
});

test('an upgrade keeps domains the user discovered', async () => {
  const stored = mergeRegistry([
    // the shipped list already covers Airbnb, but not on this domain
    {
      name: 'Airbnb',
      scraper: 'GreenhouseScraper',
      slug: 'airbnb',
      source: 'seed',
      domains: ['lifeatairbnb.example'],
    },
  ]);

  const airbnb = stored.find((entry) => entry.name === 'Airbnb');
  assert.deepEqual(airbnb?.domains, [
    'careers.airbnb.com',
    'lifeatairbnb.example',
  ]);
});
