/**
 * Build-time syntax highlighting for the docs' TypeScript snippets: a tiny
 * tokenizer that wraps comments, strings, numbers, keywords and function
 * calls in spans, so the page ships no highlighter.
 */

const keywords = new Set(
  (
    'as async await break case catch class const continue default delete do ' +
    'else export extends false finally for from function if import in ' +
    'instanceof interface let new null of return throw true try type ' +
    'typeof undefined using void while'
  ).split(' ')
);

const token =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\b(\d[\d_]*(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=(\s*\()?)/g;

export const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const span = (kind: string, text: string) =>
  `<span class="tok-${kind}">${escapeHtml(text)}</span>`;

export function highlightTs(code: string): string {
  let html = '';
  let last = 0;

  for (const match of code.matchAll(token)) {
    const [text, comment, string, number, word, call] = match;
    html += escapeHtml(code.slice(last, match.index));
    last = match.index + text.length;

    if (comment) html += span('comment', text);
    else if (string) html += span('string', text);
    else if (number) html += span('number', text);
    else if (word && keywords.has(word)) html += span('keyword', text);
    else if (word && call !== undefined) html += span('fn', text);
    else html += escapeHtml(text);
  }

  return html + escapeHtml(code.slice(last));
}
