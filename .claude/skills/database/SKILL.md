---
name: database
description: Zentavio's PostgreSQL schema rules — UUIDv7 keys, snake_case naming, foreign keys and cascade policy, indexes, soft deletes, audit and versioning tables, migration safety, and the pgvector/Qdrant split. Load when adding or altering a table, writing a migration under packages/db, designing a relationship, adding an index, touching anything in docs/database/, or when a query is slow.
---

# Database

## Purpose

The schema outlives every service that reads it. This skill keeps naming, keys, temporal
columns, and migration practice uniform so that a table written in month two is still
legible in year three — and so that every score Zentavio shows can be traced back to rows
that prove it.

## Scope

**Applies to:** all PostgreSQL DDL, `packages/db` (schema, migrations, repositories),
`docs/database/*`, index and query design.

**Does not apply to:** vector index tuning and embedding lifecycle
(`knowledge-engine`, `docs/database/vector-store.md`), domain semantics of the skill graph
(`knowledge-engine`), service-level repository shape (`backend-service`).

## Naming and key rules

| Thing | Rule | Example |
|---|---|---|
| Table | `snake_case`, plural | `job_postings` |
| Column | `snake_case`, singular | `posted_at` |
| Primary key | `id uuid` — UUIDv7, generated in app | `id` |
| Foreign key column | `<singular_table>_id` | `job_posting_id` |
| FK constraint | `fk_<table>__<ref_table>` | `fk_matches__job_postings` |
| Index | `idx_<table>__<cols>` | `idx_job_postings__country_posted_at` |
| Unique | `uq_<table>__<cols>` | `uq_users__email` |
| Check | `ck_<table>__<rule>` | `ck_matches__score_range` |
| Join table | both nouns, alphabetical | `job_posting_skills` |
| Boolean | `is_` / `has_` prefix | `is_remote` |
| Timestamp | `_at` suffix, `timestamptz`, UTC | `created_at` |
| Enum-ish column | text + CHECK, not PG enum | `status` |
| Money | `numeric(14,2)` + `currency char(3)` | `salary_min` |

**UUIDv7, not v4.** Time-ordered means index locality and a free creation ordering.
Generated in the application so a row is fully formed before it hits the DB.

**No PG `enum` types.** Adding a value to a PG enum is a migration and a lock; a
`text` column with a `CHECK` constraint is a one-line change and readable in `psql`.

## Every table gets

```sql
id            uuid        primary key,
created_at    timestamptz not null default now(),
updated_at    timestamptz not null default now(),
deleted_at    timestamptz                       -- soft delete, null = live
```

Plus, where the row is user-facing or auditable: `created_by uuid`, `updated_by uuid`.

## Responsibilities

1. Name every object per the table above. No exceptions, no abbreviations.
2. Declare a foreign key for every reference, with an explicit `ON DELETE` policy.
   Defaulting to `NO ACTION` by omission is not a decision.
3. Add the index the query needs in the **same** migration as the query.
4. Use soft deletes for anything a user can "remove"; hard-delete only for GDPR erasure
   and expired ephemera.
5. Version knowledge rows rather than mutating them — immigration rules, salary bands, and
   skill-graph edges are historical facts, not current state.
6. Record provenance on every derived row: what produced it, from which inputs, at which
   version. Explainability is a schema property, not a UI feature.
7. Keep migrations forward-only, reversible in intent, and safe under a live deployment.

## Workflow

1. Read `docs/database/schema-overview.md` and the relevant `docs/database/entities/*.md`.
2. Write or update the entity doc **first** — columns, relationships, retention, why.
3. Write the migration in `packages/db/migrations/` with a timestamped name.
4. Check the migration against the safety rules below; split it if it is not safe online.
5. Add or update the repository and the `packages/types` type.
6. Add indexes for every new access path; verify with `EXPLAIN (ANALYZE, BUFFERS)`.
7. Update `docs/database/relationships.md` if a relationship changed, and
   `docs/database/data-retention.md` if retention changed.

## Migration safety

Safe online: adding a nullable column; adding a table; adding an index `CONCURRENTLY`;
adding a `CHECK` as `NOT VALID` then validating; backfilling in batches.

Never in one step: adding `NOT NULL` with a default to a large table; renaming a column or
table; changing a column type; dropping a column still read by deployed code.

The pattern for a rename is always: add new → dual-write → backfill → switch reads →
stop writing old → drop old. Four migrations, not one.

## Constraints

- **No `SELECT *` in application code.** Columns are a contract; enumerate them.
- **No string-interpolated SQL.** Parameterized queries only.
- **No cascade delete on anything a user might want back.** Prefer
  `ON DELETE RESTRICT` and an explicit soft-delete path.
- **No table without `created_at`/`updated_at`.**
- **No mutation of a knowledge row in place.** Insert a new version; supersede the old.
- **No derived score persisted without its evidence.** A `score` column with no
  `evidence`/`explanation` column beside it is a bug per principle 2.
- **No new datastore, extension, or ORM without an ADR.**
- **No PII in an index name, comment, or migration file.**

## Examples

**Bad.**

```sql
CREATE TABLE Matches (
  ID serial PRIMARY KEY,
  userID int REFERENCES Users(ID) ON DELETE CASCADE,
  jobID int,
  score float,
  created timestamp DEFAULT now()
);
```

Wrong case, `serial`, missing FK on `jobID`, cascade that destroys history, naive
timestamp, score with no provenance, no soft delete, no `updated_at`.

**Good.**

```sql
CREATE TABLE matches (
  id                uuid        PRIMARY KEY,
  user_id           uuid        NOT NULL,
  job_posting_id    uuid        NOT NULL,
  score             numeric(5,4) NOT NULL,
  evidence          jsonb       NOT NULL,
  scorer_version    text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT fk_matches__users        FOREIGN KEY (user_id)        REFERENCES users(id)         ON DELETE RESTRICT,
  CONSTRAINT fk_matches__job_postings FOREIGN KEY (job_posting_id) REFERENCES job_postings(id)  ON DELETE RESTRICT,
  CONSTRAINT ck_matches__score_range  CHECK (score >= 0 AND score <= 1)
);

CREATE UNIQUE INDEX uq_matches__user_job ON matches (user_id, job_posting_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_matches__user_score ON matches (user_id, score DESC) WHERE deleted_at IS NULL;
```

`evidence` and `scorer_version` are what make the score explainable and reproducible.

## Best Practices

- Partial indexes on `deleted_at IS NULL` — that is what every query actually filters.
- `jsonb` for genuinely open shapes (raw connector payloads, evidence bundles). Not as an
  escape hatch for columns you have not thought about yet.
- Store the source's own identifier (`external_id` + `source_id`, unique together) so
  re-ingesting is idempotent.
- Timestamps are `timestamptz` and always UTC. Timezone is a presentation concern.
- If a query needs more than three joins to answer a common question, consider a
  materialized projection — and document its refresh policy.
- Retention is designed at table creation, not after the first privacy request.
