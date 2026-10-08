# CLI

Owns command-line argument handling and output. The public package facade is
browser-safe; the CLI is a separate Node-oriented path. [`runCli.ts`](./runCli.ts)
contains the runner, while [`../cli.ts`](../cli.ts) remains the executable
source shim used by the package binary.

- [`runCli.ts`](./runCli.ts): parse inputs, invoke package operations, and
  format CLI results.
- [`__tests__/runCli.test.ts`](./__tests__/runCli.test.ts): CLI behavior tests.

Keep CLI-specific behavior here. Shared library functions belong in their
feature modules and should be imported directly.
