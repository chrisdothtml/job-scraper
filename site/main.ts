/**
 * The live demo in the docs site's hero: runs the package itself in the
 * browser against whatever the visitor types.
 */
import {
  clearCache,
  CorsError,
  fetchJob,
  listCompanyJobs,
  UnresolvedCompanyError,
  type Job,
  type ListedJob,
} from '../src/index.ts';

type Mode = 'company' | 'job';

interface Example {
  label: string;
  /** Resolved at click time, since job ids go stale */
  input: () => Promise<string>;
}

const firstJob = async (company: string) => {
  const [job] = await listCompanyJobs(company);
  if (!job) throw new Error(`${company} has no open jobs right now`);
  return job;
};

const placeholders: Record<Mode, string[]> = {
  company: [
    'Airbnb',
    'https://jobs.ashbyhq.com/zapier',
    'https://careers.duolingo.com',
    'Klaviyo',
    'https://jobs.lever.co/palantir',
  ],
  job: [
    'https://job-boards.greenhouse.io/airbnb/jobs/7712345',
    'https://jobs.ashbyhq.com/zapier/cb1aec2c-05cd-4598-8117-bd1f7ed9a49f',
    'https://careers.airbnb.com/positions/8184174?gh_jid=8184174',
  ],
};

const examples: Record<Mode, Example[]> = {
  company: [
    { label: 'Airbnb', input: async () => 'Airbnb' },
    {
      label: 'Ashby board URL',
      input: async () => 'https://jobs.ashbyhq.com/zapier',
    },
    {
      label: 'Careers site',
      input: async () => 'https://careers.duolingo.com',
    },
  ],
  job: [
    {
      label: 'Greenhouse job URL',
      input: async () =>
        `https://job-boards.greenhouse.io/airbnb/jobs/${(await firstJob('Airbnb')).id}`,
    },
    {
      label: 'Ashby job URL',
      input: async () => (await firstJob('Zapier')).url,
    },
    {
      // Airbnb's own careers site embeds its Greenhouse board via `?gh_jid=`
      label: 'Embedded ?gh_jid= URL',
      input: async () => (await firstJob('Airbnb')).url,
    },
  ],
};

const $ = <T extends Element>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
};

const form = $<HTMLFormElement>('#demo');
const input = $<HTMLInputElement>('#demo-input');
const button = $<HTMLButtonElement>('#demo button[type=submit]');
const exampleList = $<HTMLUListElement>('#examples');
const result = $<HTMLDivElement>('#result');

/** Builds an element. Children are only ever set as text, never as HTML */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) el.setAttribute(key, value);
  }
  el.append(...children);
  return el;
}

const mode = (): Mode =>
  (new FormData(form).get('mode') as Mode | null) ?? 'company';

// rotate the placeholder through the formats each mode accepts
let placeholderIndex = 0;
function showPlaceholder() {
  const list = placeholders[mode()];
  input.placeholder = `e.g. ${list[placeholderIndex % list.length]}`;
}
setInterval(() => {
  placeholderIndex++;
  showPlaceholder();
}, 2500);

function renderExamples() {
  exampleList.replaceChildren(
    ...examples[mode()].map((example) => {
      const chip = h(
        'button',
        { type: 'button', class: 'chip' },
        example.label
      );
      chip.addEventListener('click', () => void runExample(example));
      return h('li', {}, chip);
    })
  );
}

form.addEventListener('change', (event) => {
  if ((event.target as HTMLInputElement).name !== 'mode') return;
  placeholderIndex = 0;
  showPlaceholder();
  renderExamples();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (value) void run(mode(), value);
});

$<HTMLButtonElement>('#clear-cache').addEventListener('click', async () => {
  await clearCache();
  setResult(h('p', { class: 'status' }, 'Cache cleared.'));
});

// a newer run supersedes any still in flight
let currentRun = 0;

function setResult(...nodes: Node[]) {
  result.replaceChildren(...nodes);
}

function setBusy(busy: boolean) {
  button.disabled = busy;
  result.setAttribute('aria-busy', String(busy));
}

async function runExample(example: Example) {
  const runId = ++currentRun;
  const currentMode = mode();
  setBusy(true);
  setResult(h('p', { class: 'status' }, 'Finding a current example…'));
  try {
    const value = await example.input();
    if (runId !== currentRun) return;
    input.value = value;
    await run(currentMode, value);
  } catch (error) {
    if (runId !== currentRun) return;
    setBusy(false);
    setResult(renderError(error, currentMode, ''));
  }
}

async function run(currentMode: Mode, value: string) {
  const runId = ++currentRun;
  setBusy(true);
  setResult(h('p', { class: 'status' }, 'Fetching…'));
  const start = performance.now();
  try {
    const nodes =
      currentMode === 'company'
        ? renderJobsList(await listCompanyJobs(value))
        : renderJob(await fetchJob(value));
    if (runId !== currentRun) return;
    const elapsed = Math.round(performance.now() - start);
    setResult(...nodes, h('p', { class: 'elapsed' }, `Took ${elapsed} ms`));
  } catch (error) {
    if (runId !== currentRun) return;
    setResult(renderError(error, currentMode, value));
  } finally {
    if (runId === currentRun) setBusy(false);
  }
}

const jobLink = (job: ListedJob) =>
  h('a', { href: job.url, target: '_blank', rel: 'noopener' }, job.title);

function renderJobsList(jobs: ListedJob[]): Node[] {
  const count = h(
    'p',
    { class: 'count' },
    `${jobs.length.toLocaleString()} open ${jobs.length === 1 ? 'job' : 'jobs'}`
  );
  if (!jobs.length) return [count];
  return [
    count,
    h(
      'ul',
      { class: 'jobs' },
      ...jobs.map((job) =>
        h(
          'li',
          {},
          jobLink(job),
          h('span', { class: 'location' }, job.location)
        )
      )
    ),
  ];
}

function renderJob(job: Job): Node[] {
  return [
    h('h2', { class: 'job-title' }, jobLink(job)),
    h('p', { class: 'location' }, job.location),
    h('pre', { class: 'content' }, formatContent(job.content)),
  ];
}

/** Pretty-prints JSON content; anything else (markdown, text) is shown as-is */
function formatContent(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function renderError(error: unknown, currentMode: Mode, value: string): Node {
  const blocked =
    error instanceof CorsError ||
    (error instanceof UnresolvedCompanyError && error.blocked);

  if (!blocked) {
    const message = error instanceof Error ? error.message : String(error);
    return h('p', { class: 'error', role: 'alert' }, message);
  }

  const fn = currentMode === 'company' ? 'listCompanyJobs' : 'fetchJob';
  // single-quoted for the shell, so only `'` needs escaping
  const arg = JSON.stringify(value).replaceAll("'", `'\\''`);
  const snippet = [
    'npm install @chrisdothtml/job-scraper',
    `node --input-type=module -e 'import { ${fn} } from "@chrisdothtml/job-scraper"; console.log(await ${fn}(${arg}))'`,
  ].join('\n');

  return h(
    'div',
    { class: 'notice' },
    h(
      'p',
      {},
      "This company's job board blocks requests from browsers (CORS), so it can't be reached from this live demo. It works when the package runs in Node:"
    ),
    h('pre', {}, h('code', {}, snippet))
  );
}

showPlaceholder();
renderExamples();
