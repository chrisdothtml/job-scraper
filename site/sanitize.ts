/**
 * A small allowlist sanitizer for job descriptions. The input is parsed (which
 * never runs scripts) and rebuilt from scratch: only the tags below survive,
 * with no attributes besides a link's http(s) `href`.
 */
const allowed = new Set(
  'p br ul ol li strong b em i h1 h2 h3 h4 h5 h6 a blockquote code pre'.split(
    ' '
  )
);
// dropped along with everything inside them
const dropped = new Set(
  'script style iframe object embed noscript template svg math head title meta link form button input select textarea img video audio canvas'.split(
    ' '
  )
);
// unwrapped, but kept as a paragraph when they only hold inline content, so
// `<div>a</div><div>b</div>` doesn't run together into "ab"
const blocks = new Set('div section article header footer tr'.split(' '));
const blockChildren = [...allowed, ...blocks].filter((tag) => tag !== 'br');

export function sanitizeHtml(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createDocumentFragment();
  rebuild(doc.body, out);
  return out;
}

function rebuild(from: Node, to: Node) {
  for (const node of from.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      to.appendChild(document.createTextNode(node.textContent ?? ''));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const source = node as Element;
    const tag = source.localName;
    if (dropped.has(tag)) continue;

    let target: Node = to;
    if (allowed.has(tag)) {
      const el = document.createElement(tag);
      const href = source.getAttribute('href');
      if (tag === 'a' && href && /^https?:\/\//i.test(href)) {
        Object.assign(el, {
          href,
          rel: 'noopener noreferrer',
          target: '_blank',
        });
      }
      target = to.appendChild(el);
    } else if (
      blocks.has(tag) &&
      !source.querySelector(blockChildren.join(','))
    ) {
      target = to.appendChild(document.createElement('p'));
    }
    rebuild(source, target);
  }
}
