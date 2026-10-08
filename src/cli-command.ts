import { parseArgs } from 'node:util';
import { pkgVersion } from './constants.ts';
import type {
  CompanyInput,
  fetchJob,
  FetchJobInput,
  listCompanyJobs,
  ListedJob,
} from './index.ts';
import { renderScrapedPosting } from './render.ts';
import { isScraperName } from './scrapers/index.ts';

const HELP = `Usage:
  job-scraper jobs <company-or-board-url> [--title <text>] [--location <text>]
  job-scraper job <posting-url>
  job-scraper job <company> --id <id>
  job-scraper jobs --scraper <ScraperName> --slug <slug>
  job-scraper job --scraper <ScraperName> --slug <slug> --id <id>

Options:
  --format <markdown|json|jsonl>
                           Output format (default: markdown; jsonl: jobs only)
  --mode <complete|compact> Job Markdown detail (default: complete)
  --title <text>            Literal case-insensitive title filter (jobs only)
  --location <text>         Literal case-insensitive location filter (jobs only)
  --help, -h                Show help
  --version, -v             Show version

JSON preserves every returned field and the original posting content.
Complete Markdown accounts for fields but converts HTML to readable Markdown.
`;

interface Dependencies {
  listCompanyJobs: typeof listCompanyJobs;
  fetchJob: typeof fetchJob;
}

interface Output {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function markdownText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&')
    .replace(/\r\n|\r|\n/g, '<br>');
}

function markdownCode(value: string): string {
  const fence = '`'.repeat(
    Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length)) + 1
  );
  return `${fence} ${value.replace(/\r\n|\r|\n/g, ' ')} ${fence}`;
}

function markdownJobs(jobs: ListedJob[]): string {
  if (!jobs.length) return 'No matching jobs.\n';
  return (
    jobs
      .map((job, index) =>
        [
          `## Job ${index + 1}`,
          '',
          ...(['title', 'location', 'id', 'url'] as const).map(
            (field) =>
              `- **${field === 'id' ? 'ID' : field === 'url' ? 'URL' : field[0].toUpperCase() + field.slice(1)}:** ${field === 'url' ? markdownCode(job[field]) : markdownText(job[field])}`
          ),
        ].join('\n')
      )
      .join('\n\n') + '\n'
  );
}

function toJsonl(jobs: readonly ListedJob[]): string {
  return jobs.map((job) => JSON.stringify(job) + '\n').join('');
}

/** Internal runner: parsing completes before any resolver/network call. */
export async function runCli(
  args: string[],
  output: Output,
  dependencies?: Dependencies
): Promise<number> {
  try {
    const { values, positionals, tokens } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        format: { type: 'string' },
        mode: { type: 'string' },
        title: { type: 'string' },
        location: { type: 'string' },
        id: { type: 'string' },
        scraper: { type: 'string' },
        slug: { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name))
        throw new Error(`Duplicate option --${token.name}`);
      seen.add(token.name);
    }
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === 'string' && !value.trim())
        throw new Error(`--${name} requires a nonempty value`);
    }
    const [command, target, ...extra] = positionals;
    if (values.version) {
      if (positionals.length || seen.size !== 1)
        throw new Error('--version must be used alone');
      output.stdout(pkgVersion + '\n');
      return 0;
    }
    if (values.help || !args.length) {
      if (
        seen.size > 1 ||
        target ||
        extra.length ||
        (command && command !== 'jobs' && command !== 'job')
      )
        throw new Error('Use --help alone or with jobs/job');
      output.stdout(HELP);
      return 0;
    }
    if (command !== 'jobs' && command !== 'job')
      throw new Error('Expected command jobs or job (see --help)');
    if (extra.length) throw new Error('Expected a single company or URL');
    const formats =
      command === 'jobs' ? ['markdown', 'json', 'jsonl'] : ['markdown', 'json'];
    if (values.format && !formats.includes(values.format))
      throw new Error(
        `--format for ${command} must be ${formats.join(' or ')}`
      );
    if (values.mode && !['complete', 'compact'].includes(values.mode))
      throw new Error('--mode must be complete or compact');
    if (command === 'jobs' && (values.id || values.mode))
      throw new Error('--id and --mode apply only to job');
    if (command === 'job' && (values.title || values.location))
      throw new Error('--title and --location apply only to jobs');
    if (values.mode && values.format === 'json')
      throw new Error('--mode applies only to Markdown output');
    if (Boolean(values.scraper) !== Boolean(values.slug))
      throw new Error('--scraper and --slug must be used together');
    if (values.scraper && !isScraperName(values.scraper))
      throw new Error(`Unknown scraper: ${values.scraper}`);
    if (values.scraper && target)
      throw new Error('Use a company/URL or --scraper and --slug, not both');
    if (!target && !values.scraper)
      throw new Error('A company/URL or --scraper and --slug is required');
    if (target && !target.trim())
      throw new Error('Company/URL must not be empty');
    const url = target && URL.canParse(target) ? new URL(target) : null;
    if (url && !['http:', 'https:'].includes(url.protocol))
      throw new Error('Posting/board URLs must use http or https');
    if (target && !url && /^https?:/i.test(target))
      throw new Error('Invalid posting/board URL');
    if (command === 'job' && url && values.id)
      throw new Error('Use a posting URL or company/board with --id, not both');
    if (command === 'job' && !url && !values.id)
      throw new Error(
        'A company/board job requires --id; otherwise use a posting URL'
      );
    const input: CompanyInput =
      values.scraper && isScraperName(values.scraper)
        ? { scraper: values.scraper, slug: values.slug }
        : url
          ? { url: target }
          : { company: target };
    const api = dependencies ?? (await import('./index.ts'));
    if (command === 'jobs') {
      const title = values.title?.toLowerCase();
      const location = values.location?.toLowerCase();
      const jobs = (await api.listCompanyJobs(input)).filter(
        (job) =>
          (!title || job.title.toLowerCase().includes(title)) &&
          (!location || job.location.toLowerCase().includes(location))
      );
      let result: string;
      switch (values.format) {
        case 'json':
          result = JSON.stringify(jobs, null, 2) + '\n';
          break;
        case 'jsonl':
          result = toJsonl(jobs);
          break;
        default:
          result = markdownJobs(jobs);
      }
      output.stdout(result);
    } else {
      const jobInput: FetchJobInput = {
        ...input,
        ...(values.id ? { id: values.id } : {}),
      };
      const job = await api.fetchJob(jobInput);
      output.stdout(
        values.format === 'json'
          ? JSON.stringify(job, null, 2) + '\n'
          : renderScrapedPosting(job, {
              mode: values.mode === 'compact' ? 'compact' : 'complete',
              postingUrl: url?.href,
            }).markdown
      );
    }
    return 0;
  } catch (error) {
    output.stderr(
      `job-scraper: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
}
