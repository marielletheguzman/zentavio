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
| **Git** | any recent | — |

Vitest installs with `pnpm install` — no separate step.

Not needed yet, because nothing uses them: Docker, PostgreSQL, Redis, Qdrant, Ollama, uv, Terraform. They
arrive with the services that need them. **Docker becomes a prerequisite** when the Vitest `integration`
project gets its first test, which needs `packages/db` to exist first.

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

Named so nobody hunts for them: no dev server, no database, no migrations, no seed data, no Docker
compose, no **application** tests (the tests that exist cover tooling), no integration tests, no deployed
environment. Sequence in
[`../roadmap/phases.md`](../roadmap/phases.md).

## Related

- `environment.md` — configuration and secrets
- `ci-cd.md` — what CI enforces
- `contributing.md`, `branching.md`, `testing.md`
