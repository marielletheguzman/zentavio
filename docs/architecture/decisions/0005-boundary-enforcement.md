# ADR 0005: Boundary enforcement via ESLint flat config and eslint-plugin-boundaries

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** repository root (`eslint.config.mjs`, `package.json`), `infra/ci`, every TypeScript workspace

## Context

ADR-0001 chose a monorepo with **conventional** rather than physical boundaries, and stated the
consequence plainly: "a missing lint rule means a silent architecture violation." ADR-0002's
central claim — adding a source touches only its own folder — is enforceable only if a connector
import outside the registry fails the build. ADR-0003's statelessness requirement for `ai/` has the
same property.

So the layer model in `.claude/skills/architecture/SKILL.md` is currently held up by review alone.
Review catches a reversed import the first few times and then stops catching it, because the
violating import looks locally reasonable — `import { JobPostingRepository } from '../../../services/matching/src/repositories'` is exactly what someone writes when they need that
repository and the layer model is not in front of them.

The constraint that makes this non-obvious: the enforcement must work **before any application
code exists**. If the rules arrive after the first fifty files, they arrive as a migration with
existing violations to grandfather, and grandfathered violations are permanent. The rules are
cheapest to add now and most expensive to add later, which inverts the usual "wait until you need
it" instinct.

A second constraint: the repository is polyglot (ADR-0003). Whatever is chosen for TypeScript
cannot police `ai/`, so the Python side needs its own answer and the gap must be stated rather than
assumed covered.

## Options considered

### Option A — Code review only

**Pros.** Zero tooling, zero dependencies, zero configuration. Nothing to maintain or keep in sync
with the layer model.

**Cons.** Does not survive contact with a real codebase. The violation that matters is the one that
looks locally sensible, and a reviewer holding four files in their head will not notice that the
fourth import crossed a layer. Worse, it fails silently and asymmetrically: the rule holds while
someone is paying attention to it, then quietly stops. ADR-0001's accepted cost was explicitly
predicated on lint rules existing; choosing this option retroactively invalidates that reasoning.

### Option B — TypeScript project references and per-package `tsconfig` paths

**Pros.** No new dependency — the compiler already ships this. A cross-boundary import genuinely
fails to resolve, so enforcement is physical rather than advisory, which is stronger than any lint
rule. Also improves build incrementality.

**Cons.** Cannot express the rules that actually matter here. "Connectors are importable only by
`connectors/core`'s registry" is a rule about *which importer* is allowed, and project references
only express *what is reachable* — `connectors/core` and `services/ingestion` would both need the
reference, so the interesting restriction disappears. Deep relative paths
(`../../../services/...`) sidestep references entirely. And it cannot express "no `process.env`
outside `packages/config`" or "no LLM SDK outside `ai/`" at all, since those are not
package-graph rules. Valuable, but as a complement rather than the mechanism.

### Option C — `eslint-plugin-import-x` with `no-restricted-paths` zones

**Pros.** One plugin already wanted for general import hygiene (ordering, no cycles, no unresolved).
Zone syntax is straightforward for simple "A must not import B" pairs.

**Cons.** Zones are expressed as path-glob pairs, so an N-layer model becomes O(N²) rules, each
restated per direction. The layer model has seven element kinds; the rule set would be large,
repetitive, and — the real problem — its *intent* would not be readable. A reviewer could not look
at the config and reconstruct the architecture. Error messages are path-based, so a violation reads
as "this glob is not allowed from that glob" rather than naming the layers involved.

### Option D — `eslint-plugin-boundaries`

**Pros.** Models exactly this problem: declare element **types** by path pattern, then declare
which types may depend on which. The config becomes a readable statement of the architecture — one
`elements` block plus one `rules` block that mirrors the layer model, so the config and
`.claude/skills/architecture/SKILL.md` can be checked against each other by eye. Supports the
importer-specific rule ADR-0002 needs (`connector` importable only from `connector-core`), which
Option C expresses badly and Option B not at all. Custom messages, so a violation explains the
layer rule and cites the ADR. Composes with `no-restricted-imports` for the non-graph rules
(`process.env`, LLM SDKs).

**Cons.** A new dependency, and one that must stay in sync with the layer model — a stale
`elements` block silently stops matching new directories, which is a failure that looks like
success. Path-pattern based, so a directory rename outside the patterns goes unpoliced. Adds
setup and a lint step to CI. And it cannot see `ai/` at all.

### Option E — Do nothing for now, add rules when the first violation appears

**Pros.** No work now, and the rules would be informed by real violations rather than predicted
ones.

**Cons.** "When the first violation appears" is after it is merged, which is after it is depended
upon. The first violation is also the cheapest possible moment to be *prevented* rather than
diagnosed. And rules added to a codebase with existing violations get an ignore list, which is how
architecture rules become decorative.

## Decision

Boundary rules are enforced by ESLint flat config at the repository root using
`eslint-plugin-boundaries` for the layer model, `eslint-plugin-import-x` for import hygiene, and
`no-restricted-imports`/`no-restricted-syntax` for the non-graph rules; the Python tree under `ai/`
is policed separately by Ruff, and the split is documented rather than assumed covered.

## Consequences

**Accepted costs.**

- Three new devDependencies at the root (`eslint`, `eslint-plugin-boundaries`,
  `eslint-plugin-import-x`, plus the TypeScript parser). Justified by this ADR; they are tooling,
  not runtime.
- **The `elements` block must track the directory structure.** A new top-level directory that no
  pattern matches is unpoliced, and nothing fails — the most likely way this decision decays.
  Mitigated by a catch-all rule that rejects unmatched files.
- Enforcement is advisory rather than physical: a determined author can add an
  `eslint-disable`. Disables are therefore a review concern, and a boundary disable should
  require an ADR.
- `ai/` is not covered by any of this. Ruff covers the statelessness ban; the
  language boundary itself is enforced by the fact that Python cannot resolve TypeScript modules,
  which is enforcement by accident rather than by rule.
- A lint step is now on the critical path of every commit and every CI run.

**Follow-up work.**

- Add TypeScript project references as a complement (Option B), so the strongest rules are
  physically enforced as well as linted.
- ~~Add the CI lint job, non-skippable.~~ **Done** — `.github/workflows/ci.yml`, with the
  reusable toolchain step in `infra/ci/actions/setup-node-pnpm/`. Workflow files must live in
  `.github/workflows/` (a GitHub constraint), so `infra/ci` holds the composite actions they
  call; the split is documented in `infra/ci/README.md` and `docs/development/ci-cd.md`.
  Branch protection points at the single aggregating `ci` job, so a new job becomes blocking
  without a settings change.
- Pin third-party actions to commit SHAs rather than major tags. A tag pin trusts the publisher
  continuously rather than once.
- Add a check that every top-level TypeScript directory matches a `boundaries/elements` pattern, so
  a new directory cannot silently escape the rules.
- Extend Ruff config as `ai/` grows — particularly the ban on persistence libraries that enforces
  ADR-0003 statelessness.
- Revisit the `no-restricted-syntax` `process.env` rule once `packages/config` exists, to confirm
  the allowlist path is exactly right.

**Reversal cost.** Trivial. Deleting `eslint.config.mjs` removes the enforcement, and no
application code depends on it. That asymmetry — near-zero cost to add now, near-zero cost to
remove, high cost to add later — is the whole argument for doing it before the first service is
written.

## Compliance

- **The config is the compliance.** `eslint.config.mjs` at the repository root is the executable
  form of the layer model; CI runs `pnpm lint` and fails on any violation.
- **Config-vs-doc check:** a reviewer compares the `boundaries/element-types` rule block against
  the layer table in `.claude/skills/architecture/SKILL.md`. They must state the same thing. If
  they diverge, one of them is a bug.
- **Catch-all rule:** `boundaries/no-unknown-files` fails on any TypeScript file matching no
  element type, so new directories cannot escape unnoticed.
- **Disable audit:** `grep -rn "eslint-disable.*boundaries"` must return nothing. Any hit needs an
  ADR justifying it.
- **Ruff:** `ruff check ai/` runs in CI and enforces the `ai/` statelessness bans. Pinned in
  `requirements-dev.txt` — a different Ruff version is a different rule set.

## Implementation notes

Two behaviors of `eslint-plugin-boundaries` were found while verifying the rules fire, both of
which fail quietly and are worth recording:

1. **It resolves dependencies through the legacy `settings['import/resolver']` key**, not
   `import-x/resolver`. With only the `import-x` key set, extensionless TypeScript imports do not
   resolve and every cross-layer violation degrades from the specific layer message to
   `boundaries/no-unknown` ("Importing unknown elements is not allowed"). The build still fails,
   so the wall holds — but the error stops naming which boundary was crossed, which is most of
   the value. `eslint.config.mjs` sets both keys.
2. **A custom `message` on an `allow` entry is never displayed.** Only `disallow` entries carry
   custom text; violations of an `allow` list fall through to the rule's top-level `message`.
   The config therefore states each layer's permissions as `allow` entries and repeats the
   important prohibitions as `disallow` entries whose messages cite the ADR they break.

Verification method: probe files were written to violate each rule, `pnpm lint` was confirmed to
report the intended message for each, then legal imports across the same boundaries were
confirmed to pass, and the probes were deleted. A rule set that has never been shown to fail is
not known to work.

## Related

- ADR-0001 (monorepo — the accepted cost this discharges), ADR-0002 (connector registry rule),
  ADR-0003 (polyglot boundary and `ai/` statelessness)
- `.claude/skills/architecture/SKILL.md` — the layer model this encodes
- `eslint.config.mjs`, `ruff.toml`
- `docs/development/conventions.md`
