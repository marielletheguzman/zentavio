# ADR 0011: CI required checks and merge enforcement

- **Status:** **Proposed** — awaiting acceptance
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** GitHub branch protection on `main`, `.github/workflows/ci.yml`, `docs/development/branching.md`

## Context

CI exists and runs on every push and pull request. **No status check is required**, so nothing physically
prevents merging a red run into `main`.

That makes every rule that depends on CI advisory. ADR-0005 chose conventional boundaries over physical
ones, accepting the cost on the explicit basis that lint rules would catch violations — but a lint rule that
runs and is ignored is not enforcement, it is a report. The same applies to `tsc`, the boundary-disable
audit, the Ruff statelessness bans, and the offline eval checks.

**Verified state, since this ADR is about not overstating enforcement:** the workflow file exists and its
YAML parses; `pnpm lint:all` passes locally; **no CI run has been observed**, because `gh` is
unauthenticated in the environment where this was written. So "CI works" is currently an inference from
valid configuration and passing local commands, not an observation.

Two further constraints:

**The aggregating `ci` job already exists** for exactly this purpose — `typescript` and `python` feed a job
named `ci` that fails if either failed. Branch protection can therefore point at one check, and adding a
future job makes it blocking without a settings change.

**Branch protection is repository configuration, not code.** It cannot be committed, reviewed, or diffed.
Whatever is chosen has to be written down somewhere, or it becomes invisible state that nobody can audit.

## Options considered

### Option A — Require the aggregating `ci` check on `main`

Branch protection: require pull requests, require the `ci` status check to pass, no direct pushes.

**Advantages.** One check to configure, and it already aggregates everything. A red run becomes unmergeable
by mechanism rather than by attention, which is what ADR-0005's accepted cost assumed. Adding a job later
requires no settings change. Cheap: a few minutes of configuration, zero maintenance, zero cost.

**Disadvantages.** A broken `main` blocks everyone until fixed — correct, but it will be felt. Requires
pull requests, which for a single contributor adds a step to changes that currently go straight to `main`.
And the protection lives in repository settings, so it is invisible to anyone reading the repository unless
documented.

### Option B — Require each job individually (`typescript`, `python`)

**Advantages.** Slightly more legible in the GitHub UI: a reviewer sees which half failed without opening
the run.

**Disadvantages.** Every new job needs a branch-protection edit, and the edit is easy to forget — so a new
check silently does not block, which is worse than no check because it looks covered. The aggregating job
was built specifically to avoid this. Loses on maintenance for a marginal display benefit.

### Option C — Require checks, and also require review approval

**Advantages.** Catches what CI cannot: an invented fact, a missing unknown path, a doc that now lies. Those
are the failures `contributing.md` says to block on, and none of them are machine-detectable.

**Disadvantages.** With one contributor, self-approval is either impossible (blocking all work) or
meaningless (a rubber stamp). It becomes correct the moment there is a second contributor, and pretending
otherwise now would make the rule theatre.

### Option D — Leave it unprotected, rely on discipline

**Advantages.** No friction. Honest about a single-contributor repository where the contributor is the one
running the checks anyway.

**Disadvantages.** Every boundary rule, type check, and eval check becomes advisory, and ADR-0005's central
claim — that the layer model is enforced rather than preferred — becomes false. It is also the option most
likely to be discovered wrong at the worst time: a boundary violation merged during a rush, then depended
upon.

## Decision

**Recommended: Option A now; add review approval (Option C) when a second contributor joins.**

Concretely, on `main`:

- Require a pull request before merging.
- Require the status check named **`ci`** to pass.
- Require branches to be up to date before merging.
- Do not allow force pushes or deletions.
- Do not exempt administrators — an exemption is how the rule gets bypassed on the day it matters most.
- Squash merge only.

**Precondition — one CI run must be observed green before this is switched on.** Requiring a check that has
never passed would block all work on an unverified assumption, which is the same class of error as
documenting a gate that does not exist. Verify first, then enforce.

## Consequences

**Accepted costs.**

- Every change goes through a pull request, including a one-line documentation fix. That is the point, and
  it is friction.
- A broken `main` blocks merging until fixed. Reverting is preferred over hotfixing
  (`docs/development/branching.md`).
- Branch protection is invisible repository configuration. Mitigated by documenting the exact settings here
  and in `branching.md`, so the intended state is auditable even though the actual state is not diffable.
- Administrators are not exempt, so an emergency fix still needs a green run. Accepted deliberately.
- Not covered by any check: an invented fact, a missing unknown path, a stale doc. Those need review, which
  is Option C, which needs a second person.

**Follow-up work.**

- **Observe one green `ci` run.** Blocked on `gh` authentication or a manual look at the Actions tab.
- Configure branch protection with the settings above.
- Verify by attempting a merge with a deliberately failing check, and confirming it is refused — a setting
  that has not been tested is a claim, not a control.
- Update `docs/development/branching.md` to remove the "current gap" section once true.
- Add a `CODEOWNERS` file and enable required review when a second contributor joins.

**Reversal cost.** Trivial — a settings change. Which is also why it is easy to leave undone, and why it is
an ADR rather than a task: the decision is worth recording even though the action is small.

## Compliance

- **Verified by attempting to violate it:** open a pull request with a deliberately failing check and
  confirm the merge button is disabled. Until that has been done, the correct statement is "branch
  protection is configured", not "merge enforcement is verified".
- The required check is named `ci` and matches the aggregating job in `.github/workflows/ci.yml`.
- `docs/development/branching.md` states the configured settings, so intended and actual can be compared.
- Administrator exemption stays off — checkable in settings.
- No claim of merge enforcement appears anywhere until the violation test has been run
  (`.claude/context/decision-gate.md`).

## Related

- ADR-0005 — the accepted cost this discharges
- `docs/development/branching.md`, `docs/development/ci-cd.md`
- `.github/workflows/ci.yml` — the `ci` aggregating job
