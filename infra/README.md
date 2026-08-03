# infra

> **Purpose:** Infrastructure as code and deployment configuration.

| Directory | State |
|---|---|
| `ci` | the composite action CI reuses (`actions/setup-node-pnpm`) |
| `docker` | local development only — Postgres compose file and its test-database init |
| `monitoring` · `terraform` · `vercel` | empty |

**Nothing here deploys anything.** `docker/` is a developer's local Postgres, not an environment.
ADR-0015 settles hosted PostgreSQL on Supabase in the EU region, but **the project is decided and
not provisioned** — so `terraform/` and `vercel/` stay empty rather than holding a guess at what
will be provisioned.
