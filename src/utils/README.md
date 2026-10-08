# Shared utilities

Contains small helpers used across library features. Utilities with one clear
owner should live alongside that feature instead of being moved here.

- [`misc.ts`](./misc.ts): time constants, URL construction, and configuration
  override merging.

Import these helpers directly from `misc.ts`. Prefer a local helper when the
behavior is specific to companies, discovery, rendering, or another module.
