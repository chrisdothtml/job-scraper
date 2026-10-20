import type { RenderFunctionInput } from 'astro-opengraph-images';
import { createElement as h } from 'react';

/** Build-only renderer; uses the page's resolved Starlight metadata. */
export function renderShareImage({ title, description }: RenderFunctionInput) {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: '64px 72px',
        background: '#101110',
        color: '#e8e7e2',
        fontFamily: 'IBM Plex Sans',
        borderTop: '12px solid #4cc48a',
      },
    },
    h(
      'div',
      {
        style: { display: 'flex', alignItems: 'center', gap: 16, fontSize: 30 },
      },
      h('div', { style: { width: 20, height: 20, background: '#4cc48a' } }),
      'job-scraper'
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 24 } },
      h(
        'div',
        { style: { fontSize: 64, fontWeight: 600, lineHeight: 1.1 } },
        title
      ),
      description &&
        h(
          'div',
          { style: { fontSize: 28, lineHeight: 1.4, color: '#9b9a93' } },
          description
        )
    ),
    h(
      'div',
      { style: { fontSize: 24, color: '#4cc48a' } },
      'chrisdothtml.github.io/job-scraper'
    )
  );
}
