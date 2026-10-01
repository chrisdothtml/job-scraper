/**
 * Pulls the human-readable description (as HTML) out of a job's `content`,
 * which for the boards reachable from a browser is the board's own JSON.
 * Returns null when there's no description to be found.
 */
export function descriptionHtml(content: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const job = data as Record<string, any>;

  const html = [
    // Greenhouse: entity-escaped HTML, so decode it once to get the markup
    typeof job.content === 'string' ? decodeEntities(job.content) : null,
    // Ashby
    job.descriptionHtml,
    // Lever: the intro, then titled lists, then a closing section
    job.description,
    ...(Array.isArray(job.lists)
      ? job.lists.map(
          (list: { text?: string; content?: string }) =>
            `<h3>${escape(list.text ?? '')}</h3><ul>${list.content ?? ''}</ul>`
        )
      : []),
    job.additional,
    // SmartRecruiters
    ...Object.values(job.jobAd?.sections ?? {}).map((section: any) =>
      section?.text
        ? `<h3>${escape(section.title ?? '')}</h3>${section.text}`
        : null
    ),
    // Rippling
    job.description?.role,
    job.description?.company,
  ]
    .filter((part): part is string => typeof part === 'string' && !!part.trim())
    .join('\n');

  return html || null;
}

function decodeEntities(text: string): string {
  return new DOMParser().parseFromString(text, 'text/html').body.textContent;
}

function escape(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!
  );
}
