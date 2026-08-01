# ADR-0015: Supabase as the managed PostgreSQL provider — and as nothing else

- **Status:** Accepted
- **Accepted:** 2026-08-01
- **Date:** 2026-08-01
- **Deciders:** project lead
- **Affects:** `.claude/context/tech-stack.md`, `packages/db`, `packages/config`, `infra/`,
  `docs/development/getting-started.md`, ADR-0013's stated premise

## Context

`infra/docker/docker-compose.dev.yml` runs PostgreSQL 17 locally, and CI runs it as a service
container. Both are disposable. **Nothing names a provider for a database that outlives a laptop**, and
`.claude/context/tech-stack.md` lists PostgreSQL with no host attached.

That has not blocked anything yet because nothing is deployed. It blocks the moment M1a has a user
whose profile must survive a `docker compose down`, and it blocks the M1a exit criterion directly: "a
real user completes the path" cannot mean a user on the developer's machine.

Three constraints make this narrower than "pick a Postgres host":

**We own the migration runner (ADR-0012).** `docs/database/migrations.md` requires
`CREATE INDEX CONCURRENTLY` and `ADD CONSTRAINT … NOT VALID`, which is why the runner exists and why a
file can opt out of its surrounding transaction. Any provider whose own migration tooling wants to be
the entry point is adopting a second runner, and two runners means two ideas of what has been applied.

**Person data.** Résumés and immigration status are the most sensitive cluster in the schema
(`docs/database/entities/user.md`), the launch destination is Germany, and privacy is on the
not-cuttable list (`docs/roadmap/mvp.md`). Region is a correctness property here, not a latency
preference.

**ADR-0013 rested on this being undecided.** It rejected `citext` partly because "the hosting target is
undecided", and an integration test asserts `pg_extension` holds only `plpgsql` so no extension can
arrive unnoticed. Deciding the host retires that premise, so this ADR has to say explicitly whether
ADR-0013 is reopened. It is not — see Consequences.

## Options considered

### Option A — Supabase, as managed PostgreSQL only

A managed Postgres with a generous free tier, EU regions, and connection pooling in front.

**Advantages.** It is real PostgreSQL with superuser-adjacent access, not a fork or a
compatibility layer, so `CONCURRENTLY`, `NOT VALID`, and our own runner work unchanged. EU
regions exist, which the person-data constraint requires. The free tier is enough for a
pre-revenue MVP, and `pg_dump` is the exit path — the data is not hostage to the product.

**Disadvantages.** Supabase is a platform, not a database: Auth, Storage, Realtime, and PostgREST come
with it, and each is a tempting shortcut that would put product logic in a vendor's surface area. The
free tier pauses a project after inactivity, which is a surprise the first time a demo is cold. Its own
CLI wants to own migrations, and adopting that would contradict ADR-0012.

### Option B — Neon

Serverless Postgres with branching.

**Advantages.** Database branching per pull request is genuinely useful for a repo where every change
goes through a PR and migrations are the risky part. Scale-to-zero suits intermittent use.

**Disadvantages.** Nothing else in this project needs branching yet, because there is one contributor
and migrations are already tested against a real PostgreSQL in CI. It buys a workflow improvement for a
problem we do not have, and the storage architecture is further from stock PostgreSQL than Supabase's.

### Option C — AWS RDS or Google Cloud SQL

**Advantages.** The least surprising operationally, with real backups, PITR, and no platform
attached. No temptation to adopt bundled Auth, because there is none.

**Disadvantages.** Costs real money from day one for a product with no users, and drags in an entire
cloud account, IAM, VPC, and Terraform before the first profile is parsed. `infra/terraform/` is a
placeholder; this would make it the next milestone instead of M1a.

### Option D — Self-host on a VM

**Advantages.** Cheapest at small scale, and total control.

**Disadvantages.** Backups, patching, failover, and disk monitoring become work owned by one person who
is meant to be building a career-intelligence product. The failure mode is losing user data to an
unattended disk, which is not recoverable by trying harder next time.

### Option E — Do nothing, stay local-only

**Advantages.** Zero cost, zero lock-in, and honest for a product with no users. Local Docker already
covers development completely, and CI covers verification.

**Disadvantages.** M1a cannot meet its own exit criterion — a real user cannot complete a path against
a database on the developer's laptop. It also defers the decision to the moment it is most expensive:
under demo pressure, where "just use the thing with the fastest signup" is how a provider gets chosen.

## Decision

**Supabase, as managed PostgreSQL and nothing else.**

The second half is the load-bearing half. Concretely:

- **Our runner stays the only thing that applies migrations** (ADR-0012). The Supabase CLI's migration
  system is not adopted. `pnpm migrate` against `ZENTAVIO_DATABASE_URL` is the only path, in every
  environment.
- **Supabase Auth, Storage, Realtime, and PostgREST are not adopted.** Each is a separate decision
  needing its own ADR. This matters most for Auth, which is genuinely tempting because M1a defers
  authentication — and adopting it by convenience rather than by decision is exactly how a boundary
  erodes.
- **The database is a plain connection string** read through `packages/config` like any other. Nothing
  in the codebase imports a Supabase SDK. That is what keeps Option B or C a migration rather than a
  rewrite.
- **EU region.** Person data, a German launch market, and privacy on the not-cuttable list.

Row-level security is deliberately **not** part of this decision either way: the application connects
as one role and enforces access in `services/`, and turning on RLS would be a second authorization
model to keep in step with the first. Revisit if and when Supabase Auth is ever adopted.

## Consequences

**Accepted costs.**

- **A vendor now holds user data**, including parsed résumé content. The mitigation is that it is stock
  PostgreSQL reachable by `pg_dump`, not that the vendor is trustworthy.
- **The free tier pauses on inactivity.** A cold demo will be slow or briefly fail. Known, not
  discovered live.
- **Connection pooling changes how we connect.** Supabase fronts Postgres with a pooler, and
  transaction-mode pooling does not support session state or prepared statements — which `pg` and
  Kysely use. Application connections and the migration runner may need different connection strings,
  and **the runner in particular needs a session-mode or direct connection**, because
  `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block. This is the most likely thing to
  break first, and it will break in a way that looks like an unrelated driver error.
- **Backups on the free tier are limited**, with no point-in-time recovery. For person data that is a
  real exposure, accepted only while there is no real user data.
- **Temptation, permanently.** Every future need — auth, file storage, a websocket — has a Supabase
  answer one click away. The "nothing else" clause is a rule that will have to be re-defended.

**ADR-0013 is not reopened.** Its premise ("the hosting target is undecided") is now retired, and
Supabase does support `citext`. The decision still stands on its own reasoning: a functional unique
index on `lower(email)` gives the same write-time guarantee using core PostgreSQL, and its failure mode
is the safe one. Adopting `citext` now would be a change with no benefit and a migration cost.

**One existing test needs attention before the first deploy.** `users-constraints.test.ts` asserts
`pg_extension` contains only `plpgsql`. That runs against the local and CI test databases, and it stays
correct there. **A managed provider generally preinstalls extensions**, so this assertion is expected
*not* to hold on Supabase — it must be checked on first provision, and if so the guard should be
documented as a property of our own migrations rather than of every database we connect to. It is a
guard against a migration adding an extension, and it should keep meaning exactly that.

**Follow-up work.**

- Provision an EU-region project; record the region in `docs/development/getting-started.md`.
- Confirm which connection string the migration runner needs, and whether pooled and direct URLs must
  be separate config keys. Verify `CREATE INDEX CONCURRENTLY` actually succeeds through whichever is
  chosen — the failure is silent-looking and the whole reason ADR-0012 built its own runner.
- Check `pg_extension` on the provisioned database and reconcile the test's scope with what is found.
- Add the connection key(s) to `.env.example` and `packages/config`, secret-flagged.
- Decide backup and retention posture before any real person's résumé is stored, not after.
- Update `.claude/context/tech-stack.md` in the same change as this ADR.

**Reversal cost.** Low by construction, and this is the main argument for Option A over a platform-first
choice. Because nothing imports a Supabase SDK and the schema is plain PostgreSQL applied by our own
runner, moving to Neon, RDS, or a VM is `pg_dump`, `pg_restore`, and a changed connection string. That
stays true **only while the "nothing else" clause holds** — adopting Supabase Auth would make this
paragraph false, which is why it is a separate ADR.

## Compliance

- **Verified by attempting to violate it:** `grep -rn "@supabase" --include=package.json .` returns
  nothing. A Supabase SDK anywhere in the tree means this decision has been broken, not extended.
- `supabase/config.toml` or a `supabase/migrations/` directory appearing in the repository means the
  CLI's migration system is being adopted, which contradicts ADR-0012.
- The database is reached only through `ZENTAVIO_DATABASE_URL` via `packages/config`. `process.env` is
  already banned outside that package (`eslint.config.mjs`).
- `pnpm migrate --dry-run` against the provisioned database reports pending migrations correctly —
  the check that the pooler and the runner actually agree.
- Until the region is recorded in `getting-started.md`, the correct statement is "a provider was
  chosen", not "person data is stored in the EU".

## Related

- ADR-0012 — the runner this must not be replaced by
- ADR-0013 — whose stated premise this retires, without reopening the decision
- ADR-0004 — Qdrant behind a port; Supabase shipping `pgvector` does not reopen it
- `.claude/context/tech-stack.md` · `docs/database/migrations.md` · `docs/roadmap/mvp.md`
