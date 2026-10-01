import { platform } from '#platform';

/**
 * The package.json version for this package. Published builds of
 * this package use a generated baked-in string for this (see
 * `scripts/bakeVersion.ts`), but during local development it's
 * loaded on the fly
 */
export const pkgVersion: string = ((v: string) => {
  // use the baked-in string if it's not the placeholder
  if (v.charAt(0) !== '[') return v;

  return platform.sourceVersion();
})('[VERSION_PLACEHOLDER]');
