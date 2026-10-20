import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { siteDescription } from '../../utils/site.ts';
import { renderShareImage } from '../../utils/share-images.ts';

// Emits <page>/index.png beside each page's index.html.
export const getStaticPaths = (async () =>
  (await getCollection('docs'))
    .filter((entry) => entry.id !== '404')
    .map((entry) => ({
      params: { slug: entry.id.replace(/(^|\/)index$/, '') || undefined },
      props: { entry },
    }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ entry: CollectionEntry<'docs'> }> = async ({
  props: { entry },
}) =>
  new Response(
    await renderShareImage(
      entry.data.title,
      entry.data.description ?? siteDescription
    ),
    { headers: { 'Content-Type': 'image/png' } }
  );
