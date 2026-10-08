/** Preserve bookmarks from the former single-page documentation. */
import { legacy } from './legacy-links.ts';

function redirectLegacyHash() {
  const hash = location.hash.slice(1);
  const target = legacy[hash];
  if (target) location.replace(`${import.meta.env.BASE_URL}${target}`);
}
redirectLegacyHash();
addEventListener('hashchange', redirectLegacyHash);
