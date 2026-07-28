# CI/CD

> **Purpose:** Pipeline stages and deploy flow (Vercel).

CI exists to make the architecture's rules mechanical. Every boundary in `docs/architecture/` and
every constraint in `.claude/skills/` is either enforced here or held by review alone — and rules
held by review alone decay. ADR-0005 is the decision that put the layer model into a lint config;
this pipeline is what runs it.

## Pipeline

Defined in `.github/workflows/ci.yml`, with reusable steps in `infra/ci/actions/`.
Triggers: every pull request, every push to `main`, and manual dispatch.

```text
pull_request / push:main
   │
   ├── typescript ──── pnpm lint          layer boundaries, banned imports, process.env
   │                   pnpm typecheck     strict TypeScript
   │                   audit script       suppressed boundary rules
   │
   ├── python ──────── ruff check ai/     ai/ statelessness bans
   │                   ruff format --check
   │
   └── ci ─────────── aggregates both — the single required status check
```

### `typescript`

| Step | Command | Enforces |
|---|---|---|
| ESLint | `pnpm lint` | the layer model (`boundaries/element-types`), the connector registry rule, banned stack dependencies, no LLM SDK, no `process.env` outside `packages/config`, Qdrant only behind its port |
| Typecheck | `pnpm typecheck` | strict TypeScript across root tooling, and per-workspace configs as they appear |
| Boundary audit | `node tools/scripts/audit-boundary-disables.mjs` | that no inline `eslint-disable` is silencing a layer rule |

`eslint.config.mjs` is the executable form of the layer table in
`.claude/skills/architecture/SKILL.md`. If the two disagree, one of them is a bug.

The audit step exists because `eslint-plugin-boundaries` is advisory — a disable comment silences
it. A boundary disable is an architecture exception and needs an ADR, so it fails the build rather
than passing quietly.

### `python`

ESLint cannot see `ai/` — it is Python (ADR-0003). The rules keeping the AI layer stateless live in
`ruff.toml`: importing `sqlalchemy`, `psycopg`, `psycopg2`, `asyncpg`, `alembic`, `redis`,
`qdrant_client`, or `boto3` anywhere under `ai/` fails the build. `ai/` owns no store; state lives
in `packages/db` and `knowledge-engine/`.

Markdown is excluded from Ruff. Recent Ruff versions format Python inside fenced code blocks, and a
formatter rewriting an example inside a document is an unreviewed doc change.

### `ci`

An aggregation job that fails if either job above failed. Branch protection requires this one
check, so adding a job to `ci.yml` makes it blocking without touching repository settings.

## Gates

| Gate | When | Blocking | Implemented |
|---|---|---|---|
| `ci` status check | every pull request | yes | **yes** — `.github/workflows/ci.yml` |
| Prompt eval **coverage** (offline) | every pull request | yes | **yes** — `pnpm eval:offline` in the `python` job |
| Prompt eval **grading** | any prompt change | yes, by policy | **not in CI** — needs a model host |
| ADR present | any new dependency, boundary change, or contract change | review | review only |
| Docs updated | any change to documented behavior | review | review only |

**Two halves, and only one runs here.** The offline half is enforced on every pull request: a prompt
cannot merge without a fixture directory, and fixtures cannot merge missing any of the six required
case kinds — including the unknown-handling and injection cases, which are the two that are invisible
in normal use and harmful when they regress.

The grading half is implemented (`ai/shared/evals/run_evals.py`) but needs a reachable Ollama host,
which the GitHub-hosted runner does not have. Until that is solved — self-hosted runner, or a required
manual gate with the delta report attached — graded runs happen locally. With zero prompts in the
repository the offline step passes trivially: a real check that is currently a no-op, not a claim that
grading is happening.

Once grading is wired: a regression on the unknown-handling or injection cases blocks regardless of
average score improvement.

## Toolchain pinning

CI and a developer's machine must run the same rule set, or a green run means nothing.

- **pnpm** — from `package.json`'s `packageManager` field, activated by corepack. No third-party
  setup action.
- **Node** — `22` in CI; `package.json` `engines` requires `>=20.11.0`.
- **Ruff** — pinned in `requirements-dev.txt`. A different Ruff version is a different rule set.
- **Installs** — always `pnpm install --frozen-lockfile`.
- **Third-party actions** — pinned to commit SHAs with the version in a trailing comment
  (`actions/checkout@11d5960… # v4.4.0`). Tags are mutable; a SHA is not.

## Local equivalence

```bash
pnpm install
pnpm lint:all      # eslint + tsc + ruff + boundary audit — what CI runs
```

`pnpm lint:all` invokes the binaries directly rather than through `pnpm run`, so it works
regardless of how pnpm itself is invoked. Run it before pushing; same checks, same order.

Python tooling is separate: `pip install -r requirements-dev.txt` once, then `ruff` is on PATH.

## Not yet built

- **Graded prompt evals in CI.** The runner exists and the offline half is wired; grading needs a
  model host. Decide between a self-hosted runner with Ollama and a required manual gate, and record
  the choice as an ADR. Also outstanding: posting the delta report to the pull request, and failing a
  prompt change that did not bump its `promptVersion`.
- **Test and build jobs** — there is no application code yet. Test levels and what must never be
  mocked: `.claude/skills/testing/SKILL.md`.
- **Path-filtered tasks** via Turborepo's task graph (ADR-0001 follow-up). Deliberately not applied
  to the lint jobs: filtering the checks that enforce boundaries is how a boundary stops being
  enforced.
- **Deployment.** Vercel for `apps/*` (`infra/vercel`), containers for `services/*` and `ai/*`
  (`infra/docker`, `infra/terraform`). Environments, promotion, and rollback are undecided; each
  needs its own ADR before it is built.

## Related

- `infra/ci/README.md` — where workflow files live and why
- ADR-0005 (boundary enforcement), ADR-0001 (monorepo), ADR-0003 (polyglot boundary)
- `docs/development/testing.md`, `docs/prompts/evals.md`, `docs/development/branching.md`
