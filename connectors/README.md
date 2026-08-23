# connectors

> **Purpose:** Plugin-based external data sources. Each source implements the common connector contract.

**What is built:** `core` — the contract, the registry, the composition root, and the shared retry,
rate-limiting and error taxonomy — plus eight sources across three domains. `salary-data/`,
`company-data/` and `market-trends/` have no source at all yet.

Adding a source is one folder plus a registry line. Nothing in `services/` may learn a source's
name, and `eslint.config.mjs` makes `import { greenhouse }` inside `services/` a build error rather
than a review comment (ADR-0002, ADR-0005).

| Directory | State |
|---|---|
| `core/` | **built** — contract, registry, composition root, retry, rate limiting, error taxonomy |
| [`immigration-data/`](immigration-data/README.md) | **built** — six sources across four countries: `de-bundesanzeiger`, `de-aufenthg`, `de-bayingg`, `lu-legilux`, `nz-inz`, `ch-sem` |
| [`learning-resources/`](learning-resources/README.md) | **built** — `git-scm`, the only source here |
| [`job-boards/`](job-boards/README.md) | **built** — `lever`; `greenhouse`, `indeed`, `linkedin`, `remoteok`, `country-boards` are placeholders |
| `salary-data/`, `company-data/`, `market-trends/` | placeholder |

## A connector is not wired by existing

`connectors/core/src/default-registry.ts` is the only module permitted to name a source, and
`tests/unit/invariants/connector-registration.test.ts` fails if a built connector is missing from
`createRegistry`. That invariant found `de-bayingg` composed into no registry at all, with no
symptom, because nothing consumed the registry at runtime yet.

The confusion it exists to catch: `registerConnectorSource` writes a `connector_sources` **database**
row and is also called "registering". Doing that is not the same as being in the registry.

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
