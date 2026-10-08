/**
 * Small HTML utilities (no DOM available on the server):
 *
 * - `decodeHtmlEntities()`
 * - `htmlToText()`: plain text, e.g. calendar event descriptions for an llm.
 *   Same tree walk as `htmlToMarkdown()` (so nested lists keep their
 *   indentation), minus the markdown syntax
 * - `htmlToMarkdown()`: a forgiving converter for scraped content (e.g. job
 *   postings). Keeps headings, paragraphs, (nested) lists, links,
 *   bold/italic, inline code, code blocks, blockquotes and rules; everything
 *   else is unwrapped to its text, and scripts/styles/images (and elements
 *   hidden with `display: none`, e.g. an email's preheader) are dropped
 *   entirely. `<div>`s without blocks inside are lines, not paragraphs
 *   (`<div>a</div><div><br></div><div>b</div>`, as Gmail/Google Calendar
 *   write them, is two paragraphs)
 *
 * Kept hand-rolled on purpose: a bake-off against Turndown (+ domino, gfm
 * plugin) on real calendar descriptions, recruiting emails and job postings
 * found Turndown keeping email layout tables as raw HTML (with entities),
 * adding `-   ` loose-list padding and whitespace-only lines, bolding
 * headings twice (`### **About**`) and needing a custom escape and a whole
 * text-mode rule set; this module's output was cleaner on every sample.
 *
 * @example
 * htmlToMarkdown('<h2>About</h2><p>We <b>ship</b></p><ul><li>TS</li></ul>');
 * //-> '## About\n\nWe **ship**\n\n- TS'
 */

type TextNode = { type: 'text'; text: string };
type ElementNode = {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
};
type Node = TextNode | ElementNode;

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Dropped along with everything inside them */
const DROPPED_TAGS = new Set([
  'button',
  'canvas',
  'head',
  'iframe',
  'noscript',
  'object',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'title',
]);

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'center',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'html',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

/**
 * HTML's implied end tags (simplified): opening one of `openers` closes the
 * nearest open element in `closes`, unless a `boundaries` element is open
 * inside it (e.g. a `<div>` in a `<td>` doesn't close a `<p>` around the
 * table)
 */
const IMPLIED_END_TAGS = [
  {
    openers: new Set([
      ...[...BLOCK_TAGS].filter(
        (tag) => !/^(t[dhr]|tbody|thead|tfoot)$/.test(tag)
      ),
      'hgroup',
      'menu',
    ]),
    closes: new Set(['p']),
    boundaries: new Set(['button', 'caption', 'object', 'table', 'td', 'th']),
  },
  {
    openers: new Set(['li']),
    closes: new Set(['li']),
    boundaries: new Set(['menu', 'ol', 'table', 'td', 'th', 'ul']),
  },
  {
    openers: new Set(['dd', 'dt']),
    closes: new Set(['dd', 'dt']),
    boundaries: new Set(['dl', 'table', 'td', 'th']),
  },
  {
    openers: new Set(['td', 'th']),
    closes: new Set(['td', 'th']),
    boundaries: new Set(['table', 'tr']),
  },
  {
    openers: new Set(['tr']),
    closes: new Set(['tr']),
    boundaries: new Set(['table', 'tbody', 'tfoot', 'thead']),
  },
  {
    openers: new Set(['tbody', 'tfoot', 'thead']),
    closes: new Set(['tbody', 'tfoot', 'thead']),
    boundaries: new Set(['table']),
  },
];

const HEADING_LEVELS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

/**
 * Zero-width/invisible characters (e.g. the `&zwnj;&#847;` padding of email
 * preheaders); ZWJ is kept for emoji sequences
 */
const INVISIBLE_CHARS = /[\u00ad\u034f\u200b\u200c\u200e\u200f\u2060\ufeff]/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwj: '',
  zwnj: '',
  shy: '',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  bull: '•',
  middot: '·',
  deg: '°',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  rarr: '→',
  larr: '←',
  check: '✓',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  agrave: 'à',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
};

/** Decodes named (common ones) and numeric HTML entities */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
    (match, entity: string) => {
      if (entity[0] === '#') {
        const code =
          entity[1] === 'x' || entity[1] === 'X'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) {
          return match;
        }
        return code === 0xa0 ? ' ' : String.fromCodePoint(code);
      }
      return (
        NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match
      );
    }
  );
}

/** Whether `text` contains (raw) HTML tags */
export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/i.test(text);
}

/** Whether `text` is entity-escaped HTML (e.g. `&lt;p&gt;Hi&lt;/p&gt;`) */
export function looksLikeEscapedHtml(text: string): boolean {
  return /&lt;\/?[a-z][a-z0-9]*(?:\s|&gt;|\/&gt;)/i.test(text);
}

/*
 * Parsing
 */

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re =
    /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(re)) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(
      match[2] ?? match[3] ?? match[4] ?? ''
    );
  }
  return attrs;
}

/** Parses HTML into a tree, tolerating unclosed/stray tags */
function parse(html: string): Node[] {
  const root: ElementNode = {
    type: 'element',
    tag: '#root',
    attrs: {},
    children: [],
  };
  const stack: ElementNode[] = [root];
  const current = () => stack[stack.length - 1];

  const re =
    /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let index = 0;

  const pushText = (text: string) => {
    if (text) current().children.push({ type: 'text', text });
  };

  for (let match = re.exec(html); match; match = re.exec(html)) {
    pushText(html.slice(index, match.index));
    index = re.lastIndex;

    const [, closing, rawTag, rawAttrs = ''] = match;
    // comments, doctypes, etc.
    if (!rawTag) continue;
    const tag = rawTag.toLowerCase();

    if (closing) {
      const openIndex = stack.findLastIndex((node) => node.tag === tag);
      // (stray closing tags are ignored)
      if (openIndex > 0) stack.length = openIndex;
      continue;
    }

    if (DROPPED_TAGS.has(tag)) {
      // skip to the matching closing tag (content is dropped too)
      if (!rawAttrs.trimEnd().endsWith('/')) {
        const end = html.toLowerCase().indexOf(`</${tag}`, index);
        if (end === -1) {
          index = html.length;
          break;
        }
        re.lastIndex = end;
        index = end;
      }
      continue;
    }

    const node: ElementNode = {
      type: 'element',
      tag,
      attrs: parseAttrs(rawAttrs),
      children: [],
    };

    // end tags HTML lets authors omit (e.g. `<p>a<div>`, `<td>a<td>b`)
    for (const rule of IMPLIED_END_TAGS) {
      if (!rule.openers.has(tag)) continue;
      for (let i = stack.length - 1; i > 0; i--) {
        if (rule.boundaries.has(stack[i].tag)) break;
        if (rule.closes.has(stack[i].tag)) {
          stack.length = i;
          break;
        }
      }
    }

    // hidden elements are still parsed (to consume their content) but never
    // attached
    if (!isHidden(node)) current().children.push(node);
    if (!VOID_TAGS.has(tag) && !rawAttrs.trimEnd().endsWith('/')) {
      stack.push(node);
    }
  }
  pushText(html.slice(index));

  return root.children;
}

function isHidden(node: ElementNode): boolean {
  return (
    'hidden' in node.attrs || effectiveDisplay(node.attrs.style) === 'none'
  );
}

/**
 * An inline style's effective `display`: the last declaration, unless an
 * earlier one is `!important` (and the later one isn't)
 */
function effectiveDisplay(style: string | undefined): string | null {
  let value: string | null = null;
  let important = false;
  for (const declaration of style?.split(';') ?? []) {
    const match = declaration.match(
      /^\s*display\s*:\s*([^!]*?)\s*(!\s*important)?\s*$/i
    );
    if (!match) continue;
    if (important && !match[2]) continue;
    value = match[1].toLowerCase();
    important = Boolean(match[2]);
  }
  return value;
}

/*
 * Rendering
 */

function isBlock(node: Node): boolean {
  return node.type === 'element' && BLOCK_TAGS.has(node.tag);
}

function hasBlockDescendant(node: ElementNode): boolean {
  return node.children.some(
    (child) =>
      child.type === 'element' && (isBlock(child) || hasBlockDescendant(child))
  );
}

/** Raw text (e.g. of `<pre>`), keeping `<br>`s as line breaks */
function textContent(node: Node): string {
  if (node.type === 'text') {
    return decodeHtmlEntities(node.text).replace(INVISIBLE_CHARS, '');
  }
  if (node.tag === 'br') return '\n';
  return node.children.map(textContent).join('');
}

/** Whether `node` contains anything rendered on lines of its own */
function hasLineBreaks(node: ElementNode): boolean {
  return node.children.some(
    (child) =>
      child.type === 'element' &&
      (child.tag === 'br' || isBlock(child) || hasLineBreaks(child))
  );
}

/** Only links that make sense outside of the original page */
function safeHref(href: string | undefined): string | null {
  const value = href?.trim();
  if (!value || !/^(https?:|mailto:)/i.test(value)) return null;
  return value.replace(/[\s()]/g, (char) => encodeURIComponent(char));
}

/** Moves leading/trailing whitespace outside of a wrapping marker */
function wrap(content: string, marker: string): string {
  const match = content.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  const [, before, inner, after] = match;
  // (e.g. `<b><strong>x</strong></b>`)
  if (!inner || (inner.startsWith(marker) && inner.endsWith(marker))) {
    return content;
  }
  return `${before}${marker}${inner}${marker}${after}`;
}

type RenderOptions = {
  /**
   * plain text instead of markdown: no emphasis/code/link/heading/quote
   * syntax (lists keep their `- `/`1. ` markers and indentation)
   */
  text?: boolean;
};

type InlineOptions = RenderOptions & {
  /** drop emphasis (e.g. inside headings, which are already bold) */
  plain?: boolean;
};

/**
 * Renders inline content. Newlines in the output are hard line breaks
 * (`<br>`); source whitespace is collapsed to spaces.
 */
function renderInline(nodes: Node[], options: InlineOptions = {}): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += decodeHtmlEntities(node.text.replace(/\s+/g, ' '))
        .replace(INVISIBLE_CHARS, '')
        .replace(/\u00a0/g, ' ');
      continue;
    }

    const inner = () => renderInline(node.children, options);
    switch (node.tag) {
      case 'br':
        out += '\n';
        break;
      case 'img':
      case 'wbr':
        break;
      case 'strong':
      case 'b':
        out += options.plain || options.text ? inner() : wrap(inner(), '**');
        break;
      case 'em':
      case 'i':
        out += options.plain || options.text ? inner() : wrap(inner(), '*');
        break;
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt': {
        const code = textContent(node).replace(/\s+/g, ' ');
        out +=
          code.trim() && !options.text
            ? `\`${code.replaceAll('`', "'")}\``
            : code;
        break;
      }
      case 'a': {
        const text = inner();
        const href = safeHref(node.attrs.href);
        out +=
          href && text.trim() && !options.text ? wrapLink(text, href) : text;
        break;
      }
      case 'div': {
        // a line of its own (a `<div><br></div>` is a blank one)
        const text = inner();
        if (!text.trim() && !text.includes('\n')) break;
        if (out && !out.endsWith('\n')) out += '\n';
        out += `${text}\n`;
        break;
      }
      default:
        // block elements nested in inline context (e.g. a `<div>` inside a
        // `<span>`) still separate their content
        out += isBlock(node) ? `\n${inner()}\n` : inner();
    }
  }
  return out;
}

function wrapLink(text: string, href: string): string {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  const [, before, inner, after] = match;
  return `${before}[${inner.replace(/\n/g, ' ').replace(/[\\[\]]/g, '\\$&')}](${href})${after}`;
}

/** Tidies an inline run into lines of a paragraph */
function cleanParagraph(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderList(
  list: ElementNode,
  ordered: boolean,
  options: RenderOptions
): string {
  const items = list.children.filter(
    (child) => child.type === 'element' || child.text.trim()
  );
  const lines: string[] = [];
  let n = Number(list.attrs.start) || 1;

  // stray content between `<li>`s is treated as its own item
  for (const item of items) {
    const children =
      item.type === 'element' && item.tag === 'li' ? item.children : [item];
    const blocks = renderBlocks(children, options);
    if (!blocks.length) continue;

    const marker = ordered ? `${n++}. ` : '- ';
    const indent = ' '.repeat(marker.length);
    const body = blocks
      .join('\n')
      .split('\n')
      .filter((line) => line.trim())
      .map((line, i) => (i === 0 ? marker : indent) + line)
      .join('\n');
    lines.push(body);
  }
  return lines.join('\n');
}

/** Renders nodes as markdown blocks (joined by blank lines by the caller) */
function renderBlocks(nodes: Node[], options: RenderOptions = {}): string[] {
  const blocks: string[] = [];
  let inline: Node[] = [];

  const flushInline = () => {
    const text = cleanParagraph(renderInline(inline, options));
    inline = [];
    // `<br><br>` separates paragraphs
    for (const paragraph of text.split(/\n{2,}/)) {
      if (paragraph.trim()) blocks.push(paragraph);
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (
      node.type === 'text' ||
      ((!isBlock(node) || node.tag === 'div') && !hasBlockDescendant(node))
    ) {
      inline.push(node);
      continue;
    }

    flushInline();
    const heading = HEADING_LEVELS[node.tag];
    if (heading) {
      const text = cleanParagraph(
        renderInline(node.children, { ...options, plain: true })
      ).replace(/\s*\n\s*/g, ' ');
      if (text) {
        blocks.push(options.text ? text : `${'#'.repeat(heading)} ${text}`);
      }
      continue;
    }

    switch (node.tag) {
      case 'ul':
      case 'ol': {
        const list = renderList(node, node.tag === 'ol', options);
        if (list) blocks.push(list);
        break;
      }
      case 'li': {
        // `<li>`s without a list around them; group consecutive ones
        const items: Node[] = [node];
        while (i + 1 < nodes.length && isLiOrBlank(nodes[i + 1])) {
          items.push(nodes[++i]);
        }
        const list = renderList(
          { type: 'element', tag: 'ul', attrs: {}, children: items },
          false,
          options
        );
        if (list) blocks.push(list);
        break;
      }
      case 'pre': {
        const code = textContent(node).replace(/^\n|\n\s*$/g, '');
        if (code.trim() && options.text) {
          blocks.push(code);
        } else if (code.trim()) {
          const runs = code.match(/`+/g) ?? [];
          const fence = '`'.repeat(
            Math.max(3, ...runs.map((run) => run.length + 1))
          );
          blocks.push(`${fence}\n${code}\n${fence}`);
        }
        break;
      }
      case 'blockquote': {
        const inner = renderBlocks(node.children, options).join('\n\n');
        if (inner && options.text) {
          blocks.push(inner);
        } else if (inner) {
          blocks.push(
            inner
              .split('\n')
              .map((line) => (line ? `> ${line}` : '>'))
              .join('\n')
          );
        }
        break;
      }
      case 'hr':
        if (!options.text) blocks.push('---');
        break;
      case 'tr': {
        const cellNodes = node.children.filter(
          (cell) => cell.type === 'element'
        );
        // layout tables (e.g. an email's body, or a schedule list in a
        // cell): render each cell's content as blocks
        if (cellNodes.some(hasLineBreaks)) {
          for (const cell of cellNodes) {
            blocks.push(...renderBlocks(cell.children, options));
          }
          break;
        }
        // data tables are flattened to a line per row
        const cells = cellNodes
          .map((cell) =>
            cleanParagraph(renderInline([cell], options)).replace(
              /\s*\n\s*/g,
              ' '
            )
          )
          .filter(Boolean);
        if (cells.length) blocks.push(cells.join(' · '));
        break;
      }
      default:
        blocks.push(...renderBlocks(node.children, options));
    }
  }
  flushInline();

  return blocks;
}

function isLiOrBlank(node: Node) {
  return node.type === 'text' ? !node.text.trim() : node.tag === 'li';
}

/** Converts HTML to readable markdown; see the top of this file */
export function htmlToMarkdown(html: string): string {
  return renderBlocks(parse(html))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A plain-text rendering of an HTML snippet (e.g. a calendar event's
 * description): `htmlToMarkdown()`'s structure (paragraphs, line breaks,
 * nested/ordered lists with indentation, table rows) without its inline
 * syntax; links keep only their text. Text that doesn't look like HTML only
 * gets its whitespace tidied.
 *
 * Not a sanitizer; only for feeding text to an llm or similar.
 */
export function htmlToText(html: string): string {
  const text = html.replace(/\r\n?/g, '\n');
  if (/<[a-z/!][^>]*>/i.test(text)) {
    return renderBlocks(parse(text), { text: true })
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(INVISIBLE_CHARS, '')
        .replace(/[ \t\u00a0]+/g, ' ')
        .trim()
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
