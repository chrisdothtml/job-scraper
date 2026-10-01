import fs from 'node:fs/promises';
import { seedCompanies } from './companies.seed.ts';
import { pkgVersion } from './constants.ts';
import { companiesFile, writeFileAtomic } from './paths.ts';
import {
  isScraperName,
  scraperNames,
  scrapers,
  type ScraperName,
} from './scrapers/index.ts';

export interface Company {
  /** Display name, as a human would write it */
  name: string;
  /** Which scraper serves this company's board */
  scraper: ScraperName;
  /** The board slug, as the scraper's constructor takes it */
  slug: string;
  /**
   * Hostnames this company posts jobs on that aren't the board's own, e.g.
   * `pinterestcareers.com`. A URL on one of these resolves to this company
   * directly, skipping discovery entirely.
   */
  domains?: string[];
}

export interface StoredCompany extends Company {
  /**
   * `seed` came with the package; `discovered` was resolved on this machine.
   * The distinction is what lets an upgrade refresh the shipped list without
   * discarding what the user found themselves.
   */
  source: 'seed' | 'discovered';
}

interface Registry {
  /** The package version this file was last reconciled against */
  version: string;
  companies: StoredCompany[];
}

// trailing legal suffixes carry no identity and are written inconsistently
const LEGAL_SUFFIXES =
  /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|ag|nv|bv|pty|holdings|group|labs?|technologies|the)\b/g;

/**
 * Reduces a company name to a stable lookup key, so that "Apollo.io",
 * "apollo io" and "Apollo.io, Inc." all land on the same record.
 */
export function normalizeCompanyName(input: string): string {
  const key = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, '');

  // a name made up entirely of suffix words (e.g. "The Co") still needs a key
  return key || input.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Whether a board slug plausibly belongs to a company. Slugs aren't exactly
 * the company name (`Anduril` posts under `andurilindustries`, and Workday
 * buries it in `whatnot.wd1.Whatnot`), so this asks whether one contains the
 * other rather than for an exact match.
 */
export function slugMatchesCompany(slug: string, companyName: string): boolean {
  const a = normalizeCompanyName(slug);
  const b = normalizeCompanyName(companyName);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

let cache: Map<string, StoredCompany> | null = null;
let domainIndex: Map<string, StoredCompany> | null = null;

// hostnames every board answers on; a company must never claim one of these
// or a single entry would swallow every other company on that board
const boardHostnames = new Set(
  scraperNames.flatMap((name) => [...scrapers[name].boardDomains])
);

/**
 * Reduces a hostname to the form the domain index is keyed on: lowercased,
 * without a port, and without a leading `www.`.
 */
export function normalizeDomain(input: string): string {
  const host = (URL.parse(input)?.hostname ?? input)
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')
    .replace(/:\d+$/, '');

  return host.startsWith('www.') ? host.slice(4) : host;
}

/**
 * Whether a hostname belongs to a job board rather than to one company.
 * Board hosts are matched by suffix, since boards use per-tenant subdomains
 * (`acme.wd1.myworkdayjobs.com`).
 */
export function isBoardDomain(hostname: string): boolean {
  const host = normalizeDomain(hostname);
  for (const domain of boardHostnames) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

/**
 * Loads the company registry, seeding it from the bundled list on first run.
 *
 * The stored file records which package version it was last reconciled
 * against. While that matches, loading is just a parse, with no comparison
 * work on the common path. When it doesn't, the shipped list and the user's own
 * discoveries are merged (see `mergeRegistry`) and the result written back.
 */
export async function loadCompanies(): Promise<Map<string, StoredCompany>> {
  if (cache) return cache;

  const stored = await readRegistry();
  const companies =
    stored && stored.version === pkgVersion
      ? stored.companies
      : mergeRegistry(stored?.companies ?? []);

  cache = new Map();
  domainIndex = new Map();
  for (const entry of companies) {
    if (!isStoredCompany(entry)) continue;
    cache.set(normalizeCompanyName(entry.name), entry);
    indexDomains(entry);
  }

  if (!stored || stored.version !== pkgVersion) {
    await writeRegistry([...cache.values()]);
  }

  return cache;
}

/**
 * Reconciles a stored registry against the list this version ships with.
 *
 * The shipped list wins for anything it covers: it's curated, and a newer
 * release may have corrected a slug. Everything the user discovered on their
 * own is carried over untouched, unless the shipped list has since picked
 * that company up. Stale `seed` entries are dropped, since their absence
 * from the new list is deliberate.
 */
export function mergeRegistry(stored: StoredCompany[]): StoredCompany[] {
  const merged = new Map<string, StoredCompany>();

  for (const company of seedCompanies) {
    merged.set(normalizeCompanyName(company.name), {
      ...company,
      source: 'seed',
    });
  }

  for (const company of stored) {
    const key = normalizeCompanyName(company.name);
    const shipped = merged.get(key);

    if (!shipped) {
      if (company.source === 'discovered') merged.set(key, company);
      continue;
    }

    // the shipped record wins on scraper and slug, but domains are additive:
    // one the user saw this company on is still true after an upgrade
    const domains = union(shipped.domains, company.domains);
    if (domains.length) shipped.domains = domains;
  }

  return [...merged.values()];
}

/** Every known company, sorted by display name */
export async function listCompanies(): Promise<StoredCompany[]> {
  const companies = await loadCompanies();
  return [...companies.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Looks a company up by name (or by the key `normalizeCompanyName` returns) */
export async function findCompany(name: string): Promise<StoredCompany | null> {
  const companies = await loadCompanies();
  return companies.get(normalizeCompanyName(name)) ?? null;
}

/**
 * Adds a company to the registry and persists it, so the next lookup skips
 * discovery entirely. Re-registering an existing company replaces it.
 */
export async function registerCompany(
  company: Company,
  source: StoredCompany['source'] = 'discovered'
): Promise<StoredCompany> {
  const entry = { ...company, source };
  if (!isStoredCompany(entry)) {
    throw new Error(`Invalid company entry: ${JSON.stringify(company)}`);
  }

  const companies = await loadCompanies();
  companies.set(normalizeCompanyName(entry.name), entry);
  indexDomains(entry);
  await writeRegistry([...companies.values()]);
  return entry;
}

/** Drops the in-memory registry, so the next load re-reads from disk */
export function clearCompaniesCache(): void {
  cache = null;
  domainIndex = null;
}

/**
 * Looks a company up by a hostname it posts jobs on. Subdomains resolve to a
 * registered parent (`jobs.acme.com` finds `acme.com`), so a company only has
 * to be seen on a domain once however it was linked.
 */
export async function findCompanyByDomain(
  hostname: string
): Promise<StoredCompany | null> {
  await loadCompanies();

  const host = normalizeDomain(hostname);
  if (!host || isBoardDomain(host)) return null;

  const labels = host.split('.');
  // walk up the subdomains, most specific first
  for (let i = 0; i < labels.length - 1; i++) {
    const found = domainIndex!.get(labels.slice(i).join('.'));
    if (found) return found;
  }

  return null;
}

/**
 * Records a hostname as one a company posts on, so the next URL on it
 * resolves without probing. Shared board hosts are refused: claiming
 * `boards.greenhouse.io` would point every Greenhouse job at one company.
 */
export async function addCompanyDomain(
  name: string,
  hostname: string
): Promise<StoredCompany | null> {
  const host = normalizeDomain(hostname);
  if (!host || !host.includes('.') || isBoardDomain(host)) return null;

  const company = await findCompany(name);
  if (!company || company.domains?.includes(host)) return company;

  // a domain already spoken for stays with whoever claimed it first
  if (domainIndex!.has(host)) return company;

  company.domains = [...(company.domains ?? []), host].sort();
  indexDomains(company);
  await writeRegistry([...cache!.values()]);
  return company;
}

function indexDomains(company: StoredCompany): void {
  for (const domain of company.domains ?? []) {
    const host = normalizeDomain(domain);
    if (host && !isBoardDomain(host)) domainIndex!.set(host, company);
  }
}

function union(a: string[] = [], b: string[] = []): string[] {
  return [...new Set([...a, ...b])].sort();
}

function isStoredCompany(entry: unknown): entry is StoredCompany {
  if (!entry || typeof entry !== 'object') return false;
  const { name, scraper, slug, source, domains } = entry as Record<
    string,
    unknown
  >;
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    typeof slug === 'string' &&
    slug.length > 0 &&
    typeof scraper === 'string' &&
    isScraperName(scraper) &&
    (source === 'seed' || source === 'discovered') &&
    (domains === undefined ||
      (Array.isArray(domains) && domains.every((d) => typeof d === 'string')))
  );
}

// lets a developer work on the registry's shape without the stored file
// (or its writes) getting in the way; each load starts fresh from the seed
const registryDisabled = Boolean(process.env.DISABLE_COMPANY_REGISTRY);

async function readRegistry(): Promise<Registry | null> {
  if (registryDisabled) return null;

  try {
    const parsed = JSON.parse(await fs.readFile(companiesFile, 'utf8'));
    if (!parsed || !Array.isArray(parsed.companies)) return null;
    return parsed as Registry;
  } catch {
    return null;
  }
}

async function writeRegistry(entries: StoredCompany[]): Promise<void> {
  if (registryDisabled) return;

  const registry: Registry = {
    version: pkgVersion,
    companies: [...entries].sort((a, b) => a.name.localeCompare(b.name)),
  };

  await writeFileAtomic(
    companiesFile,
    JSON.stringify(registry, null, 2) + '\n'
  );
}
