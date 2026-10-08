import { describe, expect, test } from 'bun:test';
import { runCli } from '../cli-command.ts';
import { pkgVersion } from '../constants.ts';
import { renderScrapedPosting, type Job, type ListedJob } from '../index.ts';

const posting: Job = {
  id: '42',
  title: 'Engineer',
  location: 'Remote',
  url: 'https://example.test/jobs/42',
  content:
    '{"description":"<p>Build things</p>","unknown":{"value":0},"flag":false}',
};
const listings: ListedJob[] = [
  {
    id: '1',
    title: 'Engineer [Platform]',
    location: 'REMOTE US',
    url: 'https://example.test/1',
  },
  {
    id: '2',
    title: 'Engineer Product',
    location: 'Remote EU',
    url: 'https://example.test/2',
  },
  {
    id: '3',
    title: 'Designer',
    location: 'NYC',
    url: 'https://example.test/3',
  },
];

async function invoke(args: string[], fail = false) {
  let stdout = '',
    stderr = '';
  const calls: unknown[] = [];
  const status = await runCli(
    args,
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
    {
      listCompanyJobs: async (input) => {
        calls.push(input);
        if (fail) throw new Error('Board unavailable');
        return listings;
      },
      fetchJob: async (input) => {
        calls.push(input);
        if (fail) throw new Error('Posting unavailable');
        return posting;
      },
    }
  );
  return { status, stdout, stderr, calls };
}

describe('CLI', () => {
  test('help and version perform no lookup', async () => {
    for (const args of [
      [],
      ['--help'],
      ['job', '-h'],
      ['jobs', '--help'],
      ['-v'],
    ]) {
      const result = await invoke(args);
      expect(result.status).toBe(0);
      expect(result.calls).toEqual([]);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(args[0] === '-v' ? pkgVersion : 'Usage:');
    }
  });

  test('invalid flags and combinations fail before lookup', async () => {
    const cases = [
      ['wat'],
      ['jobs'],
      ['job', 'Acme'],
      ['jobs', 'Acme', 'Other'],
      ['jobs', 'Acme', '--unknown'],
      ['jobs', 'Acme', '--title'],
      ['jobs', 'Acme', '--title='],
      ['jobs', 'Acme', '--format', 'xml'],
      ['job', 'Acme', '--id', '42', '--format', 'jsonl'],
      ['jobs', 'Acme', '--format', 'jsonl', '--mode', 'compact'],
      ['job', 'Acme', '--id', '42', '--mode', 'other'],
      ['jobs', 'Acme', '--id', '42'],
      ['jobs', 'Acme', '--mode', 'complete'],
      ['job', 'Acme', '--id', '42', '--title', 'Engineer'],
      ['job', 'Acme', '--id', '42', '--location', 'Remote'],
      ['job', 'Acme', '--id', '42', '--format', 'json', '--mode', 'complete'],
      ['jobs', '--scraper', 'GreenhouseScraper'],
      ['jobs', '--slug', 'acme'],
      ['jobs', '--scraper', 'unknown', '--slug', 'acme'],
      ['jobs', 'Acme', '--scraper', 'GreenhouseScraper', '--slug', 'acme'],
      ['job', 'https://example.test/42', '--id', '42'],
      ['job', 'ftp://example.test/42'],
      ['jobs', 'https://'],
      ['jobs', '   '],
      ['--version', 'jobs'],
      ['--help', '--format', 'json'],
      ['jobs', 'Acme', '--help'],
      ['jobs', 'Acme', '--format', 'json', '--format', 'markdown'],
    ];
    for (const args of cases) {
      const result = await invoke(args);
      expect(result.status, args.join(' ')).toBe(1);
      expect(result.calls).toEqual([]);
      expect(result.stdout).toBe('');
      expect(result.stderr).toStartWith('job-scraper: ');
    }
  });

  test('company, board URL and explicit scraper route through library inputs', async () => {
    expect((await invoke(['jobs', 'Acme'])).calls).toEqual([
      { company: 'Acme' },
    ]);
    expect(
      (await invoke(['jobs', 'https://jobs.example.test/acme'])).calls
    ).toEqual([{ url: 'https://jobs.example.test/acme' }]);
    expect((await invoke(['job', 'Acme', '--id', '42'])).calls).toEqual([
      { company: 'Acme', id: '42' },
    ]);
    expect(
      (
        await invoke([
          'job',
          '--scraper',
          'GreenhouseScraper',
          '--slug',
          'acme',
          '--id',
          '42',
        ])
      ).calls
    ).toEqual([{ scraper: 'GreenhouseScraper', slug: 'acme', id: '42' }]);
  });

  test('filters are literal, case insensitive, combined, and do not truncate', async () => {
    const filtered = await invoke([
      'jobs',
      'Acme',
      '--title',
      '[platform]',
      '--location',
      'remote us',
      '--format',
      'json',
    ]);
    expect(JSON.parse(filtered.stdout)).toEqual([listings[0]]);
    expect(
      JSON.parse((await invoke(['jobs', 'Acme', '--format', 'json'])).stdout)
    ).toEqual(listings);
    expect(
      JSON.parse(
        (
          await invoke([
            'jobs',
            'Acme',
            '--title',
            'missing',
            '--format',
            'json',
          ])
        ).stdout
      )
    ).toEqual([]);
    expect((await invoke(['jobs', 'Acme', '--title', 'missing'])).stdout).toBe(
      'No matching jobs.\n'
    );
  });

  test('JSONL returns one complete record per line and supports filters', async () => {
    const result = await invoke(['jobs', 'Acme', '--format', 'jsonl']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(
      result.stdout
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual(listings);
    const filtered = await invoke([
      'jobs',
      'Acme',
      '--format',
      'jsonl',
      '--title',
      '[platform]',
      '--location',
      'remote us',
    ]);
    expect(filtered.stdout).toBe(JSON.stringify(listings[0]) + '\n');
    expect(
      (
        await invoke([
          'jobs',
          'Acme',
          '--format',
          'jsonl',
          '--title',
          'missing',
        ])
      ).stdout
    ).toBe('');
  });

  test('JSONL escapes embedded line breaks and preserves listing values', async () => {
    const jobs = [
      {
        ...listings[0],
        title: 'Engineer\n"Platform"',
        location: 'US\r\nRemote',
        id: '\\42',
      },
    ];
    let stdout = '';
    const status = await runCli(
      ['jobs', 'Acme', '--format', 'jsonl'],
      {
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {},
      },
      { listCompanyJobs: async () => jobs, fetchJob: async () => posting }
    );
    expect(status).toBe(0);
    expect(stdout.split('\n')).toHaveLength(2);
    expect(JSON.parse(stdout)).toEqual(jobs[0]);
  });

  test('list Markdown includes every listing field', async () => {
    const result = await invoke(['jobs', 'Acme']);
    expect(result.status).toBe(0);
    for (const listing of listings) {
      expect(result.stdout).toContain(`- **ID:** ${listing.id}`);
      expect(result.stdout).toContain(`- **URL:** \` ${listing.url} \``);
    }
    expect(result.stdout).toContain('Engineer \\[Platform\\]');
    expect(result.stderr).toBe('');
  });

  test('listing Markdown escapes adversarial punctuation, tags and line breaks', async () => {
    let stdout = '';
    const status = await runCli(
      ['jobs', 'Acme'],
      {
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {},
      },
      {
        listCompanyJobs: async () => [
          {
            id: '`id`',
            title: '[x](javascript:bad)\n# heading <script>',
            location: 'A|B & C',
            url: 'https://example.test/``<unsafe>',
          },
        ],
        fetchJob: async () => posting,
      }
    );
    expect(status).toBe(0);
    expect(stdout).toContain(
      '\\[x\\]\\(javascript:bad\\)<br>\\# heading &lt;script&gt;'
    );
    expect(stdout).toContain('A\\|B &amp; C');
    expect(stdout).toContain('\\`id\\`');
    expect(stdout).not.toContain('<script>');
    expect(stdout).toContain('``` https://example.test/``<unsafe> ```');
  });

  test('large boards are returned in full', async () => {
    const jobs = Array.from({ length: 101 }, (_, index) => ({
      ...listings[0],
      id: String(index),
    }));
    for (const format of ['json', 'jsonl', 'markdown']) {
      let stdout = '';
      const status = await runCli(
        ['jobs', 'Acme', '--format', format],
        {
          stdout: (text) => {
            stdout += text;
          },
          stderr: () => {},
        },
        {
          listCompanyJobs: async () => jobs,
          fetchJob: async () => posting,
        }
      );
      expect(status).toBe(0);
      if (format === 'json') expect(JSON.parse(stdout)).toEqual(jobs);
      else if (format === 'jsonl')
        expect(
          stdout
            .trimEnd()
            .split('\n')
            .map((line) => JSON.parse(line))
        ).toEqual(jobs);
      else {
        expect(stdout.match(/^## Job /gm)).toHaveLength(101);
        expect(stdout).toContain('- **ID:** 100');
      }
    }
  });

  test('default complete and explicit compact use the existing renderer', async () => {
    const complete = await invoke(['job', 'Acme', '--id', '42']);
    expect(complete.stdout).toBe(renderScrapedPosting(posting).markdown);
    expect(complete.stdout).toContain('/unknown/value');
    const compact = await invoke([
      'job',
      'Acme',
      '--id',
      '42',
      '--mode',
      'compact',
    ]);
    expect(compact.stdout).toBe(
      renderScrapedPosting(posting, { mode: 'compact' }).markdown
    );
    expect(compact.stdout).not.toContain('/unknown/value');
  });

  test('JSON preserves the full Job and exact content; URL rendering retains supplied URL', async () => {
    const url = 'https://example.test/42?tracking=original';
    const result = await invoke(['job', url, '--format', 'json']);
    expect(JSON.parse(result.stdout)).toEqual(posting);
    expect(JSON.parse(result.stdout).content).toBe(posting.content);
    expect(result.calls).toEqual([{ url }]);
    expect((await invoke(['job', url])).stdout).toContain(`<${url}>`);
  });

  test('fetch errors use stderr and a nonzero exit', async () => {
    for (const args of [
      ['jobs', 'Acme'],
      ['jobs', 'Acme', '--format', 'jsonl'],
      ['job', 'Acme', '--id', '42'],
    ]) {
      const result = await invoke(args, true);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('unavailable');
      expect(result.calls).toHaveLength(1);
    }
  });
});
