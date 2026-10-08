import { describe, expect, test } from 'bun:test';
import { renderScrapedPosting as render, type Job } from '../index.ts';

function renderScrapedPosting(job: Job, postingUrl?: string) {
  return render(job, { mode: 'compact', postingUrl });
}

function scraped(content: unknown, overrides: Partial<Job> = {}) {
  return {
    id: '123',
    title: 'Staff Engineer',
    location: 'Remote,US',
    url: 'https://boards.example.com/acme/123',
    content: typeof content === 'string' ? content : JSON.stringify(content),
    ...overrides,
  };
}

describe('renderScrapedPosting', () => {
  test('ashby-like: html body, plain variant dropped, compensation', () => {
    const rendered = renderScrapedPosting(
      scraped({
        id: '123',
        title: 'Staff Engineer',
        descriptionHtml: '<h1>About</h1><p>We build <b>things</b>.</p>',
        descriptionPlain: 'ABOUT\n\nWe build things. '.repeat(20),
        applyUrl: 'https://boards.example.com/acme/123/apply',
        compensation: { compensationTierSummary: '$200K – $300K' },
      }),
      'https://jobs.example.com/123'
    );

    expect(rendered.markdown).toBe(
      [
        '# Staff Engineer',
        [
          '- **Location:** Remote, US',
          '- **Compensation:** $200K – $300K',
          '- **Posting:** <https://jobs.example.com/123>',
        ].join('\n'),
        // body headings are demoted below the title
        '## About',
        'We build **things**.\n',
      ].join('\n\n')
    );
    expect(rendered.body).toBe('## About\n\nWe build **things**.');
    expect(rendered.raw.content).toBe(
      JSON.stringify({
        id: '123',
        title: 'Staff Engineer',
        descriptionHtml: '<h1>About</h1><p>We build <b>things</b>.</p>',
        descriptionPlain: 'ABOUT\n\nWe build things. '.repeat(20),
        applyUrl: 'https://boards.example.com/acme/123/apply',
        compensation: { compensationTierSummary: '$200K – $300K' },
      })
    );
  });

  test('greenhouse-like: entity-escaped html + company name', () => {
    const rendered = renderScrapedPosting(
      scraped({
        company_name: 'Acme',
        title: 'Staff Engineer',
        content: '&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;',
        metadata: [{ name: 'Workplace', value: '<p>Remote</p>' }],
      })
    );
    expect(rendered.body).toBe('Hello & welcome');
    expect(rendered.markdown).toContain('- **Company:** Acme');
  });

  test('lever-like: titled sections, dedupe, trailing sections last', () => {
    const rendered = renderScrapedPosting(
      scraped({
        additional: '<div>We are an equal opportunity employer.</div>',
        additionalPlain: 'We are an equal opportunity employer.',
        description: '<p>Intro to the team.</p>',
        lists: [
          { text: "What You'll Do", content: '<li>Build</li><li>Ship</li>' },
          { text: 'Who You Are', content: '<li>Curious</li>' },
        ],
        text: 'Staff Engineer',
        descriptionBody: '<div><p>Intro to the team.</p></div>',
      })
    );
    expect(rendered.body).toBe(
      [
        'Intro to the team.',
        "## What You'll Do",
        '- Build\n- Ship',
        '## Who You Are',
        '- Curious',
        'We are an equal opportunity employer.',
      ].join('\n\n')
    );
  });

  test("doesn't title a section with the job title", () => {
    const rendered = renderScrapedPosting(
      scraped({
        jobPostingInfo: {
          title: 'Staff Engineer',
          jobDescription: '<p>Body</p>',
        },
        hiringOrganization: { name: 'Acme Ltd.' },
        similarJobs: [{ title: 'Other', description: '<p>Other body</p>' }],
      })
    );
    expect(rendered.body).toBe('Body');
    expect(rendered.markdown).toContain('- **Company:** Acme Ltd.');
  });

  test('an unrelated plain-text section survives alongside html', () => {
    const roleText = 'You will own the roadmap and ship features. '
      .repeat(6)
      .trim();
    const rendered = renderScrapedPosting(
      scraped({
        descriptionPlain: roleText,
        benefitsHtml: '<p>401k match and unlimited PTO.</p>',
      })
    );
    expect(rendered.body).toContain(roleText);
    expect(rendered.body).toContain('401k match and unlimited PTO.');
  });

  test('long plain text is used when there is no html', () => {
    const text = 'ABOUT THE ROLE\n\nYou will build things. '.repeat(10).trim();
    const rendered = renderScrapedPosting(
      scraped({ title: 'Staff Engineer', descriptionPlain: text, id: 'abc' })
    );
    expect(rendered.body).toBe(text);
  });

  test('non-json content (markdown, text, or html)', () => {
    const markdown = renderScrapedPosting(
      scraped('## Role\r\n\r\n\r\n- Build things  \n')
    );
    expect(markdown.body).toBe('## Role\n\n- Build things');
    expect(markdown.raw.content).toBe('## Role\r\n\r\n\r\n- Build things  \n');

    expect(renderScrapedPosting(scraped('<p>Hi <b>there</b></p>')).body).toBe(
      'Hi **there**'
    );
  });

  test('empty postings have an empty body', () => {
    const rendered = renderScrapedPosting(scraped({ id: '1', title: 'x' }));
    expect(rendered.body).toBe('');
    expect(rendered.markdown).toStartWith('# Staff Engineer');
  });
});

describe('complete field accounting', () => {
  test('preserves short prose, variants, structured compensation, eligibility and noise', () => {
    const data = {
      description: 'Build APIs.',
      descriptionHtml: '<p>Build <b>APIs</b>.</p>',
      descriptionPlain: 'Build APIs.',
      compensation: {
        min: 0,
        max: 300000,
        currency: 'USD',
        tiers: [{ eligible: false }],
      },
      eligibility: { visa: 'No sponsorship', locations: ['US', 'CA'] },
      applicationQuestions: [{ required: false, text: 'Are you eligible?' }],
      metadata: {
        nullValue: null,
        emptyString: '',
        emptyObject: {},
        emptyArray: [],
      },
      custom_fields: { 'a/b~c': { '0': 'numeric object key' } },
      unknown: ['x', 0, false, null, {}, []],
    };
    const job = Object.freeze(scraped(data));
    const rendered = render(job);
    expect(rendered.raw).toBe(job);
    expect(rendered.raw.content).toBe(JSON.stringify(data));
    expect(rendered.body).toContain('Build APIs.');
    expect(rendered.body).toContain('Build **APIs**.');
    for (const path of [
      '/description',
      '/descriptionHtml',
      '/descriptionPlain',
      '/compensation/min',
      '/compensation/tiers/0/eligible',
      '/eligibility/locations/1',
      '/applicationQuestions/0/text',
      '/metadata/nullValue',
      '/metadata/emptyString',
      '/metadata/emptyObject',
      '/metadata/emptyArray',
      '/custom_fields/a~1b~0c/0',
      '/unknown/5',
    ])
      expect(rendered.body).toContain(JSON.stringify(path));
    for (const value of [
      '0',
      'false',
      'null',
      '""',
      '{}',
      '[]',
      '"No sponsorship"',
    ]) {
      expect(rendered.body).toContain('\n' + value + '\n');
    }
    expect(rendered.body).toContain('object (1 entries)');
    expect(rendered.body).toContain('array (6 entries)');
    expect(rendered.body).toContain('numeric object key');
  });

  test('ATS shapes keep every leaf without whole-object consumption', () => {
    const fixtures = [
      {
        descriptionHtml: '<p>Ashby</p>',
        compensation: {
          salaryRange: { min: 120000, max: 150000 },
          bonus: true,
        },
      },
      {
        content: '&lt;p&gt;Greenhouse&lt;/p&gt;',
        metadata: [{ name: 'Visa', value: false }],
      },
      {
        description: '<p>Lever</p>',
        lists: [
          { text: 'Responsibilities', content: '<li>Ship</li>', extra: 0 },
        ],
        additional: 'Benefits',
      },
      {
        jobPostingInfo: {
          title: 'Engineer',
          jobDescription: '<p>Workday</p>',
          remote: true,
        },
        hiringOrganization: { name: 'Acme', identifier: null },
      },
    ];
    for (const fixture of fixtures) {
      const body = render(scraped(fixture)).body;
      const verify = (value: unknown, path: string) => {
        expect(body).toContain(JSON.stringify(path));
        if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value))
            verify(child, `${path}/${key}`);
        } else if (typeof value !== 'string' || !/[<&]/.test(value)) {
          expect(body).toContain(String(value));
        }
      };
      verify(fixture, '');
    }
  });

  test('JSON root arrays, primitives, null and empty containers', () => {
    for (const content of ['null', 'false', '0', '"brief"', '""', '[]', '{}']) {
      const rendered = render(scraped(content));
      expect(rendered.body).toContain('JSON pointer ` "" `');
      expect(rendered.body).toContain('\n' + content + '\n');
      expect(rendered.raw.content).toBe(content);
    }
    const body = render(scraped([{ description: 'Hi' }, false, []])).body;
    expect(body).toContain('"/0/description"');
    expect(body).toContain('"/1"');
    expect(body).toContain('"/2"');
  });

  test('malformed JSON and non-JSON remain readable with exact raw content', () => {
    for (const content of [
      '{bad json',
      '[broken',
      '<p>Hi</p>',
      'Short description.',
    ]) {
      const job = scraped(content);
      const rendered = render(job);
      expect(rendered.body).toContain(content === '<p>Hi</p>' ? 'Hi' : content);
      expect(rendered.raw).toBe(job);
      expect(job.content).toBe(content);
    }
  });

  test('preserves exact outer metadata when header or URL are normalized', () => {
    const job = Object.freeze(
      scraped(
        { description: 'Hi' },
        {
          title: '  Engineer  ',
          location: 'Remote,US, ,',
          url: 'https://example.com/apply',
          id: '',
        }
      )
    );
    const rendered = render(job, { postingUrl: 'https://example.com/post' });
    expect(rendered.markdown).toContain(
      '- **Posting:** <https://example.com/post>'
    );
    expect(rendered.body).toContain('"https://example.com/apply"');
    expect(rendered.body).toContain('"Remote,US, ,"');
    expect(rendered.body).toContain('"  Engineer  "');
    expect(rendered.body).toContain('Job field ` "/id" `\n\n```json\n""');
    expect(rendered.raw).toBe(job);
  });

  test('safe supplementary fences and JSON pointer labels under adversarial strings', () => {
    const job = scraped(
      {
        'weird`key\n# forged': '```\n~~~\n# forged',
        nested: { 'slash/~': '<script>hidden()</script>' },
      },
      { url: 'javascript:alert(1)' }
    );
    const rendered = render(job);
    expect(rendered.body).toContain('````json\n"```\\n');
    expect(rendered.body).toContain('weird`key\\n# forged');
    expect(rendered.body).toContain('/nested/slash~1~0');
    expect(rendered.body).toContain('<script>hidden()</script>');
    expect(rendered.markdown).not.toContain('<javascript:');
    expect(rendered.raw.content).toBe(job.content);
  });

  test('complete never truncates or substring-dedupes distinct fields', () => {
    const long = 'Long description. '.repeat(200);
    const body = render(
      scraped({
        description: long,
        benefit: 'Long description.',
        related: '<p>Long description.</p>',
      })
    ).body;
    expect(body).toContain(long.trim());
    expect(body).toContain('"/benefit"');
    expect(body).toContain('"/related"');
  });
});

describe('generated section boundaries', () => {
  test('unsafe posting URLs use inline code instead of an invalid block fence', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'bad`url\n```',
    ]) {
      const rendered = render(
        scraped({ description: 'Build APIs.', eligibility: false }),
        { postingUrl: url }
      );
      const header = rendered.markdown.slice(
        0,
        rendered.markdown.indexOf('### JSON pointer')
      );
      expect(header).not.toContain('```json');
      expect(header).toContain('- **Posting:**');
      expect(rendered.markdown).toContain('## Additional posting data');
      expect(rendered.markdown).toContain('## Source job metadata');
      expect(rendered.markdown).not.toContain('<javascript:');
    }
  });

  test('closes unfinished backtick, tilde and indented arbitrary-length fences', () => {
    for (const [opening, closing] of [
      ['```text', '```'],
      ['~~~text', '~~~'],
      ['`````text', '`````'],
      ['   ~~~~~text', '~~~~~'],
    ]) {
      const source = `Intro\n\n${opening}\n# literal heading\nBuild APIs`;
      const body = render(
        scraped({ description: source, eligibility: false })
      ).body;
      expect(body).toContain(
        `${source}\n${closing}\n\n## Additional posting data`
      );
      expect(body).toContain('# literal heading');
      expect(body).not.toContain('## literal heading');
      expect(body).toContain('"/eligibility"');
      const plainBody = render(scraped(source)).body;
      expect(plainBody).toContain(
        `${source}\n${closing}\n\n## Source job metadata`
      );
    }
  });

  test('closing syntax respects marker, length, indentation and trailing text', () => {
    const source =
      '`````text\n~~~\n```\n`````not a close\n    `````\n# literal\n   ``````  \n# visible';
    const body = render(
      scraped({ description: source, eligibility: false })
    ).body;
    expect(body).toContain(
      source.replace(/[ \t]+$/gm, '').replace('# visible', '## visible')
    );
    expect(body).not.toContain('## literal');
    expect(body).not.toContain('## visible\n`````');
    const tilde = '~~~~text\n```\n~~~\n~~~~bad close\n# literal';
    expect(render(scraped(tilde)).body).toContain(
      `${tilde}\n~~~~\n\n## Source job metadata`
    );
  });

  test('matched fences are preserved and fenced headings do not affect demotion', () => {
    const source = '### Existing\n\n```ts\n# code heading\n```';
    expect(render(scraped({ description: source })).body).toContain(source);
    const matched = 'Intro\n\n   ~~~~text\n# code\n   ~~~~~  ';
    expect(render(scraped(matched)).body).toContain(
      matched.trimEnd() + '\n\n## Source job metadata'
    );
  });

  test('compact closes each selected section fence independently', () => {
    const source = '```text\n' + 'Build APIs. '.repeat(25);
    const body = render(
      scraped({ description: source, benefits: '<p>Health insurance</p>' }),
      { mode: 'compact' }
    ).body;
    expect(body).toContain('\n```\n\nHealth insurance');
  });

  test('JSON number overflow is explicitly a number, never converted to null', () => {
    const content =
      '{"salary":1e400,"negative":-1e400,"actualNull":null,"signedZero":-0}';
    const rendered = render(scraped(content));
    expect(rendered.body).toContain(
      'Out-of-range JSON number (JavaScript parsed value):\n\n```text\nInfinity\n```'
    );
    expect(rendered.body).toContain('```text\n-Infinity\n```');
    expect(rendered.body).toContain('"/actualNull" `\n\n```json\nnull');
    expect(rendered.body).not.toContain('"/salary" `\n\n```json\nnull');
    expect(rendered.raw.content).toBe(content);
    expect(render(scraped('1e400')).body).toContain('Out-of-range JSON number');
    expect(rendered.body).toContain('"/signedZero" `\n\n```json\n-0');
    expect(render(scraped('-0')).body).toContain('```json\n-0\n```');
  });
});
