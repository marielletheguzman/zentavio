# ADR 0007: Test strategy and runner

- **Status:** Accepted
- **Accepted:** 2026-07-28
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** every workspace, `infra/ci`, `package.json`, `tests/`

## Context

No test framework is installed and no application test exists, so this blocks the first one.
`.claude/skills/testing/SKILL.md` and `docs/development/testing.md` already define *what* must be
tested and which invariants matter; neither names a runner.

Four constraints make this non-obvious.

**The repository is polyglot** (ADR-0003). TypeScript under `apps/`, `services/`, `packages/`,
`connectors/`, `knowledge-engine/`; Python under `ai/`. No single runner covers both, so the real question
is what runs the TypeScript half — the Python half is `pytest` under the uv workspace (ADR-0006) with no
meaningful alternative.

**Integration tests must use a real PostgreSQL.** A mocked database proves the mock works, and dialect
differences are exactly where the bugs are. So the runner must tolerate slow, containerized,
serially-constrained tests alongside fast unit tests — and let CI run only the fast ones on every commit.

**The invariant tests are unusual.** Determinism (byte-identical scores), evidence reconciliation asserted
generically across every scorer, provenance enforced at the repository level, and `normalize` purity with
the clock and network stubbed to *throw*. These need real module mocking and fake timers, not just an
assertion library.

**Speed is a correctness property here.** The default suite must be fast enough to run on every save, or it
does not get run, and the invariants stop being enforced.

## Options considered

### Option A — Vitest

**Advantages.** Runs TypeScript with no build step via esbuild, which matters in a monorepo where a
build-then-test loop is the thing that makes people stop running tests. Fast watch mode with intelligent
re-runs. Jest-compatible API, so the ecosystem's knowledge transfers. First-class module mocking and fake
timers — needed for the purity and determinism tests. Workspace support maps onto pnpm workspaces, so each
package can have its own config while one command runs everything. Handles both fast unit tests and slow
integration projects in one tool with separate configs.

**Disadvantages.** Another dependency, and one moving faster than Jest. Its esbuild transform does not
type-check, so `tsc --noEmit` remains a separate step — already true in `lint:all`, so no new cost. Some
ecosystem tooling still assumes Jest.

### Option B — Node's built-in test runner (`node:test`)

**Advantages.** Zero dependencies — the strongest possible answer to `tech-stack.md`'s "no new dependency
without an ADR". Stable and maintained with Node itself. Sufficient for plain assertions.

**Disadvantages.** TypeScript needs a loader or a build step, and both are friction on every run. Module
mocking is immature relative to what the purity tests need. No watch-mode ergonomics worth the name. Weak
workspace story: running "all tests across nine workspaces" becomes a script we maintain. Chosen against on
capability, not on principle — the invariant tests are the specific thing it handles badly.

### Option C — Jest

**Advantages.** The most widely known. Mature mocking. Enormous ecosystem.

**Disadvantages.** Slow on a monorepo, and slowness here is a correctness risk. TypeScript support means
`ts-jest` or Babel, both of which add configuration and a transform step. ESM support remains awkward, and
this repository is ESM (`verbatimModuleSyntax`, `"module": "ESNext"`). Fighting a runner's module system in
2026 is avoidable.

### Option D — Do nothing yet; add a runner with the first service

**Advantages.** The choice would be informed by a real service's needs rather than predicted ones.

**Disadvantages.** The first test gets written *some* way, and that way becomes the convention — chosen by
whoever typed first rather than by anyone weighing it. This is the exact pattern `decision-gate.md`
forbids. It also means the invariant tests, which are the reason the strategy document exists, arrive after
the code they were meant to constrain.

## Decision

**Option A — Vitest for the TypeScript half, `pytest` for `ai/`.**

Two projects within one Vitest workspace: `unit` (fast, no external services, run on every save and every
commit) and `integration` (real containerized PostgreSQL, run in CI and on demand). Test files live beside
the code as `*.test.ts`; cross-package integration and e2e live in `tests/`.

The deciding factor is the invariant set. Determinism, purity-with-throwing-stubs, and generic
evidence-reconciliation assertions need real mocking and fake timers, which rules out Option B, and they
need to be fast enough to run constantly, which rules out Option C.

## Consequences

**Accepted costs.**

- Three new devDependencies (`vitest`, a coverage provider, and a PostgreSQL container helper), plus
  `pytest` on the Python side. Two test ecosystems permanently — a contributor touching both needs both.
- Vitest moves faster than Jest; the version is pinned and upgraded deliberately.
- No type-checking during test runs, so `tsc --noEmit` stays a separate `lint:all` step.
- The integration project needs Docker locally, which `getting-started.md` currently says is not required.
  That document changes when this is accepted.
- Coverage thresholds are deliberately **not** set. A number invites tests written to satisfy it; the
  invariant list is the real bar. Revisit only if coverage becomes a genuine gap rather than a metric.

**Follow-up work.**

- ~~`vitest.workspace.ts` defining the `unit` and `integration` projects.~~ **Done**, as
  `vitest.config.ts` — the workspace file was folded into the config when Vitest merged the two.
- ~~`pnpm test`, `test:unit`, `test:integration`, `test:watch`; extend `lint:all` to run
  `test:unit`.~~ **Done.**
- ~~Add both to `.github/workflows/ci.yml`.~~ **Done** — unit in the `typescript` job, integration
  as its own job against a `postgres:17-alpine` service container, pinned to the same tag as
  `infra/docker/docker-compose.dev.yml` so a green run is evidence about the right server.
- ~~A container helper that gives each integration test a clean schema, and applies migrations
  from `packages/db`.~~ **Done** — `tests/integration/db/database.ts`, which refuses any database
  whose name does not end in `_test` before it drops a schema.
- ~~`pytest` config in the uv workspace once `ai/` has a service.~~ **Resolved differently.** `ai/`
  has three services and the config stayed in `pytest.ini` at the repository root: CI runs pytest
  from there, so `testpaths = ai` still resolves, and a second configuration in `ai/pyproject.toml`
  would be drift waiting to happen.
- ~~Update `docs/development/testing.md` and `getting-started.md` to match.~~ **Done** — and they
  had gone stale in the meantime, still claiming the integration project had no tests and no CI
  job while 139 of them ran on every pull request.

**Reversal cost.** Low. Vitest's API is Jest-compatible, so moving to Jest is mostly configuration.
Moving to `node:test` would mean rewriting mocks. Nothing about the *strategy* — the invariants, the levels,
what must never be mocked — depends on the runner, which is why that document was written first.

## Compliance

- CI runs `test:unit` on every pull request; a failure blocks.
- The integration job is a separate CI job so its failure is legible, and it runs against a real
  PostgreSQL — asserted by the job failing if no database is reachable, rather than skipping.
- A test asserting a *range* on a deterministic score is a review rejection
  (`.claude/skills/testing/SKILL.md`).
- The generic invariant suites — evidence reconciliation, provenance-on-write, tier-5 rejection — exist as
  shared helpers applied across every scorer and repository, not per-feature copies.
- `grep` for `it.skip` / `describe.skip` in CI: a skipped test is either deleted or fixed, never left as
  decoration.

## Related

- `docs/development/testing.md`, `.claude/skills/testing/SKILL.md`
- ADR-0001 (monorepo), ADR-0003 (polyglot), ADR-0006 (uv workspace)
- `.claude/context/decision-gate.md` — why this is decided before the first test
