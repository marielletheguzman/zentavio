# ADR 0012: Database access layer and migration runner

- **Status:** **Proposed** — awaiting acceptance
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** `packages/db`, every service, `knowledge-engine/*`, `infra/ci`, `tests/integration`

## Context

`packages/db` is next in dependency order, and nothing names how TypeScript reaches PostgreSQL.
`.claude/context/tech-stack.md` names PostgreSQL and says "no ORM swap, no query-builder addition
without an ADR" — but no ORM or driver is listed, so there is nothing to swap. This is that decision.

Four constraints, and the first two rule out most of the field.

**The schema is already specified in SQL, in documents.** `docs/database/entities/*.md` contain the
`CREATE TABLE` statements, and they are the specification a migration must satisfy — written first,
deliberately (`docs/development/contributing.md`). A tool that owns the schema in its own DSL would
create a second source of truth, and the copy that rots is the one nobody reads.

**`migrations.md` requires SQL that most migration engines cannot express.** Expand/contract in four
steps, `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT … NOT VALID` then `VALIDATE`, and batched backfills
that commit between batches. These are the difference between a safe migration and a table lock in
production, and a generated-migration tool typically emits none of them.

**Invariants are enforced at the repository level.** No fact persists without `source_tier` and
`source_url`; a tier-5 write must fail; evidence must accompany a score
(`docs/development/testing.md`). That means hand-written repository functions regardless of what sits
underneath — the enforcement point cannot be a generated client method.

**Types already exist.** `@zentavio/types` defines the contracts. A tool that generates its own types
from the database would produce a second, subtly different set.

## Options considered

### Option A — `pg` driver only, hand-written SQL everywhere

**Advantages.** One small dependency. Total control. Nothing between the code and the SQL, so the
expand/contract discipline is unimpeded. No codegen, no schema DSL, no second source of truth.

**Disadvantages.** Every query is a template string, so a column rename is caught at runtime rather
than at compile time — in a schema this constraint-heavy, that is a real loss. Row shapes must be
hand-typed and kept in step with the schema by review. Repetitive result mapping invites small
inconsistencies.

### Option B — `pg` + Kysely (typed query builder)

**Advantages.** SQL-shaped: a Kysely query reads like the SQL it becomes, so the expand/contract
discipline and raw SQL escape hatches both survive. Types come from a hand-written `Database`
interface — which can be derived from the entity documents and reviewed against them — rather than
from generation, so `@zentavio/types` stays the contract. Compile-time column and table checking,
which is what Option A gives up. Migrations stay plain `.sql` files. No runtime schema, no generated
client.

**Disadvantages.** Two dependencies rather than one. The `Database` interface is hand-maintained, so
it can drift from the migrations — mitigable by a test that compares it against the live schema, but
that is work Option D gets for free. A learning curve for anyone expecting an ORM.

### Option C — Drizzle

**Advantages.** Schema in TypeScript with good inference; can generate migrations; lighter than
Prisma.

**Disadvantages.** The schema lives in TypeScript, which conflicts directly with the first
constraint: the entity documents are the specification and contain the SQL. Either the documents
become decorative or the Drizzle schema does. Its generated migrations do not express
`CONCURRENTLY`, `NOT VALID`, or batched backfills, so `migrations.md` would need weakening — trading a
production-safety property for developer convenience.

### Option D — Prisma

**Advantages.** Mature, excellent tooling, a real migration engine, generated client with strong
types.

**Disadvantages.** Owns the schema in its own DSL, owns migrations, and generates its own types —
three collisions with decisions already made. Its migration engine actively resists the hand-written
DDL that `migrations.md` mandates. `CHECK` constraints, which carry much of this schema's meaning
(`ck_matches__score_iff_scored`, `ck_req__tier_one`, `ck_ems__min_factors`), are second-class in the
Prisma schema language and would end up in raw-SQL escape hatches — meaning the DSL describes a
schema whose most important rules are invisible in it.

### Option E — Do nothing; write migrations now and decide the query layer later

**Advantages.** Migration SQL is driver-independent, so the files can be written before this is
settled. Genuinely true, and worth noting.

**Disadvantages.** The repositories cannot be written, so nothing can read or write, so
`packages/db` cannot be finished. It also defers the decision to whoever writes the first query,
which is the pattern `decision-gate.md` forbids.

## Decision

**Recommended: Option B — `pg` as the driver, Kysely for typed queries, plain `.sql` migration files,
and a small hand-written migration runner.**

The runner is deliberately ours rather than Kysely's migrator: perhaps sixty lines that apply
ordered `.sql` files inside a transaction, record them in a `schema_migrations` table, and refuse to
re-apply or reorder. That keeps `migrations.md`'s rules expressible — a file containing
`CREATE INDEX CONCURRENTLY` simply opts out of the transaction, which a generated engine would not
allow.

**The `Database` interface is derived from the entity documents and checked against the live schema
by an integration test.** That is the one real weakness of Option B, so it gets a mechanism rather
than a convention.

## Consequences

**Accepted costs.**

- Two new dependencies (`pg`, `kysely`) plus `@types/pg`.
- The `Database` interface is hand-maintained and **will** drift if the drift test is not written.
  That test is not optional; it is the price of keeping SQL as the source of truth.
- No generated client, so repository functions are written by hand. Deliberate — that is where the
  provenance and evidence invariants are enforced.
- Kysely is less widely known than Prisma, so onboarding costs a little more.
- Migrations are applied by our own runner, which we therefore maintain and must test.

**Follow-up work.**

- Migration `.sql` files for the MVP tables, from the entity documents.
- The runner, with a test that it refuses to re-apply or reorder.
- The `Database` interface plus the schema-drift integration test.
- Repository functions for the MVP path, with the invariant tests attached at that level.
- Wire the Vitest `integration` project and its CI job (ADR-0007 follow-up, task #18).
- Add PostgreSQL keys to `packages/config` and `.env.example` in the same change as the first
  connection.

**Reversal cost.** Moderate and asymmetric. Moving from Kysely to plain `pg` is deleting a layer —
easy. Moving to Prisma or Drizzle means surrendering SQL-as-source-of-truth and rewriting
`migrations.md`, which is the expensive direction and the reason to choose deliberately now.

## Compliance

- **No ORM, no schema DSL.** The entity documents plus the migration files are the schema. A
  reviewer check: any TypeScript file declaring table structure other than the `Database` interface
  is a violation.
- **Schema-drift test** compares the `Database` interface against the live schema. It fails on a
  column the interface does not know about, and on one it invents.
- **Migration runner tests:** refuses re-application, refuses reordering, applies inside a
  transaction except where a file opts out.
- **Repository-level invariant tests:** a write without `source_tier`/`source_url` fails; a tier-5
  write fails; a score without evidence fails.
- `packages/db` imports only from `packages/*` — already enforced by `boundaries/element-types`.

## Related

- `docs/database/migrations.md` — the rules the runner must permit
- `docs/database/entities/*` — the schema specification
- `docs/development/testing.md` — never mock PostgreSQL in an integration test
- ADR-0007 (integration project), ADR-0001 (dependency direction)
