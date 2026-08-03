# config

> **Purpose:** Environment loading, config layering, feature flags.

**The only place `process.env` is read.** Anywhere else fails the build (`eslint.config.mjs`,
ADR-0005), because configuration scattered through a codebase is configuration nobody can inventory.

```text
src/
├── schema.ts     the schema type: env name, kind, bounds, default, description
├── load.ts       validate and resolve, reporting every problem at once
└── zentavio.ts   the actual keys — the source of truth for .env.example
```

`load()` reports **all** invalid keys together rather than the first, because a misconfigured
environment usually has more than one problem and fixing them one restart at a time is how an
afternoon disappears.

**A key with no default is deliberate.** `ZENTAVIO_DATABASE_URL` and the service URLs have none: a
plausible-but-wrong default fails silently against the wrong host, which is worse than refusing to
start. An empty default means *denied* — an empty `ZENTAVIO_WEB_ORIGIN` sends no CORS headers, and
empty OIDC values mean the gateway refuses every request.

`.env.example` must list exactly these keys — a key here but not there is undiscoverable
configuration, and one there but not here is a key someone sets expecting it to do something. The
Python side duplicates two defaults because it cannot import TypeScript; parity is checked rather
than trusted (`ai/shared/evals/tests/test_config_parity.py`).

## Not here

Feature flags, and layered per-environment overrides. One flat schema is enough while there is one
environment.
