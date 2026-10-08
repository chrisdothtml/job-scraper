/**
 * Runtime-independent posting rendering. Complete mode accounts for every
 * parsed JSON field; compact mode selects and deduplicates posting prose.
 */
import type { Job } from './scrapers/Scraper.ts';
import {
  decodeHtmlEntities,
  htmlToMarkdown,
  looksLikeEscapedHtml,
  looksLikeHtml,
} from './utils/html.ts';

/** Rendering policy: complete accounts for all JSON fields; compact selects posting prose. */
export type RenderPostingOptions = {
  mode?: 'complete' | 'compact';
  /** Public posting URL when the scraper returned an application URL. */
  postingUrl?: string;
};

export type RenderedPosting = {
  /** Title, metadata and posting body as readable Markdown. */
  markdown: string;
  /** Posting prose and, in complete mode, remaining source data. */
  body: string;
  /** Original job, including its exact content string; the input is never mutated. */
  raw: Job;
};

/** Keys whose values are never part of the posting body */
const NOISE_KEY =
  /legal|question|application|similar|compliance|confirmation|meta_?data|custom_?field|^links?$|url$|href$|logo|apply|referral/i;
/** Keys of sections that read best at the end (e.g. Lever's `additional`) */
const TRAILING_KEY =
  /^additional|benefit|eeo|equal|disclaimer|closing|conclusion/i;
/** Keys that can hold a nested section's title */
const TITLE_KEYS = ['title', 'name', 'label', 'heading', 'text'];
/** Plain (non-HTML) strings shorter than this aren't considered body text */
const MIN_PLAIN_BODY_LENGTH = 200;

type Section = {
  key: string;
  markdown: string;
  /** Whether it came from HTML (plain variants are dropped if there's HTML) */
  fromHtml: boolean;
  /** Normalized text, for deduping */
  fingerprint: string;
};

function fingerprint(markdown: string) {
  return markdown.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Converts a rich-text value (HTML, escaped HTML, markdown, or text) */
export function richTextToMarkdown(text: string): string {
  let value = text;
  if (!looksLikeHtml(value) && looksLikeEscapedHtml(value)) {
    value = decodeHtmlEntities(value);
  }
  if (looksLikeHtml(value)) return htmlToMarkdown(value);
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isShortPlainString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 100 &&
    !looksLikeHtml(value) &&
    !looksLikeEscapedHtml(value)
  );
}

function sameText(a: string, b: string) {
  return fingerprint(a) === fingerprint(b);
}

function collectSections(json: unknown, jobTitle: string): Section[] {
  const sections: Section[] = [];

  const visit = (value: unknown, key: string, depth: number) => {
    if (typeof value === 'string') {
      const isRich = looksLikeHtml(value) || looksLikeEscapedHtml(value);
      if (
        !isRich &&
        (value.trim().length < MIN_PLAIN_BODY_LENGTH || !/\s/.test(value))
      ) {
        return;
      }
      const markdown = richTextToMarkdown(value);
      if (markdown) {
        sections.push({
          key,
          markdown,
          fromHtml: isRich,
          fingerprint: fingerprint(markdown),
        });
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, depth + 1);
      return;
    }

    if (!value || typeof value !== 'object') return;

    // nested objects like `{ title: 'What you'll do', content: '<ul>…' }`
    const entries = Object.entries(value);
    const titleKey =
      depth > 0
        ? TITLE_KEYS.find((titleKey) =>
            isShortPlainString((value as Record<string, unknown>)[titleKey])
          )
        : undefined;
    const title = titleKey
      ? (value as Record<string, string>)[titleKey].trim()
      : null;

    const start = sections.length;
    for (const [childKey, child] of entries) {
      if (childKey === titleKey || NOISE_KEY.test(childKey)) continue;
      visit(child, childKey, depth + 1);
    }

    const first = sections[start];
    if (
      title &&
      first &&
      !sameText(title, jobTitle) &&
      !first.markdown.startsWith('#')
    ) {
      first.markdown = `## ${title}\n\n${first.markdown}`;
    }
  };

  visit(json, '', 0);
  return sections;
}

/** Drops plain-text variants of HTML fields, and duplicates */
function dedupeSections(sections: Section[]): Section[] {
  const kept: Section[] = [];

  for (const section of sections) {
    const duplicate = kept.findIndex(
      (other) =>
        other.fingerprint.includes(section.fingerprint) ||
        section.fingerprint.includes(other.fingerprint)
    );
    if (duplicate === -1) {
      kept.push(section);
      continue;
    }

    // only the *duplicate* pair is resolved here — an unrelated plain-text
    // section (no matching fingerprint) is always kept, even alongside html
    // sections; when two sections do describe the same content, prefer the
    // html-sourced one (richer formatting), then the longer text
    const existing = kept[duplicate];
    const preferIncoming =
      section.fromHtml !== existing.fromHtml
        ? section.fromHtml
        : section.fingerprint.length > existing.fingerprint.length;
    if (preferIncoming) kept[duplicate] = section;
  }

  return [
    ...kept.filter((section) => !TRAILING_KEY.test(section.key)),
    ...kept.filter((section) => TRAILING_KEY.test(section.key)),
  ];
}

/** First short string found under any of `keys` (breadth-first, shallow) */
function findField(json: unknown, keys: RegExp, maxDepth = 2): string | null {
  let level: unknown[] = [json];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      for (const [key, value] of Object.entries(node)) {
        if (keys.test(key) && isShortPlainString(value)) return value.trim();
        if (value && typeof value === 'object' && !NOISE_KEY.test(key)) {
          next.push(value);
        }
      }
    }
    level = next;
  }
  return null;
}

function parseJson(
  content: string
): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(content) };
  } catch {
    return { parsed: false };
  }
}

/** Safe code fence even when source values contain Markdown fences. */
function fencedJson(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return `Out-of-range JSON number (JavaScript parsed value):\n\n\`\`\`text\n${String(value)}\n\`\`\``;
  }
  const json = Object.is(value, -0) ? '-0' : JSON.stringify(value);
  const runs = json.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${fence}json\n${json}\n${fence}`;
}

function pointerLabel(path: string): string {
  // JSON encoding protects newlines; code spans protect Markdown punctuation.
  const label = JSON.stringify(path);
  const runs = label.match(/`+/g) ?? [];
  const marker = '`'.repeat(Math.max(1, ...runs.map((run) => run.length + 1)));
  return `${marker} ${label} ${marker}`;
}

function pointerSegment(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Every node is accounted for, including container kinds and empty values. */
function completeBody(json: unknown): string {
  const prose: string[] = [];
  const additional: string[] = [];
  const visit = (value: unknown, path: string, key: string) => {
    const label = `### JSON pointer ${pointerLabel(path)}`;
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      const kind = Array.isArray(value) ? 'array' : 'object';
      additional.push(
        `${label}\n\n${entries.length ? `${kind} (${entries.length} entries)` : fencedJson(value)}`
      );
      for (const [childKey, child] of entries) {
        visit(child, `${path}/${pointerSegment(childKey)}`, childKey);
      }
      return;
    }
    if (
      typeof value === 'string' &&
      value.trim() &&
      (looksLikeHtml(value) ||
        looksLikeEscapedHtml(value) ||
        /description|content|body|additional|benefit|requirement|eligib|responsibil/i.test(
          key
        ))
    ) {
      const readable = richTextToMarkdown(value);
      // Even strings whose HTML has no visible text must have an accounted value.
      prose.push(
        `${label} (string)\n\n${readable ? demoteHeadings(readable) : fencedJson(value)}`
      );
    } else {
      additional.push(`${label}\n\n${fencedJson(value)}`);
    }
  };
  visit(json, '', '');
  return [
    ...prose,
    additional.length
      ? `## Additional posting data\n\n${additional.join('\n\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Safe metadata links; invalid/unsafe URLs remain visible as JSON strings. */
function postingLink(url: string): string {
  if (!/^https?:\/\//i.test(url.trim())) return pointerLabel(url);
  return `<${url.trim().replace(/[\s<>]/g, (char) => encodeURIComponent(char))}>`;
}

type Fence = { marker: '`' | '~'; length: number };

/** CommonMark fence boundaries (up to three spaces, matching delimiter/length). */
function nextFence(line: string, current: Fence | null): Fence | null {
  if (current) {
    const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    return closing &&
      closing[1][0] === current.marker &&
      closing[1].length >= current.length
      ? null
      : current;
  }
  const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!opening || (opening[1][0] === '`' && opening[2].includes('`')))
    return null;
  return {
    marker: opening[1][0] as Fence['marker'],
    length: opening[1].length,
  };
}

/** Demotes visible headings and closes an unfinished fence at the section boundary. */
function demoteHeadings(markdown: string): string {
  let fence: Fence | null = null;
  const lines: { line: string; fenced: boolean }[] = [];
  for (const line of markdown.split('\n')) {
    const previous = fence;
    fence = nextFence(line, fence);
    lines.push({ line, fenced: previous !== null || fence !== null });
  }
  const levels = lines
    .filter(({ fenced }) => !fenced)
    .flatMap(({ line }) => {
      const match = line.match(/^ {0,3}(#{1,6}) /);
      return match ? [match[1].length] : [];
    });
  const shift = levels.length ? Math.max(0, 2 - Math.min(...levels)) : 0;
  const rendered = lines.map(({ line, fenced }) =>
    fenced
      ? line
      : line.replace(
          /^( {0,3})(#{1,6}) /,
          (_, indent: string, hashes: string) =>
            indent + '#'.repeat(Math.min(6, hashes.length + shift)) + ' '
        )
  );
  if (fence !== null) {
    rendered.push(fence.marker.repeat(fence.length));
  }
  return rendered.join('\n');
}

/** e.g. 'Los Gatos,California, , USA' → 'Los Gatos, California, USA' */
function cleanLocation(location: string | undefined) {
  return (location ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Pure rendering with complete field accounting by default. HTML is converted
 * to readable text, not preserved byte-for-byte; `raw.content` remains exact.
 */
export function renderScrapedPosting(
  job: Job,
  options: RenderPostingOptions = {}
): RenderedPosting {
  const parsed = parseJson(job.content);
  const json = parsed.parsed ? parsed.value : undefined;
  const complete = options.mode !== 'compact';
  const postingUrl = options.postingUrl ?? job.url;

  let body: string;
  let company: string | null = null;
  let compensation: string | null = null;
  if (parsed.parsed) {
    body = complete
      ? completeBody(json)
      : dedupeSections(collectSections(json, job.title))
          .map((section) => demoteHeadings(section.markdown))
          .join('\n\n');
    company =
      findField(json, /^company_?name$/i) ??
      findField(
        json && typeof json === 'object' && !Array.isArray(json)
          ? (json as Record<string, unknown>).hiringOrganization
          : null,
        /^name$/,
        0
      );
    compensation = findField(
      json,
      /(compensation|salary|pay).*(summary|range)$/i
    );
  } else {
    body = richTextToMarkdown(job.content);
  }
  if (!complete || !parsed.parsed) body = demoteHeadings(body);

  // Keep exact outer metadata too, including whitespace and the scraper URL.
  if (complete) {
    const metadata = Object.entries(job)
      .filter(([key]) => key !== 'content')
      .map(
        ([key, value]) =>
          `### Job field ${pointerLabel('/' + pointerSegment(key))}\n\n${fencedJson(value)}`
      );
    if (metadata.length)
      body = [body, `## Source job metadata\n\n${metadata.join('\n\n')}`]
        .filter(Boolean)
        .join('\n\n');
  }
  const location = cleanLocation(job.location);
  const details = [
    company && `- **Company:** ${company}`,
    location && `- **Location:** ${location}`,
    compensation && `- **Compensation:** ${compensation}`,
    postingUrl && `- **Posting:** ${postingLink(postingUrl)}`,
  ].filter(Boolean);
  const markdown = [
    job.title?.trim() && `# ${job.title.trim()}`,
    details.join('\n'),
    body,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { markdown: markdown + '\n', body, raw: job };
}
