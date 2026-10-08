# Platform adapters

Provides runtime-specific storage, data-directory, and version operations
selected through the package's `#platform` condition. The published package
keeps this indirection so the same source API can build for Node, Bun, Deno,
and browsers.

- [`types.ts`](./types.ts): contract implemented by each runtime adapter.
- [`node.ts`](./node.ts): Node filesystem-backed state and source version.
- [`browser.ts`](./browser.ts): browser Cache API/local storage behavior.
- [`__tests__/browser.test.ts`](./__tests__/browser.test.ts): browser adapter
  tests.

Keep runtime-specific APIs behind this contract. Do not use Bun-only APIs in
published library code; development and test scripts may use Bun.
