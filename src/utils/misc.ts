/** Readable time durations in milliseconds */
export const time = (() => {
  const second = 1e3;
  const minute = 60 * second;
  const hour = 60 * minute;
  const day = 24 * hour;
  return { second, minute, hour, day } as const;
})();

export function buildUrl(
  base: string,
  path: string,
  params: Record<string, string | number | boolean>
): URL {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

/**
 * Merges user-supplied config over existing overrides, treating an explicit
 * `undefined` as "drop this override" rather than "set it to undefined";
 * without that, a cleared key would shadow the env/default fallback.
 */
export function applyOverrides<T extends object>(
  current: Partial<T>,
  incoming: Partial<T>
): Partial<T> {
  const merged = { ...current };

  for (const key of Object.keys(incoming) as (keyof T)[]) {
    if (incoming[key] === undefined) delete merged[key];
    else merged[key] = incoming[key];
  }

  return merged;
}
