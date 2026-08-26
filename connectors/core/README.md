# core

> **Purpose:** Connector SDK: interface, base class, canonical job schema, plugin registry.

The contract every external source implements, the registry that is the **only** module allowed to
name a connector, and the shared operational behaviour no connector may hand-roll. ADR-0002.

## What is here

| File | Holds |
|---|---|
| `src/contract.ts` | `Connector`, `ConnectorMeta`, `SearchQuery`, `Page`, `ValidationResult`, `HealthStatus` |
| `src/registry.ts` | `ConnectorRegistry` — register, look up by id, filter by kind or region |
| `src/default-registry.ts` | `createRegistry` — the composed registry, the only module that names a connector |
| `src/errors.ts` | `ConnectorError` and the retryable/terminal taxonomy |
| `src/retry.ts` | exponential backoff with full jitter, capped by attempts *and* total time |
| `src/rate-limit.ts` | `RateLimiter` — sliding window budget plus minimum interval |

## The contract

```typescript
interface Connector<TRaw, TNormalized> {
  readonly meta: ConnectorMeta;
  search(query: SearchQuery, cursor?: Cursor): Promise<Page<TRaw>>;
  fetch(externalId: string): Promise<TRaw | null>;
  normalize(raw: TRaw): TNormalized;
  validate(normalized: TNormalized): ValidationResult;
  healthCheck(): Promise<HealthStatus>;
}
```

Generic in both types because **a source is not necessarily a job board**. An immigration source's
raw payload is an official document and its normalized output is a requirement row.

`normalize` is pure and total: no I/O, no clock, no randomness, and every payload maps to a record
or a validation error rather than a thrown exception. That purity is what makes golden-file testing
possible, and it is why entity resolution happens later in the knowledge engine.

## Why these helpers live here rather than per connector

**Retry.** Full jitter — a delay drawn uniformly from `[0, backoff]` rather than `backoff ± noise` —
because the failure this prevents is synchronised retries: every client that backed off from one
outage returns at the same moment and reproduces it. Halving the mean delay is the price.

Only network errors, `429`, `502`, `503`, and `504` are retried. A bare `500` is not: `502`/`503`/`504`
mean a proxy or a restart, while `500` is the source's own handler failing, and repeating the request
repeats the failure. `400`/`401`/`403`/`422` are never retried — those are our bugs, and retrying a
bug turns a stack trace into a timeout.

**Rate limiting.** Two independent constraints, because either alone leaves a hole: a window budget
permits spending the whole allowance in one burst, and a minimum interval permits a sustained rate
the source never agreed to. The window slides rather than bucketing, because fixed buckets allow 2N
requests across a boundary.

**The registry is a value, not a side effect.** Registration is explicit rather than filesystem-scanned
or import-driven — a connector that appears in a run depending on whether a module happened to be
imported is a failure nobody can reproduce. A duplicate `meta.id` is refused loudly, because ids are
foreign keys in the database and a silent replacement leaves rows pointing at behaviour that did not
write them.

## The `./registry` entry point

`createRegistry(deps)` composes the registered sources and lives behind a **separate export path**,
never re-exported from `index.ts`. A connector imports the contract from `@zentavio/connectors-core`
while this module imports connectors, so folding the two together would put a cycle on the module
graph. Splitting the entry point keeps the cycle at the package-manifest level, where pnpm resolves
it and nothing at runtime depends on initialization order.

Per-source dependencies are passed in rather than constructed here: a registry that built its own
HTTP clients would be untestable and would read configuration from a layer not permitted to.

## Boundary

`eslint.config.mjs` allows `service → connector-core` and `connector-core → connector`, and forbids
`service → connector`. So `import { greenhouse }` inside `services/` is a build error, not a review
comment (ADR-0005). No connector may import another.

## Adding a source

Read `docs/development/connector-guide.md`. Step 1 is not code: **check the terms of service and
`robots.txt` first, and stop if automated access is disallowed.** A permissive `robots.txt` is not
sufficient evidence on its own — fetch a real page and see what it serves. `make-it-in-germany.com`
publishes `Allow: /` and then answers with a bot-protection challenge; it is not integrated for that
reason.

**Registration is enforced, not remembered.** `tests/unit/invariants/connector-registration.test.ts`
walks `connectors/*/*`, treats any folder with a `package.json` as a built source, and fails when one
is missing from `createRegistry` — in both directions, so a registration whose id drifts from its
directory fails too. It was written after `git-scm` (#129) and `de-bayingg` (M5) both shipped without
their registry line and nothing noticed: the registry has no runtime consumer yet, so the omission
has no symptom until a run is silently short a source.

Note that **`registerConnectorSource` is a different operation** — it writes a `connector_sources`
row in the database. Both are called registering, and doing one is not doing the other.

A source absent from `connector_sources` is not a soft failure — `staleAfter` resolves its
`refresh_window` through a subquery, so the row comes back null and every posting insert fails on
`stale_after NOT NULL`. The symptom is a NOT NULL violation that names neither the source nor the
cause, and this repository paid it once: `lever` was missing from the dev database on 2026-08-23.

**ADR-0041 closed that gap.** The declared facts a source states about itself — `displayName`,
`sourceTier`, `legalBasis`, `refreshWindow`, `schedule` — live on `ConnectorMeta` and are
**required**, `toRegistration(meta)` projects them onto the row, and `syncConnectorSources` in
`services/ingestion` writes one row per registered connector. The `REGISTRATION` constants that used
to hold half of this are gone.

**The type is the enforcement.** A connector that states no legal basis does not compile, so a source
cannot be added without somebody writing down what they read. The registration was a *module-level*
constant before, which is why the pass could not be written: the registry holds `Connector`
instances, `meta` is the only per-instance data, and reaching a per-connector constant would mean
importing connector packages by name — a build error outside `default-registry.ts`.

Two things the projection fixed rather than inherited. The hand-assembled payload stored
`{requests: 60, windowMs: 60_000}` for Lever while the connector declared `minIntervalMs: 1000`, so
the persisted rate limit disagreed with the limiter that ran. And it could not reach `regions` at
all — the column existed from the first migration and the payload type omitted it, so it held its
`'{}'` default while `meta.regions` said otherwise.

**Nothing schedules the pass.** `syncConnectorSources` is a function with no caller, like
`runDueJobBoards` and `extractDuePostings`: what triggers it is a deployment decision and nothing is
deployed.

## Related

- ADR-0002 (plugin model), ADR-0005 (the lint rule that enforces it), ADR-0041 (registration on `meta`)
- `docs/architecture/connectors.md`, `docs/development/connector-guide.md`
- `.claude/skills/connectors/SKILL.md`
