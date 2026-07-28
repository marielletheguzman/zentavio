# Environment

> **Purpose:** Env vars, secrets, config layering.

**`packages/config` exists and is the only reader of the environment.** No variable is *required* today:
the two keys that exist (`OLLAMA_HOST`, `ZENTAVIO_EVAL_MODEL`) both have working defaults, so the
repository runs with no `.env` at all.

```ts
import { load, zentavioSchema } from '@zentavio/config';
const config = load(zentavioSchema);   // throws ConfigError, naming every problem at once
```

## The enforced rule

> **`packages/config` is the only reader of the environment.**

`process.env` anywhere else fails the build (`no-restricted-syntax` in `eslint.config.mjs`, ADR-0005):

```text
Read configuration through packages/config. Untyped, undocumented env access is banned.
```

Untyped configuration read at ten call sites is how a service ends up with three different defaults for
one value, and how a missing variable becomes a runtime surprise instead of a startup failure.

## Layering

Later overrides earlier, and every layer is typed and validated at startup:

```text
1  schema defaults        packages/config — the declared shape, with safe defaults
2  .env.example           committed, names and placeholder values only
3  .env                   local, gitignored, never committed
4  process environment    what the platform injects in a deployed environment
5  platform secret store  secrets, injected at runtime, rotatable without a deploy
```

**Validated at startup, not at first use.** A service with a missing or malformed required value must
fail to start with a message naming the key — never start and fail later on the request that happens to
need it.

## Naming

```text
ZENTAVIO_<AREA>_<KEY>            general
CONNECTORS_<ID>_<KEY>            per connector — connectors.<id>.* namespace
NEXT_PUBLIC_<KEY>                Next.js, and PUBLIC MEANS PUBLIC
```

Anything not prefixed `NEXT_PUBLIC_` stays server-side. A secret in a `NEXT_PUBLIC_` variable is shipped
to every browser, and that is a lint-level concern in `eslint.config.mjs`, not a code-review hope
(`docs/architecture/security.md`).

## Secrets

| Rule | |
|---|---|
| Never in code, a fixture, a commit message, a log, or a document | `.gitignore` covers `.env*`, except `.env.example` |
| Never in a `NEXT_PUBLIC_` variable | it would be public |
| Injected at runtime from the platform secret store | rotatable without a code change |
| **Never in a `pull_request`-triggered CI job** | that workflow runs untrusted code (`ci-cd.md`) |
| Immigration and résumé data are not secrets — they are PII | different rules, see `docs/architecture/privacy.md` |

## What each part will need

Recorded now so the shape is predictable, and **not** created until the service exists:

| Area | Keys |
|---|---|
| `packages/db` | PostgreSQL connection, pool sizing |
| `packages/events` | Redis connection |
| `knowledge-engine/vector-store` | Qdrant host, collection prefix (ADR-0004) |
| `ai/*` | Ollama host, model name and version (ADR-0003) |
| `connectors/<id>` | credentials, rate limit overrides, enable flag |
| `services/api-gateway` | session secret, allowed origins, rate limits |
| `services/billing` | provider keys — the most sensitive set |

The eval runner reads two, both optional with working defaults, declared in
`packages/config/src/zentavio.ts`:

```bash
OLLAMA_HOST=http://127.0.0.1:11434     # default
ZENTAVIO_EVAL_MODEL=qwen2.5:7b-instruct
```

These are the one place configuration is duplicated across the language boundary: the Python eval
runner is stdlib-only and cannot import the schema, so it repeats the defaults. Drift would mean a
graded eval running against a different model than configured, so it is checked by
`ai/shared/evals/tests/test_config_parity.py` rather than trusted.

## Local development

```bash
cp .env.example .env      # then fill in local values
```

Not required today — every key has a default.

`.env.example` is committed and lists **every** key with a placeholder — it is the discoverable
inventory of what configuration exists. A key that exists in code but not in `.env.example` is a
documentation bug.

## Adding a configuration value

1. Add it to the schema in `packages/config`, typed, with a default or an explicit "required" marker.
2. Add the key to `.env.example` with a placeholder.
3. Read it **only** through `packages/config`.
4. If it is a secret, add it to the platform secret store — never to `.env.example` with a real value.
5. Document it in the table above if it is a new area.

## Related

- `getting-started.md` — setup, which currently needs no configuration
- `ci-cd.md` — secret handling in CI
- `docs/architecture/security.md`, `docs/architecture/privacy.md`
- `.claude/skills/backend-service/SKILL.md` — the config rule in its enforcing skill
