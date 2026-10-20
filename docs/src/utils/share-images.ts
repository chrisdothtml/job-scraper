import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
// Satori requires WOFF/TTF/OTF; browsers use the adjacent WOFF2 files.
import plex400 from '../assets/fonts/plex-sans-400.woff?inline';
import plex600 from '../assets/fonts/plex-sans-600.woff?inline';

const shareImageSize = { width: 1200, height: 630 };

const fonts = (
  [
    [400, plex400],
    [600, plex600],
  ] as const
).map(([weight, dataUrl]) => ({
  name: 'IBM Plex Sans',
  weight,
  style: 'normal' as const,
  data: Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'),
}));

type Node =
  | string
  | false
  | undefined
  | { type: 'div'; key: null; props: object };

// Satori takes React-shaped element objects, so React itself is unnecessary.
// Like createElement, a lone child is passed bare: satori requires flex layout
// for any non-string children, even an empty array.
function div(style: object, ...children: Node[]): Node {
  const nodes = children.filter(Boolean);
  return {
    type: 'div',
    key: null,
    props: { style, children: nodes.length > 1 ? nodes : nodes[0] },
  };
}

/** Build-only renderer; uses the page's resolved Starlight metadata. */
export async function renderShareImage(
  title: string,
  description: string | undefined
) {
  const svg = await satori(
    div(
      {
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
      div(
        { display: 'flex', alignItems: 'center', gap: 16, fontSize: 30 },
        div({ width: 20, height: 20, background: '#4cc48a' }),
        'job-scraper'
      ),
      div(
        { display: 'flex', flexDirection: 'column', gap: 24 },
        div({ fontSize: 64, fontWeight: 600, lineHeight: 1.1 }, title),
        description &&
          div({ fontSize: 28, lineHeight: 1.4, color: '#9b9a93' }, description)
      ),
      div(
        { fontSize: 24, color: '#4cc48a' },
        'chrisdothtml.github.io/job-scraper'
      )
    ),
    { ...shareImageSize, fonts }
  );
  return new Uint8Array(new Resvg(svg).render().asPng());
}
