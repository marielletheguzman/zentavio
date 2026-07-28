# ADR 0006: uv for the Python dependency toolchain

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** `ai/*`, `infra/ci`, `infra/docker`, `requirements-dev.txt`, `.github/workflows/ci.yml`

## Context

ADR-0003 put every AI capability service in Python, and ADR-0001 put them inside the TypeScript
monorepo. Both left the Python dependency manager undecided, and both listed deciding it as
follow-up work. It is now blocking: the first real service under `ai/` cannot be written without
knowing where its dependencies are declared and how CI installs them.

Three constraints make this non-obvious.

**`ai/` is seven directories, not one project.** `resume-parser`, `skill-gap`, `career-roadmap`,
`learning-paths`, `interview-prep`, `embeddings`, and `shared`. They share a base (FastAPI, the
`packages/types`-generated Pydantic models, the logging and error envelope from
`.claude/skills/backend-service/SKILL.md`) and diverge sharply at the edges — document parsing
libraries belong to `resume-parser` alone, embedding libraries to `embeddings` alone. A tool that
assumes one project per repository forces either one bloated shared environment or seven
disconnected ones with duplicated pins.

**Reproducibility is a correctness property here, not a convenience.** A score must be
reproducible from its recorded `scorerVersion`, `promptVersion`, and `knowledgeAsOf`
(`.claude/skills/ai-matching/SKILL.md`). If the library computing an embedding silently changes
minor version between runs, the recorded version no longer identifies the computation. So a real
lockfile, committed, is mandatory — not "nice for CI".

**Turborepo does not manage this tree** (ADR-0001). Whatever is chosen operates independently and
must be trivially installable in CI and in a container without a Node toolchain present.

## Options considered

### Option A — pip with `requirements.txt` per service

**Pros.** Zero new tooling; `pip` ships with Python. Already in use for the one thing that exists
(`requirements-dev.txt` pinning Ruff). Every developer and every base image already understands it.

**Cons.** `requirements.txt` is an install list, not a lockfile — it pins direct dependencies and
lets transitive ones float unless every transitive pin is written out by hand, which nobody
maintains correctly. No dependency resolution across the seven services, so a shared base must be
copy-pasted or chained through `-r ../shared/requirements.txt`, which resolves per-file and can
produce mutually incompatible environments that each install cleanly. No environment management,
so venv creation is a documented ritual rather than a command. Fails the reproducibility constraint
outright.

### Option B — pip-tools (`pip-compile`)

**Pros.** Produces a genuine locked `requirements.txt` from a `.in` file, including transitive
pins with hashes. Output is plain `requirements.txt`, so containers and CI need nothing new.
Small, stable, well understood.

**Cons.** Solves locking and nothing else: no environment management, no notion of a workspace, so
seven services means seven independent compiles with no shared resolution. Cross-service
consistency stays manual — `shared` can end up resolved against a different FastAPI than the
service importing it, which is the exact failure the monorepo exists to prevent. Slow resolution
at this scale. Reasonable if `ai/` were one service; it is seven.

### Option C — Poetry

**Pros.** Mature, widely adopted, real lockfile, manages environments, `pyproject.toml`-native.
Familiar to most Python developers.

**Cons.** No first-class multi-project workspace — sharing a base across seven services means path
dependencies plus a plugin, and the plugin ecosystem for this has been unstable. Historically
idiosyncratic about PEP standards, so `pyproject.toml` written for Poetry is not always portable.
Slow install and resolve, which is felt on every CI run. Adds a second configuration dialect to a
repository whose Python linting is already configured in Astral's format.

### Option D — uv

**Pros.** First-class **workspaces**: one lockfile at the root of `ai/`, per-service
`pyproject.toml` files, and a single resolution pass, so `shared` and every service consuming it
are guaranteed the same versions. This maps exactly onto the seven-directory constraint. A real
`uv.lock` with hashes, committed. Manages environments as well as dependencies, so
"how do I run this" is one command rather than a paragraph in a README. Fast enough that CI install
time stops being a consideration. Drop-in `pip` interface (`uv pip install -r ...`) means existing
`requirements-dev.txt` and any container recipe keep working during the transition. Single static
binary, trivial to install in CI or a Docker layer with no Python bootstrap. Same vendor as Ruff,
which is already the committed linter — one configuration idiom, one upgrade cadence.

**Cons.** **Young and moving fast**, which is the real cost: it is the least battle-tested option
here, and its behavior has changed across minor versions. Mitigated by pinning the uv version
itself in CI, exactly as Ruff is pinned. Concentrates two pieces of critical tooling in one
vendor — if Astral changes direction, both the linter and the dependency manager are affected at
once. Fewer people know it than know Poetry, so it is a small onboarding cost. Workspace support,
while the reason to choose it, is also among its newer features.

### Option E — Do nothing, decide with the first service

**Pros.** The decision would be informed by one real service's actual dependencies rather than
predicted ones.

**Cons.** The first service will be written *some* way, and that way becomes the convention by
default — chosen by whoever typed first, not by anyone weighing it. Retrofitting a lockfile onto
services already running is how the reproducibility guarantee gets quietly dropped. Two ADRs
already list this as blocking follow-up; deferring a third time means it is decided by drift.

## Decision

`ai/` uses **uv** with a workspace: one `uv.lock` and one `pyproject.toml` at `ai/`, a
`pyproject.toml` per service, and the uv version pinned in CI the same way Ruff is.

## Consequences

**Accepted costs.**

- **A young tool in a load-bearing position.** uv's behavior may change across minor versions, so
  the version is pinned and upgraded deliberately, with the lockfile regenerated and reviewed.
- **Vendor concentration.** Ruff and uv are both Astral. A direction change affects lint and
  dependencies simultaneously. Accepted because both are replaceable independently: Ruff's rules
  are config, and uv can export a `requirements.txt`.
- **A second dialect of "workspace"** in one repository — pnpm workspaces for TypeScript, uv
  workspaces for Python. They are conceptually similar and mechanically unrelated, which will
  confuse someone. `docs/development/ai-service-guide.md` must state both explicitly.
- **Fewer developers know it.** Onboarding needs the commands written down rather than assumed.
- Lockfile conflicts on `uv.lock` when two services add dependencies concurrently, resolved by
  regenerating rather than by hand-merging.

**Follow-up work.**

- Create `ai/pyproject.toml` declaring the workspace and its members, plus a `pyproject.toml` per
  service, when the first service is written.
- Move the Ruff pin from `requirements-dev.txt` into the workspace's dev dependency group, and
  delete `requirements-dev.txt` at that point. Until `ai/` has any Python file, the current
  `pip install -r requirements-dev.txt` in CI is simpler and stays.
- Pin the uv version in `.github/workflows/ci.yml` and switch the python job to
  `uv sync --frozen` once a workspace exists.
- Use `uv` in `infra/docker` for the `ai/*` images — the static binary means no Python bootstrap
  layer.
- Document the commands in `docs/development/ai-service-guide.md` and
  `docs/development/getting-started.md`, alongside the pnpm equivalents.
- Add a CI check that `uv.lock` is current (`uv lock --check`), matching the intent of
  `--frozen-lockfile` on the TypeScript side.

**Reversal cost.** Low, and deliberately kept so. `uv export` emits a standard
`requirements.txt`, and `pyproject.toml` is a PEP standard rather than a uv format, so moving to
pip-tools or Poetry means regenerating a lockfile, not rewriting dependency declarations. The
signal to revisit: uv making a breaking change that costs more to absorb than the workspace
resolution is worth, or `ai/` collapsing to a single service, which would remove the only reason
Option B lost.

## Compliance

- **Lockfile committed and current.** `uv.lock` is in version control; CI runs
  `uv lock --check` (or `uv sync --frozen`) and fails when it drifts from the `pyproject.toml`
  files. A resolution that happens at install time is not reproducible.
- **No `pip install` of an unpinned package** in any `ai/` Dockerfile, CI step, or documented
  command. Reviewer check: every install path goes through the lockfile.
- **One workspace, one lock.** A `uv.lock` inside an individual service directory means the
  workspace was bypassed and cross-service version consistency is gone.
- **Version pinning:** the uv version is pinned in CI and in `infra/docker`, like Ruff. An
  unpinned tool version makes the lockfile's guarantee conditional on the machine.
- **Statelessness still applies:** `ruff.toml`'s banned-import list (ADR-0003) is unaffected by
  this decision and remains the check that keeps `ai/` free of a persistent store.

## Related

- ADR-0001 (monorepo — Turborepo does not manage this tree), ADR-0003 (Python for `ai/`),
  ADR-0005 (boundary enforcement, and the Ruff pin this mirrors)
- `.claude/context/tech-stack.md`
- `docs/development/ai-service-guide.md`, `docs/architecture/ai-services.md`
