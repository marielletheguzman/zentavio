# Getting Started

> **Purpose:** Local setup, prerequisites, first run.

**There is no application to run yet.** This repository is a documentation-first skeleton: the tooling,
the boundaries, and the checks are real; the services are not. So "first run" means *get the checks
passing locally*, which is genuinely all there is to do today.

Anything below that you cannot execute is a bug in this document — say so rather than working around it.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node** | ≥ 20.11 (CI uses 22) | the TypeScript half |
| **pnpm** | from `packageManager` via corepack — do not install separately | workspace management (ADR-0001) |
| **Python** | 3.12 (CI) or 3.13 | the `ai/` half (ADR-0003) |
| **Ruff** | pinned in `requirements-dev.txt` | lint and format for `ai/` |
| **pytest** | pinned in `requirements-dev.txt` | tests for `ai/` (ADR-0007) |
| **Docker** | any recent, daemon running | PostgreSQL for `pnpm test:integration` |
| **Git** | any recent | — |

Vitest installs with `pnpm install` — no separate step.

Docker is required only for `pnpm test:integration`. `pnpm lint:all` — which is what CI's TypeScript
job runs — needs nothing beyond Node and pnpm.

Still not needed, because nothing uses them: Redis, Qdrant, Ollama, uv, Terraform. They arrive with
the services that need them.

## Setup

```bash
git clone https://github.com/<owner>/zentavio.git
cd zentavio

# pnpm comes from package.json's packageManager field. Corepack ships with Node.
corepack enable
pnpm install --frozen-lockfile

# Python tooling for ai/
pip install -r requirements-dev.txt
```

**Do not `npm install -g pnpm`.** Corepack pins the exact version from `package.json`, so CI and your
machine cannot drift. If `pnpm` is not on your PATH after `corepack enable`, `corepack pnpm <cmd>` works
directly.

## First run

```bash
pnpm lint:all
```

That is the whole thing, and it runs exactly what CI runs:

| Step | Checks |
|---|---|
| `eslint .` | layer boundaries, banned imports, no `process.env` outside `packages/config` |
| `tsc --noEmit` | strict TypeScript |
| `vitest run --project unit` | the fast TypeScript tests (ADR-0007) |
| `ruff check ai/` | `ai/` statelessness — no database, cache, or vector client |
| `python -m pytest` | the Python tests — currently the prompt-eval runner |
| boundary-disable audit | no inline `eslint-disable` silencing a layer rule |

Expect it to pass: 9 Vitest tests and 43 pytest tests, and the eval runner reporting `no prompt fixtures
found` — which is correct, since no prompt exists yet.

## Individual commands

```bash
pnpm lint              # ESLint only
pnpm lint:fix          # and fix what is auto-fixable
pnpm typecheck         # tsc --noEmit
pnpm test              # both Vitest projects
pnpm test:unit         # the fast project — what lint:all and CI run
pnpm test:watch        # watch mode
pnpm test:py           # pytest
pnpm lint:py           # ruff check ai/
pnpm eval:offline      # prompt fixture checks (no model needed)
pnpm eval              # graded evals — needs a local Ollama, skips without one
pnpm boundaries:audit  # suppressed layer rules
```

## Proving the boundaries are real

Worth doing once, so the rules are not abstract. Create a file that violates a layer:

```bash
mkdir -p packages/db/src
printf "import { x } from '../../../services/matching/src/rank';\nexport const y = x;\n" \
  > packages/db/src/probe.ts
pnpm lint
```

You should see the layer rule fire, naming the ADR it protects:

```text
packages/* must not import from apps/, services/, connectors/, or knowledge-engine/.
A shared library that knows its consumers is not shared — ADR-0001  boundaries/element-types
```

Then delete it: `rm -rf packages/db/src`.

## Where to read next

1. [`../../CLAUDE.md`](../../CLAUDE.md) — what Zentavio is, and the five non-negotiable principles
2. [`../roadmap/vision.md`](../roadmap/vision.md) — users, destinations, the design test
3. [`../GLOSSARY.md`](../GLOSSARY.md) — the vocabulary, including what each score is *not*
4. [`../architecture/overview.md`](../architecture/overview.md) — layers and boundaries
5. [`conventions.md`](conventions.md) — naming, types, commits
6. [`../09_AI_SKILLS/AI_SKILLS.md`](../09_AI_SKILLS/AI_SKILLS.md) — how Claude works in this repo

## Troubleshooting

| Symptom | Cause |
|---|---|
| `pnpm: command not found` | run `corepack enable`, or use `corepack pnpm` |
| `ruff: command not found` | `pip install -r requirements-dev.txt`; on Windows add Python's user `Scripts` directory to PATH |
| `tsc` reports `TS18003` | expected only if `tsconfig.json`'s includes were changed — it needs at least one input |
| ESLint errors on a new top-level directory | `boundaries/no-unknown-files` — add it to `boundaries/elements` in `eslint.config.mjs`, deliberately |
| Lockfile conflict after a pull | `pnpm install --frozen-lockfile`; never hand-merge `pnpm-lock.yaml` |

## What does not exist yet

Named so nobody hunts for them: no dev server, no seed data, no HTTP API, no UI, no deployed
environment, and no `migrate` command (migrations are applied programmatically — see
`packages/db/README.md`). The schema covers `requirements` and `immigration_pathways` only.
Sequence in [`../roadmap/phases.md`](../roadmap/phases.md).

## The database

```bash
docker compose -f infra/docker/docker-compose.dev.yml up -d --wait
export ZENTAVIO_TEST_DATABASE_URL=postgres://zentavio:zentavio_dev@localhost:5432/zentavio_test
pnpm test:integration
```

The integration suite drops and rebuilds its schema on every run, so it refuses any database whose
name does not end in `_test`. Details in [`../../tests/integration/README.md`](../../tests/integration/README.md)
and [`../../infra/docker/README.md`](../../infra/docker/README.md).

## Related

- `environment.md` — configuration and secrets
- `ci-cd.md` — what CI enforces
- `contributing.md`, `branching.md`, `testing.md`
