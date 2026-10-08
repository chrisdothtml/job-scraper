# Development scripts

Maintenance and development entrypoints live here; they are not part of the
published library API.

- [`checkBoards.ts`](./checkBoards.ts): check seeded boards against their live
  endpoints and report failures or empty results.
- [`bakeVersion.ts`](./bakeVersion.ts): embed the package version into built
  output during packaging.

Keep these scripts explicit entrypoints and leave runtime-specific script
imports out of library modules.
