# db

> **Purpose:** Database schema, migrations, and client.

PostgreSQL via `pg` + Kysely, with plain `.sql` migrations applied by the runner here (ADR-0012).
No ORM and no schema DSL: `docs/database/entities/*.md` is the schema specification.

## What exists

| Part | Status |
|---|---|
| Migration runner (`src/migrations/runner.ts`) | **built**, 22 unit tests |
| Migration loader (`src/migrations/files.ts`) | **built** |
| PostgreSQL executor (`src/migrations/executor.ts`) | **built** |
| `Database` interface (`src/schema.ts`) | **built** for `requirements`, `immigration_pathways`, `schema_migrations` |
| Client (`src/client.ts`) | **built** — connecting and compile-only factories |
| `requirements` repository | **built**, 21 tests |
| Migration `.sql` files | **built** for `immigration_pathways` and `requirements` — `migrations/README.md` |
| Schema-drift test | **built** — `tests/integration/db/schema-drift.test.ts` |
| Standalone `migrate` command | **not written** — see below |
| Repositories for the other tables | not written |

## The constraints are verified, not asserted

Most of this schema's meaning lives in `CHECK` constraints:

```sql
CONSTRAINT ck_req__tier_one CHECK (source_tier = 1)
CONSTRAINT ck_req__scope    CHECK (
  (domain = 'immigration' AND pathway_id IS NOT NULL)
  OR (domain IN ('recognition','credential') AND profession IS NOT NULL)
  OR (domain IN ('authentication','language','employment_clearance'))
)
```

A constraint expression that parses but does not *reject what it should* is invisible on review, and
silently permits exactly the data it exists to prevent. So every one of them is exercised against a
real PostgreSQL by attempting a violation, asserting on the **constraint name** in the error:

    tests/integration/db/requirements-constraints.test.ts

```powershell
docker compose -f infra/docker/docker-compose.dev.yml up -d --wait
$env:ZENTAVIO_TEST_DATABASE_URL='postgres://zentavio:zentavio_dev@localhost:5432/zentavio_test'
pnpm test:integration
```

## Drift is checked, not trusted

`schema.ts` is hand-maintained, which ADR-0012 named as the one real weakness of choosing a
hand-written interface over a generated client. `tests/integration/db/schema-drift.test.ts` closes it:
it **parses** `schema.ts` with TypeScript's own parser and compares the result against
`information_schema` — table names, column names, nullability, and whether the database supplies a
default.

It deliberately does **not** compare SQL types. `text` versus `varchar` is not knowable from
`string`; Kysely's types describe the shape TypeScript sees, not the column's declaration. Drift in
practice is a column added, removed, renamed, or made nullable, and those fail the test.

Verified by injecting drift and watching it go red, not by watching it pass.

## The remaining gap

**A standalone `migrate` command.** `applyMigrations` is exported and used by the integration suite,
but there is no CLI. Node cannot resolve this repository's `.js` import specifiers to `.ts` sources,
and neither `tsx` nor `vite-node` is in the stack — adding one is a dependency decision that needs an
ADR (`.claude/context/tech-stack.md`), not a convenience import. Until then, migrations are applied
programmatically.

## How the repository is verified without a database

Kysely compiles SQL without connecting, so `createCompileOnlyDb()` makes two things assertable:

- **the guards reject what they should**, before any round trip
- **the SQL we intend to send**, including that values are bound as parameters rather than
  interpolated — the difference between a query and an injection

What it does **not** prove is that PostgreSQL accepts that SQL, or that a `CHECK` constraint rejects
what it should. `docs/development/testing.md` forbids mocking PostgreSQL for exactly this reason: a
compiled query is evidence about our code, never about the database.

## A date is not an instant

`schema.ts` types `date` columns as ISO `YYYY-MM-DD` strings, and `createDb` configures `pg` to
return DATE unparsed. `pg` otherwise parses DATE into a `Date` at local midnight, so `2026-01-01`
read in a negative-offset timezone formats as `2025-12-31`.

`effective_from` and `effective_to` decide whether a requirement applied on a given day, and that
day decides an eligibility verdict. An off-by-one is a wrong answer, not a display quirk.

## The runner

Ours rather than Kysely's migrator, because `docs/database/migrations.md` requires SQL a generated
engine will not emit — `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT … NOT VALID`, backfills that
commit between batches.

```ts
import { migrate } from '@zentavio/db';

const result = await migrate(files, executor);   // { applied: [...], skipped: [...] }
```

The executor is injected, so this file imports no driver. That is not only for testing: the ordering
and idempotence logic is the part that can corrupt a database, and it is verifiable without one.

### What it refuses, and why

| Refusal | The failure it prevents |
|---|---|
| **Out-of-order** — a pending file ordered before the last applied one | two branches merged with interleaved timestamps. Applying it now yields a schema no fresh database would ever reach, so existing and new databases diverge silently |
| **Edited after applying** — the checksum changed | what ran is not what the file says, so every fresh database differs from every existing one. Fix forward; an applied migration is immutable |
| **Missing** — an applied migration whose file is gone | history is unreproducible |
| **Duplicate ids** | ambiguous ordering |

A `CONCURRENTLY` file runs **outside** a transaction, detected from the statement rather than a
filename convention — so a file cannot claim transactional safety it does not have. It is therefore
not atomic with its own record; recovery is to re-run, which the idempotence check makes safe.

Checksums normalize line endings first, so a Windows checkout does not appear to have edited every
migration.

## Migration order

Foreign keys decide it, not importance:

1. ~~`schema_migrations`~~ — **not a migration.** `PostgresMigrationExecutor` creates it with
   `IF NOT EXISTS` on every run, because a migration cannot record itself in a table that does not
   exist yet.
2. `immigration_pathways`, then `requirements` — **done.** Pathways first: `requirements.pathway_id`
   is a foreign key onto `immigration_pathways.pathway_id`.
3. `users` — **done.** No foreign keys of its own, so it does not wait for the skill graph.
4. `skills`, `skill_aliases`, `skill_edges`, `careers`, `career_skills`
5. `user_consents`, `user_profiles`, `profile_skills`, `user_country_preferences`,
   `user_immigration_facts`
6. `companies`, `job_postings` and its bridges
7. `matches`, `readiness_scores`, `skill_gaps`
8. `applications`, `outcomes`

**The rest of the user cluster was previously listed before the skill graph, and that order cannot be
applied.** `user_profiles` has `fk_user_profiles__careers → careers(id)` and `profile_skills` has
`fk_profile_skills__skills → skills(id)`, so `skills` and `careers` must exist first
(`docs/database/entities/user.md`).

`users.email` is `text` with a unique index on `lower(email)` — **not `citext`**, and this database
installs no extension at all (ADR-0013). `tests/integration/db/users-constraints.test.ts` asserts
`pg_extension` contains only `plpgsql`, so an extension cannot arrive unnoticed in a later migration.

Every file follows `docs/database/migrations.md`: one logical change, forward-only, safe online or
split into expand/contract steps. The one documented departure — index creation inside the
table-creation transaction rather than `CONCURRENTLY` — is explained in `migrations/README.md`.

## Related

- ADR-0012 — the access layer decision and its rejected alternatives
- `docs/database/entities/*` — the schema specification these migrations must satisfy
- `docs/database/migrations.md` — the rules the runner exists to permit
- `docs/development/testing.md` — never mock PostgreSQL in an integration test
