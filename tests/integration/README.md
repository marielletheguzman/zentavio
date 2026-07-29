# integration

> **Purpose:** Cross-service integration tests.

Real PostgreSQL, never a substitute. `docs/development/testing.md` forbids mocking it, because what
a `CHECK` actually rejects and what a partial unique index actually permits is the entire thing
these tests establish — and neither is knowable from a fake.

## Running

```powershell
docker compose -f infra/docker/docker-compose.dev.yml up -d --wait
$env:ZENTAVIO_TEST_DATABASE_URL='postgres://zentavio:zentavio_dev@localhost:5432/zentavio_test'
pnpm test:integration
```

```bash
export ZENTAVIO_TEST_DATABASE_URL=postgres://zentavio:zentavio_dev@localhost:5432/zentavio_test
pnpm test:integration
```

## The suite owns its database

`db/database.ts` drops and recreates the schema, then applies every migration from empty. Rebuilding
rather than truncating proves on every run that the migration set applies to the state a fresh
environment or a CI job actually starts in.

Two independent things must be wrong before that destroys anything:

1. `ZENTAVIO_TEST_DATABASE_URL` is a **separate variable** from `ZENTAVIO_DATABASE_URL`.
2. `assertTestDatabase` refuses any connection string whose database name does not end in `_test`.

## What is tested here, and what is not

| File | Establishes |
|---|---|
| `db/migrations.test.ts` | the SQL is valid, applies from empty, is a no-op on a second run, and creates every documented table and index |
| `db/requirements-constraints.test.ts` | every `CHECK`, unique index, and foreign key **rejects what it should** |
| `db/users-constraints.test.ts` | ADR-0013's compliance: a differently-cased email is rejected, the lookup uses the index, and **no PostgreSQL extension is installed** |
| `db/schema-drift.test.ts` | `packages/db/src/schema.ts` still describes the live schema — ADR-0012's named weakness |

`schema-drift.test.ts` **parses** `schema.ts` with TypeScript's own parser rather than comparing it
against a hand-kept runtime copy of the table list. A copy would only move the drift: the copy and
the interface would become the two things out of step.

Constraint tests assert on the **constraint name** in the PostgreSQL error, not merely that
something threw — a bare "it failed" passes just as happily when the insert failed for a typo in a
column name.

Rows are inserted with raw SQL rather than through `packages/db`'s repository. These tests establish
what *the database* enforces; routing them through the repository's guards would mean a green suite
could not distinguish "the constraint rejected it" from "TypeScript did". The repository keeps its
own compile-only tests in `packages/db/src/repositories/`.

## Related

- `docs/development/testing.md` — the pyramid, and what must never be mocked
- `packages/db/migrations/README.md`
- `infra/docker/README.md`
