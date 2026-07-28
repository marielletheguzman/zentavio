# db

> **Purpose:** Database schema, migrations, and client.

PostgreSQL via `pg` + Kysely, with plain `.sql` migrations applied by the runner here (ADR-0012).
No ORM and no schema DSL: `docs/database/entities/*.md` is the schema specification.

## What exists

| Part | Status |
|---|---|
| Migration runner (`src/migrations/runner.ts`) | **built**, 22 unit tests |
| `Database` interface (`src/schema.ts`) | **built** for `requirements`, `immigration_pathways`, `schema_migrations` |
| Client (`src/client.ts`) | **built** — connecting and compile-only factories |
| `requirements` repository | **built**, 21 tests |
| Migration `.sql` files | **not written** — see below |
| Schema-drift test | **not written** — needs a database |
| Repositories for the other tables | not written |

## Why the migrations are not written yet

**No PostgreSQL is reachable in the environment where this was built** — Docker is installed but its
daemon is not running, and there is no `psql`. Migration SQL written here could not be executed, so it
would be committed unverified.

That matters more for this schema than most, because much of its meaning lives in `CHECK`
constraints:

```sql
CONSTRAINT ck_matches__score_iff_scored CHECK ((status = 'scored') = (score IS NOT NULL))
CONSTRAINT ck_req__tier_one             CHECK (source_tier = 1)
CONSTRAINT ck_ems__min_factors          CHECK (status = 'insufficient_data' OR factors_known >= 3)
CONSTRAINT ck_req__scope                CHECK (
  (domain = 'immigration' AND pathway_id IS NOT NULL)
  OR (domain IN ('recognition','credential') AND profession IS NOT NULL)
  OR (domain IN ('authentication','language','employment_clearance'))
)
```

A constraint expression that parses but does not *reject what it should* is invisible on review, and
silently permits exactly the data it exists to prevent. Committing these unexecuted would put the
schema's most important rules into the repository as untested assertions.

**To unblock:** start Docker Desktop. Then the migrations can be written from the entity documents,
applied to a real database, and each constraint verified by attempting to violate it — which also
gives the Vitest `integration` project its first real tests (ADR-0007 follow-up).

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

## When the migrations are written

Order, from the entity documents:

1. `schema_migrations` — the runner's own table
2. `requirements`, `immigration_pathways` — ADR-0010's centrepiece
3. `users`, `user_profiles`, `profile_skills`
4. `skills`, `skill_aliases`, `skill_edges`, `careers`, `career_skills`
5. `companies`, `job_postings` and its bridges
6. `matches`, `readiness_scores`, `skill_gaps`
7. `applications`, `outcomes`

Every file follows `docs/database/migrations.md`: one logical change, forward-only, safe online or
split into expand/contract steps.

## Related

- ADR-0012 — the access layer decision and its rejected alternatives
- `docs/database/entities/*` — the schema specification these migrations must satisfy
- `docs/database/migrations.md` — the rules the runner exists to permit
- `docs/development/testing.md` — never mock PostgreSQL in an integration test
