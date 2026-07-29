# migrations

> **Purpose:** Ordered database migrations.

Plain `.sql`, forward-only, applied by `../src/migrations/runner.ts` (ADR-0012). The rules they
follow are in `docs/database/migrations.md`; `docs/database/entities/*.md` is the specification they
must satisfy.

## Naming

    <YYYYMMDDHHMMSS>-<kebab-description>.sql

The loader (`../src/migrations/files.ts`) **rejects** a `.sql` file that does not match, rather than
ignoring it. A silently skipped migration is the worst available failure: the schema is wrong,
nothing said so, and the file is sitting right there looking applied.

## What exists

| File | Creates |
|---|---|
| `20260729120000-create-immigration-pathways.sql` | `immigration_pathways` + `uq_ip__pathway_id` |
| `20260729120100-create-requirements.sql` | `requirements`, its foreign keys, seven CHECKs, seven indexes |

Pathways come first because `requirements.pathway_id` is a foreign key onto
`immigration_pathways.pathway_id`, and a foreign key needs its target's unique index to exist.

No file uses `IF NOT EXISTS` on a `CREATE TABLE`. Re-application is already a no-op because the
runner records what it applied; `IF NOT EXISTS` would additionally swallow a table that exists for
some other reason, which is a collision worth failing on.

`schema_migrations` is **not** a migration. It is created by `PostgresMigrationExecutor` on every
run with `IF NOT EXISTS`, because a migration cannot record that it was applied in a table that does
not exist yet.

## Indexes here are not CONCURRENTLY, deliberately

`docs/database/migrations.md` requires `CREATE INDEX CONCURRENTLY`. Both files above create their
indexes in the same transaction as the table, which is a departure with a reason:

- CONCURRENTLY exists so that building an index does not block writes on a **populated** table.
  These tables are created empty in the same transaction — there is nothing to block and no traffic
  to protect.
- Splitting them would open a window in which `requirements` exists without `uq_req__current`.
  That index is a correctness constraint — it is what makes "exactly one live version per
  `requirement_id`" true — not a performance one. A window where it is absent is a window where two
  live rows can be written.

The rule applies unchanged to any index added to these tables **later**.

## Verification

Every constraint in these files is verified by attempting to violate it, against a real PostgreSQL:

    tests/integration/db/requirements-constraints.test.ts
    tests/integration/db/migrations.test.ts

The tests assert on the **constraint name** in the PostgreSQL error, not merely that something
threw. A test that only asserts "it failed" passes just as happily when the insert failed for a typo
— which is how a constraint that never rejects anything gets a green test.

## Related

- `docs/database/migrations.md` — safety classification, expand/contract, the review checklist
- `docs/database/entities/requirement.md` — the specification these satisfy
- `../README.md` — the runner, and what it refuses
