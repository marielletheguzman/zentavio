# Getting Started

> **Purpose:** Local setup, prerequisites, first run.

**There is no application to run yet.** This repository is a documentation-first skeleton: the tooling,
the boundaries, and the checks are real; the services are not. So "first run" means *get the checks
passing locally*, which is genuinely all there is to do today.

Anything below that you cannot execute is a bug in this document — say so rather than working around it.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node** | ≥ 22.18 (CI uses 22) | the TypeScript half. The floor is ADR-0014: below 22.18 Node cannot strip types, so no `.ts` entrypoint runs |
| **pnpm** | from `packageManager` via corepack — do not install separately | workspace management (ADR-0001) |
| **Python** | 3.12 (CI) or 3.13 | the `ai/` half (ADR-0003) |
| **uv** | pinned; installs everything under `ai/` | the Python workspace and its lockfile (ADR-0006) |
| **Ruff** | pinned in `ai/pyproject.toml`, locked in `ai/uv.lock` | lint and format for `ai/` |
| **pytest** | pinned in `ai/pyproject.toml`, locked in `ai/uv.lock` | tests for `ai/` (ADR-0007) |
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

# Python tooling for ai/ — one workspace, one lockfile (ADR-0006)
pip install uv==0.9.6      # or: pipx install uv, or Astral's standalone installer
pnpm py:sync               # uv sync --project ai
```

**`services/*` are compiled; everything else is not.** NestJS needs decorators, which Node's
type-stripping cannot run, so a service is built before it runs (ADR-0014's 2026-08-01 amendment):

```bash
pnpm --filter @zentavio/api-gateway build   # tsc -p tsconfig.build.json
pnpm --filter @zentavio/api-gateway start   # node dist/main.js
```

Scripts and CLIs are unchanged — `pnpm migrate` and `pnpm seed` still run TypeScript directly with no
build step. A stale `dist/` is the failure mode to watch for: the symptom is a change that appears to
do nothing.

**`ZENTAVIO_RESUME_PARSER_URL` must be added to `.env.example` by hand** — that file is not writable
from this environment. It has no default, deliberately.

**Two things named "workspace" live here.** pnpm workspaces manage the TypeScript packages; the uv
workspace at `ai/pyproject.toml` manages the Python services. They are conceptually similar and
mechanically unrelated — ADR-0006 accepted that confusion as a cost, so it is named rather than
glossed.

`requirements-dev.txt` is **gone** (2026-08-02). CI installs the Python half with
`uv sync --project ai --all-packages --frozen`, so `ai/pyproject.toml` and `ai/uv.lock` are the only
declaration of a Python dependency — adding one no longer means mirroring it into a second file.

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
| `pnpm test:py` | the Python tests — currently the prompt-eval runner. Runs through uv |
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
| `ruff: command not found` | `pnpm py:sync`; every Python command goes through `uv run --project ai`, so Ruff need not be on PATH |
| `uv: command not found` | `pip install uv==0.9.6`; on Windows add Python's user `Scripts` directory to PATH, or use `python -m uv` |
| `tsc` reports `TS18003` | expected only if `tsconfig.json`'s includes were changed — it needs at least one input |
| ESLint errors on a new top-level directory | `boundaries/no-unknown-files` — add it to `boundaries/elements` in `eslint.config.mjs`, deliberately |
| Lockfile conflict after a pull | `pnpm install --frozen-lockfile`; never hand-merge `pnpm-lock.yaml` |

## What exists, and what does not

This section went stale for several milestones and claimed there was no HTTP API, no UI, no seed
data and no `migrate` command while all four existed. It is the first page a contributor reads, so
it is worth keeping honest.

**Runs today, end to end:** a résumé uploads through `services/api-gateway` to `ai/resume-parser`,
becomes a versioned profile with a source span on every claim, is correctable, and can be compared
against a career track by `ai/skill-gap` to produce an ordered gap and a readiness score. Two pages
in `apps/web` render it.

```bash
pnpm migrate     # apply migrations
pnpm seed        # 30 skills, 107 aliases, one career, the graph — idempotent
```

| Built | Placeholder |
|---|---|
| `packages/db`, `config`, `types`, `auth` | `logger`, `events`, `i18n`, `ui` |
| `services/api-gateway` | `matching`, `ingestion`, `notifications`, `billing` |
| `ai/resume-parser`, `ai/skill-gap`, `ai/shared` | `career-roadmap`, `embeddings`, `interview-prep`, `learning-paths` |
| `apps/web` — upload and gap surfaces | `apps/admin`, `apps/mobile` |

**Genuinely absent, named so nobody hunts for them:** no deployed environment (ADR-0015's Supabase
project is decided but not provisioned), no real authentication in use (ADR-0017 is implemented but
needs a provider — the dev header is a stand-in refused in production), no connectors, no
knowledge-engine, and no outcome recording. Sequence in
[`../roadmap/phases.md`](../roadmap/phases.md).

**The schema is 11 tables**, not the two this section used to claim: `requirements`,
`immigration_pathways`, `users`, `careers`, `skills`, `skill_aliases`, `user_profiles`,
`profile_skills`, `skill_edges`, `career_skills`, `user_targets`.

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
