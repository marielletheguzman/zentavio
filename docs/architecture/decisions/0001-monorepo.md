# ADR 0001: Monorepo

> **Purpose:** Why a monorepo (Turborepo).

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** repository root, `apps/`, `services/`, `ai/`, `packages/`, `connectors/`, `knowledge-engine/`, `infra/ci`

## Context

Zentavio is one product built from many deployable units: three frontends, five TypeScript
services, six Python AI services, a growing set of connectors, and a knowledge substrate they all
read. Those units share contracts constantly — a job posting type, an event name, a score
envelope, an auth token shape.

The tension is that the boundaries between these units are **strict** (ADR-0002 and ADR-0003, and
the layering rules in `.claude/skills/architecture/SKILL.md`, all depend on them) while the
contracts between them change **frequently and in lockstep**. A change to the `JobPosting` type
touches a connector, an ingestion service, a knowledge-engine ingest step, a Python AI service,
and a Next.js component — as one logical change.

Strict boundaries push toward separate repositories. Lockstep contract changes push toward one.
Choosing wrong makes either the boundaries unenforceable or every contract change a
multi-repository release dance.

Two further constraints: the project is polyglot from day one (TypeScript + Python), so no tooling
choice may assume a single package manager owns the whole tree; and CI must not rebuild fourteen
units when one component changes.

## Options considered

### Option A — Polyrepo: one repository per service, shared code published as packages

**Pros.** Boundaries are physically enforced — a cross-boundary import is impossible, not merely
forbidden. Independent versioning and release cadence. Smaller clone and CI surface per
repository. Per-repository access control if that is ever needed.

**Cons.** A contract change becomes: publish `@zentavio/types@1.4.0`, then five dependent pull
requests, then five deploys, in order. At this stage that is the *most common* kind of change, so
the dominant workflow becomes the slowest one. Cross-cutting refactors are effectively impossible
— nobody renames an event across nine repositories. Version skew becomes normal, and two services
running different `types` versions is a class of bug that does not exist in a monorepo. Atomic
changes are impossible, so "the doc, the code, and the test ship together" (principle 5) cannot be
enforced by review. Local development needs linking or snapshot publishing. Nine copies of CI
configuration to keep identical.

### Option B — Monorepo with Turborepo

**Pros.** A contract change is one commit, one review, one CI run, atomically consistent. No
version skew between internal packages — the tree is always coherent. Cross-cutting refactors are
mechanical. One lint configuration, one convention set. The directory tree becomes the
architecture diagram, which is how the `architecture` skill already reasons. Turborepo
specifically solves the CI problem: a task graph over workspaces with content-hash caching, so an
`apps/web`-only change runs only what depends on `apps/web`. Configuration is a single
`turbo.json` — minimal, and it does not want to own the Python tree.

**Cons.** Boundaries are conventional, not physical; nothing stops
`import { greenhouse } from '../../connectors/...'` except lint rules and review. Turborepo
manages the TypeScript workspaces only — `ai/` needs its own toolchain, so the repository will
never feel tooling-unified. Repository size grows monotonically. A single `main` means one bad
commit blocks everyone.

### Option C — Monorepo with Nx

**Pros.** A richer dependency graph, code generators, module-boundary enforcement built in (which
directly serves the layering rules), and first-class polyglot plugin support.

**Cons.** Substantially more configuration and concepts to carry, and its generators and executors
want to own how each project builds — which conflicts with `ai/` having its own idiomatic Python
tooling and with `apps/web` deploying through Vercel's own pipeline. The boundary enforcement is
attractive, but the same rule can be had from a lint rule at a fraction of the total complexity.
Chosen against on cost, not capability; worth revisiting if the tree grows past what a task graph
plus lint rules can police.

### Option D — Do nothing: no defined structure, add directories as needed

**Pros.** Zero setup cost now.

**Cons.** The boundary rules everything else depends on would have no home and no enforcement
point. "Where does this file go?" would be answered differently every session — precisely the
failure mode a documentation-first skeleton exists to prevent. This is the absence of a decision,
not an option.

## Decision

All Zentavio code lives in a single monorepo managed by Turborepo, with layer boundaries enforced
by lint rules and workspace configuration rather than by repository separation; `ai/` keeps its
own Python toolchain inside the same tree.

## Consequences

**Accepted costs.**

- Boundary violations are possible in principle and must be caught by lint rules and review, not
  by the impossibility of the import. A missing lint rule means a silent architecture violation.
- Turborepo covers the TypeScript workspaces only. The Python tree under `ai/` is cached and
  built separately, so CI has two mechanisms and a change touching both needs both toolchains
  installed locally.
- Repository size grows monotonically. Shallow clones and sparse checkout become necessary later.
- A single `main` requires green-main discipline; one broken commit blocks every unit.
- Turborepo's remote cache is another piece of infrastructure to configure and trust.

**Follow-up work.**

- Configure workspaces so `packages/*` is importable by `apps/*` and `services/*`, never the
  reverse.
- Add the dependency-direction lint rule encoding the layer model in
  `.claude/skills/architecture/SKILL.md`: `apps` → `services` → `ai` / `knowledge-engine` →
  `packages/types`, with `packages/*` importing none of them, and connectors importable only by
  the registry.
- Author `turbo.json` with `build`, `test`, `lint`, `typecheck` tasks and correct `dependsOn`
  edges, plus remote caching in `infra/ci`.
- Wire the Python side of CI for `ai/` with its own path filtering.
- Decide and document the Python dependency tool for `ai/` (its own ADR if the choice has a
  tradeoff).
- Add a codeowners file once more than one person contributes.

**Reversal cost.** Moderate, and decreasing over time — which is the argument for this ordering.
Splitting out a service later is: extract the directory with `git filter-repo` to preserve
history, publish the shared packages it consumes, wire its CI. Days of work per service. Merging
nine repositories after a year of divergent conventions is far worse. Monorepo-first,
split-later is the cheap direction; the reverse is not.

## Compliance

- **Dependency-direction lint rule** — `boundaries/element-types` in `eslint.config.mjs`, failing
  CI on a reversed import. This is the primary enforcement; without it this ADR is only a
  preference. Mechanism chosen in ADR-0005.
- **Connector import rule:** any import of a connector outside `connectors/core`'s registry fails
  the build (ADR-0002) — the `service` and `connector` rules in `eslint.config.mjs`.
- **`packages/*` isolation:** the `package` rule in `eslint.config.mjs` allows only `package` and
  `package-types`, so importing `services/*`, `apps/*`, or `connectors/*` fails.
- **No unpoliced files:** `boundaries/no-unknown-files` fails on any TypeScript file matching no
  element type, so a new top-level directory cannot silently escape the layer model.
- **Reviewer check:** a change altering a shared contract touches all its consumers in the same
  diff. If it does not, the change is incomplete or a boundary is wrong.
- **CI check:** an `apps/web`-only change must not run the Python test suite. Verify after any
  `turbo.json` edit.

## Related

- ADR-0002 (connector plugin model), ADR-0003 (Python for AI services)
- `.claude/skills/architecture/SKILL.md` — the layer model this enforces
- `.claude/context/architecture.md`, `.claude/context/tech-stack.md`
- `docs/architecture/overview.md`, `docs/development/conventions.md`
