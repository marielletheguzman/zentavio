# packages

> **Purpose:** Shared internal libraries consumed across apps and services.

| Package | State |
|---|---|
| `db` | built — Kysely schema, migrations, repositories (ADR-0012) |
| `types` | built — domain types and the TypeScript/Python wire contracts (ADR-0003) |
| `config` | built — the only place `process.env` is read (ADR-0005) |
| `auth` | built — OIDC verification and subject resolution (ADR-0017) |
| `events` · `logger` · `i18n` · `ui` | placeholder |

**One concern per package, and the boundary is enforced rather than agreed** — `eslint.config.mjs`
fails the build on a cross-boundary import, because a layering rule nobody checks is a layering rule
that already broke.
