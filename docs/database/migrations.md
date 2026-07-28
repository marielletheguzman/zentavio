# Migrations

> **Purpose:** Migration strategy and naming conventions.

Migrations live in `packages/db/migrations/`. They are forward-only, reviewed like code, and must be
safe to apply while the previous version of the application is still serving traffic.

## Naming

```text
packages/db/migrations/<YYYYMMDDHHMMSS>-<kebab-description>.sql

20260728143000-create-job-postings.sql
20260728151200-add-matches-evidence.sql
20260801090000-backfill-company-ids.sql
```

- UTC timestamp prefix, so ordering is total and merge conflicts are visible rather than silent.
- Description states the change, not the ticket.
- One logical change per file. A migration that creates a table *and* backfills it cannot be reasoned
  about, and cannot be retried after a partial failure.

## Forward-only

There are no `down` migrations. A mistake is corrected by a new migration, not by reversing history.

Down migrations look like safety and are not: they are almost never tested, they cannot restore data
the `up` destroyed, and their existence encourages destructive `up` steps on the assumption that they
are reversible. The real safety mechanism is that no single migration destroys anything — see the
expand/contract pattern below.

## Safety classification

Every migration is classified before it is written, because the class decides whether it can be one
file or must be several.

**Safe to apply online:**

- Adding a nullable column
- Adding a table
- Adding an index with `CONCURRENTLY`
- Adding a `CHECK` as `NOT VALID`, then `VALIDATE` in a later statement
- Backfilling in bounded batches
- Dropping an index with `CONCURRENTLY`

**Never in one step:**

| Change | Why it is unsafe | Do instead |
|---|---|---|
| `ADD COLUMN NOT NULL DEFAULT …` on a large table | rewrites the table under a lock | add nullable → backfill in batches → set `NOT NULL` |
| `RENAME COLUMN` / `RENAME TABLE` | deployed code still uses the old name | expand/contract (below) |
| `ALTER TYPE` on a populated column | rewrite plus a lock, and may fail mid-way | new column → backfill → switch → drop |
| `DROP COLUMN` still read by deployed code | breaks the running version | stop reading → deploy → drop in a later migration |
| `CREATE INDEX` without `CONCURRENTLY` | blocks writes for the build | always `CONCURRENTLY` |
| Adding a foreign key to a populated table | validates under a lock | add `NOT VALID` → `VALIDATE CONSTRAINT` |

## Expand / contract

Every rename, retype, or restructure is four migrations and at least two deploys. This is the pattern
that makes forward-only safe:

```text
1  expand      add the new column/table alongside the old      (safe, online)
2  dual-write  application writes both, reads the old          (deploy)
3  backfill    copy historical rows in batches                 (safe, online)
4  switch      application reads the new, still writes both    (deploy)
5  stop        application writes only the new                 (deploy)
6  contract    drop the old column/table                       (migration)
```

Steps 1, 3, and 6 are migrations; 2, 4, and 5 are application deploys. Collapsing this into one
migration is the single most common way a monorepo takes production down.

## Batched backfills

```sql
-- 20260801090000-backfill-company-ids.sql
-- Bounded, resumable, and safe to re-run. Not a single UPDATE over millions of rows.
DO $$
DECLARE
  batch_size constant integer := 5000;
  affected integer;
BEGIN
  LOOP
    UPDATE job_postings jp
       SET company_id = ca.company_id
      FROM company_aliases ca
     WHERE jp.company_id IS NULL
       AND ca.normalized = lower(regexp_replace(jp.company_name_raw, '[^a-z0-9]', '', 'gi'))
       AND jp.id IN (
         SELECT id FROM job_postings
          WHERE company_id IS NULL AND company_name_raw IS NOT NULL
          LIMIT batch_size
       );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    COMMIT;                      -- release locks between batches
  END LOOP;
END $$;
```

Rules: bounded batches, commit between them, idempotent so a retry is a no-op, and never inside the
same migration as the DDL that created the column.

## Knowledge rows are versioned, not migrated

A changed immigration threshold or salary band is **data**, not a schema change. It arrives as a new
row with a new `effective_from`, superseding the old (`docs/architecture/immigration.md`). Writing a
migration to `UPDATE` a rule's value destroys the history someone planned against — and there is no
migration that can restore it.

The distinction: migrations change *shape*, ingestion changes *facts*.

## Review checklist

A migration is reviewed against all of these:

- [ ] Classified safe-online, or split into expand/contract steps
- [ ] Names follow `.claude/skills/database/SKILL.md` — `fk_`, `idx_`, `uq_`, `ck_` with the table
- [ ] Every foreign key has an explicit `ON DELETE`
- [ ] Indexes for every new access path, created `CONCURRENTLY`
- [ ] `created_at`, `updated_at`, `deleted_at` present on a new table
- [ ] Partial indexes filter `deleted_at IS NULL`
- [ ] `timestamptz`, not `timestamp`
- [ ] `text` + `CHECK`, not a PostgreSQL `enum`
- [ ] The entity document under `entities/` was written or updated **first**
- [ ] Retention recorded in `data-retention.md` for a new table
- [ ] No PII in the migration file, its comments, or its name
- [ ] Derived columns carry their evidence and version columns
- [ ] Verified with `EXPLAIN (ANALYZE, BUFFERS)` if it adds a query path

## Local and CI

- Migrations run against a real PostgreSQL, never an in-memory substitute — dialect differences are
  exactly where the bugs are (`.claude/skills/testing/SKILL.md`).
- CI applies every migration from scratch on an empty database, then applies them again to confirm
  idempotence where claimed.
- A migration that has been applied to a shared environment is immutable. Fix forward.

## Related

- `schema-overview.md`, `relationships.md`, `entities/*`
- `data-retention.md` — required for every new table
- `.claude/skills/database/SKILL.md` — naming and column conventions
- `docs/development/ci-cd.md`
