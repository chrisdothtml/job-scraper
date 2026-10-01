/**
 * Everything the core needs from the runtime it's running in. `#platform`
 * resolves to the Node or the browser implementation by export condition (see
 * `imports` in package.json), which is what keeps every `node:` import out of
 * a browser bundle. Both implement this one interface, so there's one set of
 * types for both.
 */
export interface Platform {
  /**
   * Whether the runtime enforces CORS, i.e. whether a fetch rejecting with a
   * `TypeError` can mean a board refused a cross-origin request
   */
  readonly enforcesCors: boolean;
  /** Reads a setting from the environment. Always unset in browsers */
  env(name: string): string | undefined;
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly companiesFile: string;
  /** Where a named piece of state (`search-usage.json`, say) is kept */
  dataFile(name: string): string;
  /** Reads a small text document, e.g. the registry. Null when there's none */
  readText(file: string): Promise<string | null>;
  /** Replaces a small text document whole */
  writeText(file: string, contents: string): Promise<void>;
  readonly responseCache: ResponseCache;
  /** The package.json version. Only consulted by unbuilt sources */
  sourceVersion(): string;
}

export interface CachedResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

/** Where `cachedFetch` keeps response bodies */
export interface ResponseCache {
  /**
   * The response stored under `key` in `dir`, or null when there's none or
   * it's at least `ttl` milliseconds old
   */
  get(dir: string, key: string, ttl: number): Promise<Response | null>;
  put(dir: string, key: string, res: CachedResponse): Promise<void>;
  /** Deletes every response in `dir`. Returns how many were removed */
  clear(dir: string): Promise<number>;
}
