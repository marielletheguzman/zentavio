# docker

> **Purpose:** Dockerfiles and compose definitions per service.

## Local development

```bash
docker compose -f infra/docker/docker-compose.dev.yml up -d --wait
```

`--wait` blocks on the container's health check, so a migration run or a test suite cannot race the
database's boot.

| Service | Image | Port | Databases |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | 5432 | `zentavio`, `zentavio_test` |

`zentavio_test` is created by `postgres/init/01-create-test-database.sql`, which runs once on an
empty data directory. It is separate from `zentavio` rather than a schema inside it because the
Vitest `integration` project drops and rebuilds everything it owns on every run — a suite that can
destroy a developer's working data eventually does.

Credentials are development-only and in the compose file rather than in an environment variable:
this database is reachable from localhost only, holds no real data, and a developer forced to invent
a password invents a different one on every machine.

## What is deliberately not here

Redis and Qdrant are in the stack (`.claude/context/tech-stack.md`) but nothing reads them yet. A
service declared before its first reader is a service nobody verifies — the same rule
`packages/config/src/zentavio.ts` applies to environment keys.

Service Dockerfiles arrive with the first deployable service.

## Connection strings

```
ZENTAVIO_DATABASE_URL=postgres://zentavio:zentavio_dev@localhost:5432/zentavio
ZENTAVIO_TEST_DATABASE_URL=postgres://zentavio:zentavio_dev@localhost:5432/zentavio_test
```

Read only through `@zentavio/config` — `process.env` elsewhere fails the build (ADR-0005).

## Related

- `packages/db/migrations/README.md` — what gets applied to this database
- `tests/integration/README.md` — how the suite uses it
- `.claude/context/tech-stack.md`
