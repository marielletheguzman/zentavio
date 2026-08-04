# connectors

> **Purpose:** Plugin-based external data sources. Each source implements the common connector contract.

**What is built:** `core` — the contract, the registry, and the shared retry, rate-limiting and
error taxonomy. `immigration-data/de-bundesanzeiger` — the first real source. Every other directory
below is still a placeholder.

Adding a source is one folder plus a registry line. Nothing in `services/` may learn a source's
name, and `eslint.config.mjs` makes `import { greenhouse }` inside `services/` a build error rather
than a review comment (ADR-0002, ADR-0005).

| Directory | State |
|---|---|
| `core/` | **built** — contract, registry, retry, rate limiting, error taxonomy |
| `immigration-data/de-bundesanzeiger/` | **built** — Germany's annual EU Blue Card salary minimums |
| `immigration-data/` (other sources) | placeholder |
| `job-boards/`, `salary-data/`, `company-data/`, `learning-resources/`, `market-trends/` | placeholder |

## Before writing one, check the terms

`docs/architecture/connectors.md`, step 1: check terms of service and `robots.txt` **before** the
connector, and stop if automated access is disallowed. This is not a formality — it has already
ruled a source out. `make-it-in-germany.com` publishes `Allow: /` and then answers with a Radware
bot-protection challenge, so it is not integrated. **A permissive `robots.txt` is not sufficient
evidence on its own; fetch a page and see what it serves.**

## Related

- `core/README.md` — the contract and why the shared helpers live there
- ADR-0002 (plugin model), ADR-0005 (the lint rule that enforces the boundary)
- `docs/architecture/connectors.md`, `docs/development/connector-guide.md`
