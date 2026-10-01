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
import { descriptionHtml } from './description.ts';
import { addCopyButton, enhanceDocs, enhanceTabs } from './docs.ts';
import { highlightTs } from './highlight.ts';
import { sanitizeHtml } from './sanitize.ts';

type Mode = 'company' | 'job';

interface Example {
  label: string;
  /** The company behind the example, for a Node command if it's blocked */
  company: string;
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
    'https://jobs.lever.co/spotify',
  ],
  job: [
    'https://job-boards.greenhouse.io/airbnb/jobs/7712345',
    'https://jobs.ashbyhq.com/zapier/cb1aec2c-05cd-4598-8117-bd1f7ed9a49f',
    'https://careers.airbnb.com/positions/8184174?gh_jid=8184174',
  ],
};

const examples: Record<Mode, Example[]> = {
  company: [
    { label: 'Airbnb', company: 'Airbnb', input: async () => 'Airbnb' },
    {
      label: 'Ashby board URL',
      company: 'https://jobs.ashbyhq.com/zapier',
      input: async () => 'https://jobs.ashbyhq.com/zapier',
    },
    {
      label: 'Careers site',
      company: 'https://careers.duolingo.com',
      input: async () => 'https://careers.duolingo.com',
    },
  ],
  job: [
    {
      label: 'Greenhouse job URL',
      company: 'Airbnb',
      input: async () =>
        `https://job-boards.greenhouse.io/airbnb/jobs/${(await firstJob('Airbnb')).id}`,
    },
    {
      label: 'Ashby job URL',
      company: 'Zapier',
      input: async () => (await firstJob('Zapier')).url,
    },
    {
      // Airbnb's own careers site embeds its Greenhouse board via `?gh_jid=`
      label: 'Embedded ?gh_jid= URL',
      company: 'Airbnb',
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
const inCode = $<HTMLElement>('#in-code');

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
  showInCode();
}

/** The call the demo is about to make, for whatever's typed (or suggested) */
function showInCode() {
  const fn = mode() === 'company' ? 'listCompanyJobs' : 'fetchJob';
  const value = input.value.trim() || input.placeholder.replace(/^e\.g\. /, '');
  // highlightTs escapes everything it's given
  inCode.innerHTML = highlightTs(
    `await ${fn}('${value.replace(/['\\]/g, '\\$&')}')`
  );
  inCode.parentElement!.hidden = false;
}

input.addEventListener('input', showInCode);
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
  // whatever was in flight was for the other mode, so drop it
  currentRun++;
  setBusy(false);
  setResult();
  placeholderIndex = 0;
  showPlaceholder();
  renderExamples();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (value) void run(mode(), value);
});

const status = (text: string) =>
  h(
    'p',
    { class: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    text
  );

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
  setResult(status('Finding a current example…'));
  try {
    const value = await example.input();
    if (runId !== currentRun) return;
    input.value = value;
    showInCode();
    await run(currentMode, value);
  } catch (error) {
    if (runId !== currentRun) return;
    setBusy(false);
    // the example's URL never resolved, so point Node at its company instead
    setResult(
      renderError(
        error,
        currentMode === 'company'
          ? nodeCall('listCompanyJobs', example.company)
          : {
              fns: ['listCompanyJobs', 'fetchJob'],
              expr: `fetchJob((await listCompanyJobs(${JSON.stringify(example.company)}))[0].url)`,
            }
      )
    );
  }
}

async function run(currentMode: Mode, value: string) {
  const runId = ++currentRun;
  setBusy(true);
  setResult(status('Fetching…'));
  const start = performance.now();
  try {
    const data =
      currentMode === 'company'
        ? await listCompanyJobs(value)
        : await fetchJob(value);
    if (runId !== currentRun) return;
    const elapsed = Math.round(performance.now() - start);
    const rendered = Array.isArray(data)
      ? renderJobsList(data)
      : renderJob(data);
    setResult(
      ...(Array.isArray(data) ? [renderCount(data)] : []),
      renderViews(rendered, data),
      h('p', { class: 'elapsed' }, `Took ${elapsed} ms`)
    );
  } catch (error) {
    if (runId !== currentRun) return;
    setResult(
      renderError(
        error,
        nodeCall(
          currentMode === 'company' ? 'listCompanyJobs' : 'fetchJob',
          value
        )
      )
    );
  } finally {
    if (runId === currentRun) setBusy(false);
  }
}

const jobLink = (job: ListedJob) =>
  h('a', { href: job.url, target: '_blank', rel: 'noopener' }, job.title);

const renderCount = (jobs: ListedJob[]) =>
  h(
    'p',
    { class: 'count' },
    `${jobs.length.toLocaleString()} open ${jobs.length === 1 ? 'job' : 'jobs'}`
  );

// which of the result's views is showing, kept across runs
let resultView = 0;

/** The result as rendered, with a tab to see the raw value returned instead */
function renderViews(rendered: Node[], data: unknown): Node {
  const json = h(
    'div',
    { class: 'code-block', 'data-lang': 'json' },
    h('pre', {})
  );
  // highlightTs escapes everything it's given
  json.firstElementChild!.innerHTML = `<code>${highlightTs(JSON.stringify(data, null, 2))}</code>`;
  addCopyButton(json);

  const views = h(
    'div',
    { class: 'tabs tabs-small', 'data-label': 'Result view' },
    h(
      'div',
      { class: 'tab-panel' },
      h('h3', { class: 'tab-label' }, 'Rendered'),
      ...rendered
    ),
    h(
      'div',
      { class: 'tab-panel' },
      h('h3', { class: 'tab-label' }, 'JSON'),
      json
    )
  );
  enhanceTabs(views, {
    selected: resultView,
    onSelect: (index) => (resultView = index),
  });
  return views;
}

function renderJobsList(jobs: ListedJob[]): Node[] {
  if (!jobs.length) return [h('p', { class: 'status' }, 'No open jobs.')];
  return [
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
    h(
      'div',
      { class: 'job-head' },
      h('h2', { class: 'job-title' }, jobLink(job)),
      h('span', { class: 'location' }, job.location)
    ),
    ...renderContent(job.content),
  ];
}

/**
 * Renders the description formatted (through the allowlist sanitizer) with
 * the raw content tucked away beneath it, or just the raw content when no
 * description can be found
 */
function renderContent(content: string): Node[] {
  const raw = h('pre', { class: 'content' }, formatContent(content));
  const html = descriptionHtml(content);
  if (!html) return [raw];
  return [
    h('div', { class: 'description' }, sanitizeHtml(html)),
    h('details', { class: 'raw' }, h('summary', {}, 'Raw content'), raw),
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

/** A call to run from Node, for boards the browser can't reach */
interface NodeCall {
  fns: string[];
  expr: string;
}

const nodeCall = (fn: string, arg: string): NodeCall => ({
  fns: [fn],
  expr: `${fn}(${JSON.stringify(arg)})`,
});

function renderError(error: unknown, call: NodeCall): Node {
  const blocked =
    error instanceof CorsError ||
    (error instanceof UnresolvedCompanyError && error.blocked);

  if (!blocked) {
    const message = error instanceof Error ? error.message : String(error);
    return h('p', { class: 'error', role: 'alert' }, message);
  }

  const script = `import { ${call.fns.join(', ')} } from "@chrisdothtml/job-scraper"; console.log(await ${call.expr})`;
  const snippet = [
    'npm install @chrisdothtml/job-scraper',
    // single-quoted for the shell, so only `'` needs escaping
    `node --input-type=module -e '${script.replaceAll("'", `'\\''`)}'`,
  ].join('\n');

  const code = h(
    'div',
    { class: 'code-block', 'data-lang': 'sh' },
    h('pre', {}, h('code', {}, snippet))
  );
  addCopyButton(code);

  return h(
    'div',
    { class: 'notice' },
    h(
      'div',
      {},
      h('p', { class: 'notice-title' }, 'Works locally, not in this demo'),
      h(
        'p',
        {},
        "This company's job board blocks requests from browsers (CORS), so the demo can't reach it. The package works the same from Node:"
      ),
      code
    )
  );
}

showPlaceholder();
renderExamples();
enhanceDocs();
