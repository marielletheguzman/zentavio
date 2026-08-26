# ADR-0041: A connector states its registration on `meta`, and one pass over the registry writes `connector_sources` before any run

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** project lead
- **Affects:** `connectors/core` (`contract.ts`, `default-registry.ts`, `README.md`), all eight built connectors, `packages/db` (`repositories/learning.ts`), `services/ingestion`, `docs/architecture/connectors.md`, `docs/development/connector-guide.md`

## Context

**Nothing in production writes a `connector_sources` row.** `registerConnectorSource` is called from
five places and all five are integration tests. `lever` and `git-scm` exist in the dev database because
a session inserted them by hand — `lever` on 2026-08-23, while chasing a failure that named neither
the source nor the cause.

That failure is why this is not cosmetic. A source absent from `connector_sources` is **not** a soft
failure: `staleAfter` resolves the source's `refresh_window` through a subquery, so a missing row
returns null and every posting insert fails on `stale_after NOT NULL`. The message names the column.
It does not name the source, and it does not say that registration is what is missing.

The obvious fix — a pass that walks the registry and registers what it finds — cannot be written
today, and the reason is a contract gap rather than effort.

### The registry holds instances; the registration is a module constant

`ConnectorRegistry` stores `AnyConnector` and exposes `all()`, `byKind()` and `byRegion()`. The only
per-instance data on a connector is `meta`. But the registration facts live in a separate
module-level export:

```ts
// connectors/job-boards/lever/src/index.ts
export const REGISTRATION = {
  id: SOURCE_ID,
  kind: 'job-board' as const,
  displayName: 'Lever (configured employer boards)',
  sourceTier: 2,
  termsUrl: 'https://github.com/lever/postings-api',
  legalBasis: 'Lever documents that postings in the `published` state "are publicly viewable" …',
  refreshWindow: '1 day',
  schedule: '0 */6 * * *',
} as const;
```

A generic pass holding a `Connector` cannot reach that. It would have to import each connector package
by name — which is precisely what ADR-0002 forbids outside `default-registry.ts`, and what
`eslint.config.mjs` makes a build error under ADR-0005.

### Only two of eight connectors have one, and `Connector` does not ask for one

`connectors/*/*/package.json` finds eight built sources: six immigration connectors, `lever` and
`git-scm`. `export const REGISTRATION` appears in two. The other six are not broken — they satisfy the
contract completely, because the contract says nothing about registration.

### What `REGISTRATION` holds is not what the row needs

`ConnectorRegistration` in `packages/db/src/repositories/learning.ts` requires `connectorVersion` and
`rateLimit`. Neither is in `REGISTRATION`; both are on `meta`. Every test therefore hand-assembles the
payload from two objects plus a literal:

```ts
// tests/integration/db/posting-runner.test.ts
await registerConnectorSource(db, {
  id: REGISTRATION.id,
  // …
  connectorVersion: '1.0.0',                       // meta.version, retyped
  rateLimit: { requests: 60, windowMs: 60_000 },   // meta.rateLimit, retyped — and already wrong:
                                                   // the connector declares minIntervalMs: 1000
  // …
});
```

That literal is the whole problem in one expression: a stored rate limit that does not match the
limiter the connector actually runs, in the file that exists to prove registration works.

In the other direction, `ConnectorRegistration` **drops `regions` entirely** while the column exists
(`regions char(2)[] NOT NULL DEFAULT '{}'`) and `meta.regions` is populated. The column can only ever
hold its default, so `byRegion` and the stored row disagree by construction.

### The two objects already want to be one

Both connectors that have a `REGISTRATION` already write `termsUrl: REGISTRATION.termsUrl` into their
`meta` to stop the copies drifting. These are not two concepts kept apart on purpose; they are one
concept split across two exports because the contract had no room for half of it.

### Why this needs an ADR rather than a commit

`Connector` and `ConnectorMeta` are the published contract every source implements and
`docs/architecture/connectors.md` documents. Changing either changes eight packages at once and
changes what "a connector" means for every future source. `.claude/context/decisions.md` requires an
ADR for exactly that.

### One thing that is already right, and stays

`registerConnectorSource` refuses to overwrite observed state — `reliability`, the breaker, the failure
counters and the cursor are what running the connector produced, and re-registering describes the
connector rather than resetting its history. Nothing below changes that.

## Options considered

### Option A — the declared fields move onto `ConnectorMeta`, and the row is derived from it

`ConnectorMeta` gains the five facts it lacks: `displayName`, `sourceTier`, `legalBasis`,
`refreshWindow`, `schedule`. Everything else the row needs — `id`, `kind`, `version`, `regions`,
`rateLimit`, `termsUrl` — is already there. `connectors/core` exports a pure `toRegistration(meta)`,
and a pass in `services/ingestion` hands the result to `registerConnectorSource`. The `REGISTRATION`
constants are deleted.

**Advantages.** One object, so drift is not merely discouraged but unrepresentable — the hand-copied
`'1.0.0'` and the wrong `rateLimit` literal cannot be written again, because there is no second place
to write them. The data is instance-reachable, so the pass is `for (const c of registry.all())` with
no per-source import and no ADR-0002 violation. A connector missing a fact fails **typecheck**, which
means the gap this ADR exists to close cannot reopen silently: six connectors stop compiling the
moment the field becomes required, and each author must state a legal basis rather than inherit a
default. `regions` reaches the column for the first time.

**Costs.** `ConnectorMeta` grows from eight fields to thirteen and stops being purely about behaviour —
`schedule` is a cadence and `legalBasis` is governance. All eight connectors change in one commit.

### Option B — a required `registration` property alongside `meta`

`Connector` gains `readonly registration: ConnectorRegistration`, holding the full payload.

**Advantages.** Instance-reachable, required by the type, and keeps `meta` about behaviour.

**Cons.** It preserves the duplication instead of ending it: `id`, `kind`, `termsUrl`, `version` and
`rateLimit` would exist in both objects with nothing checking they agree — the same gap that produced
the wrong rate-limit literal, now blessed by the contract. Trimming `registration` to only the
non-derivable half fixes that, but leaves two types named for one thing and a reader who has to know
which half lives where.

### Option C — carry the registration through the registry line

`register(connector, REGISTRATION)`, with the registry storing both. The composition root already names
every connector, and the invariant test already enforces that it does.

**Advantages.** No change to the published contract at all — the cheapest option by that measure — and
the requirement lands at the one choke point a test already guards.

**Cons.** The guarantee is weaker where it matters. A `Connector` still carries no registration, so
anything holding one directly cannot register it, and a second composition path — a test registry, a
future partial registry — can omit the argument by constructing the registry differently. It also
leaves `REGISTRATION` as a second object beside `meta`, so the duplication and the missing `regions`
both survive.

### Option D — make the pass tolerant of connectors that have no registration

Keep `REGISTRATION` optional and have the pass skip a connector that lacks one.

**Refused.** A skipped source is indistinguishable from a registered one until the first insert fails
on `stale_after NOT NULL` — the exact failure this ADR exists to remove, now produced by the machinery
meant to prevent it. This is the silence-versus-absence class the repository has caught five times
(`is_remote` nullable, `salary_is_stated` generated, `sweepRefusedBecause` never null, `unwired()`
throwing, `extractor_version` on child rows). A tolerant pass converges on looking healthy while being
short a source.

### Option E — do nothing, and keep inserting rows by hand

**Honestly evaluated, and it is not absurd today.** Nothing is deployed, no scheduler runs, and the two
sources that needed rows have them. The cost is zero until the first real run.

**Refused anyway**, because the cost is not zero *now* — it has already been paid once. `lever` was
absent on 2026-08-23 and the symptom was a NOT NULL violation on an unrelated column. Doing nothing
means the next person pays it again, and the next source added pays it by default rather than by
accident, since six of the eight have no registration constant at all.

## Decision

**Option A.** The facts a connector alone can state about itself move onto `ConnectorMeta` and become
required; `connectors/core` exports a pure projection from `meta` to the registration payload; and
`services/ingestion` gains one idempotent pass that registers every connector in the registry.

**This ADR changes no table.** `connector_sources` already has every column, including the `regions`
the current payload cannot reach. Nothing needs a migration.

Three rules the implementation carries:

1. **The pass never deletes and never disables.** A connector removed from the registry keeps its row,
   because `source_id` is a foreign key and the rows citing it are evidence of what wrote them.
   Disabling a source is an operational act against `is_enabled`, not a side effect of a code change.
2. **Observed state stays untouched**, as `registerConnectorSource` already guarantees. A re-sync
   describes; it does not reset a breaker or restore a reliability score the source lost.
3. **Nothing schedules the pass.** It is a function with no caller, like `runDueJobBoards`,
   `extractDuePostings` and `scorePostingForUser`. What triggers it is a deployment decision, and
   nothing is deployed.

## Consequences

**Accepted costs.**

- `ConnectorMeta` goes from eight fields to thirteen and mixes behaviour with governance. `termsUrl`
  already sat there for that reason; this makes the mixture the rule rather than the exception.
- All eight connectors change in one commit, and the six with no registration today must have a
  `legalBasis` written for them. That is work, and it is the point: six sources are currently
  fetchable with no recorded reason why we are permitted to fetch them.
- `schedule` on `meta` makes a cadence change a code change and a connector-version question rather
  than configuration. For eight hand-written sources that is acceptable; at fifty it would not be.
- Two structurally identical types remain — `toRegistration`'s return in `connectors/core` and
  `ConnectorRegistration` in `packages/db` — because `connectors/core` must not depend on the database
  package. They are checked against each other at the single call site and by a test, not by a shared
  declaration.
- The dev database's `lever` and `git-scm` rows were written by hand, with `regions = '{}'` and a rate
  limit that does not match the connector. They should be re-synced once the pass exists.

**Follow-up work.**

- Add the five fields to `ConnectorMeta`; fold the two `REGISTRATION` constants into `meta` and delete
  them; write `displayName`, `sourceTier`, `legalBasis`, `refreshWindow` and `schedule` for the six
  immigration connectors.
- `toRegistration(meta)` in `connectors/core`, and `syncConnectorSources(registry, db)` in
  `services/ingestion`.
- Extend `tests/unit/invariants/connector-registration.test.ts` — it already walks the built connectors
  — to assert every registered connector produces a complete, valid registration.
- Replace the gap note in `connectors/core/README.md`; make registration Step 7b in
  `docs/development/connector-guide.md`, beside the registry line it is repeatedly confused with.

**Reversal cost.** Low to moderate, and no data is at risk. The fields are additive on a type and the
table is unchanged, so reverting means moving five fields back out of eight `meta` objects and
restoring a second constant. Nothing stored changes shape, and no row written under this decision
becomes invalid under its reversal.

## Compliance

**The type is the enforcement.** A connector that does not state its registration does not compile.
`pnpm typecheck` is the check, and CI runs it on every PR — a new source cannot reach `main` without a
legal basis and a tier.

Beyond that:

- `tests/unit/invariants/connector-registration.test.ts` gains assertions that every registered
  connector's `meta` yields a registration with a non-empty `legalBasis`, `sourceTier` in 1–4, a
  `schedule` that parses as cron, and a `refreshWindow` PostgreSQL accepts as an interval. A blank
  string satisfies a type and satisfies nothing else.
- A test asserts `toRegistration` covers every column `registerConnectorSource` writes, so a column
  added later cannot be silently left at its default the way `regions` was.
- An integration test asserts `syncConnectorSources` writes one row per registered connector, is
  idempotent, and leaves `reliability`, `breaker_state`, `consecutive_failures` and `cursor` unchanged
  across a re-sync.
- `eslint.config.mjs` already fails any import of a connector package outside `default-registry.ts`,
  which is what keeps the pass generic rather than a list of eight names.

## Related

- ADR-0002 (connectors are plugins), ADR-0005 (the lint rule that enforces it)
- ADR-0034 (`listing`, the last field added to `ConnectorMeta`, and why declaring a capability differs
  from reporting an outcome)
- `connectors/core/README.md` — "Registration is enforced, not remembered", and the gap this closes
- `docs/architecture/connectors.md`, `docs/development/connector-guide.md`
