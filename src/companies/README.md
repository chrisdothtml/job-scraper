# Companies

Owns the company records used by resolution: shipped seed data and the
read/write registry. Registry persistence goes through the platform adapter,
which provides the runtime-specific atomic write behavior.

- [`seed.ts`](./seed.ts): known company records shipped with the package; add
  or update seed entries here.
- [`registry.ts`](./registry.ts): normalize and look up companies, reconcile
  stored records with seeds, and register discovered companies/domains.
- [`__tests__/registry.test.ts`](./__tests__/registry.test.ts): registry
  behavior and persistence coverage.

Keep company matching and stored-record rules here. Board probing and URL
resolution belong in `../discovery/`; new board types belong in
`../scrapers/`.
