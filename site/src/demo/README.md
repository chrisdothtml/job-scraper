# Live documentation demo

The demo entry runs the package in the browser against visitor input. It imports
the source public facade and keeps demo-only parsing and presentation helpers
local to this subtree.

- [`main.ts`](./main.ts): demo interactions and package calls.
- [`utils/description.ts`](./utils/description.ts): extract a description from
  supported board response shapes.
- [`utils/docs.ts`](./utils/docs.ts): accessible tabs and copy controls.
- [`utils/highlight.ts`](./utils/highlight.ts): lightweight TypeScript syntax
  highlighting.
- [`utils/sanitize.ts`](./utils/sanitize.ts): allowlist sanitizer for posting
  HTML before demo insertion.

These helpers serve browser demo presentation and do not define the library's
rendering or sanitization API. Keep DOM-specific behavior here.
