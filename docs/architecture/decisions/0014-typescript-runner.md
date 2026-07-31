# ADR-0014: How TypeScript entrypoints are executed outside Vitest

- **Status:** Proposed
- **Date:** 2026-07-31
- **Deciders:** project lead
- **Affects:** `package.json` (`engines`, scripts), `tsconfig.base.json`, `packages/db` (the missing
  `migrate` command), every future CLI, seed script, and one-off maintenance task

## Context

`packages/db` exports `applyMigrations`, and the integration suite calls it. There is still **no
`migrate` command**, so migrations can only be applied programmatically from inside a test run. That is
backwards: the migration runner is production machinery, and its only entrypoint is a test harness.

Nothing is broken. Vitest transpiles TypeScript before executing it, so every test resolves fine. The gap
appears the moment something must run *outside* Vitest.

**Verified, since this ADR turns on what is actually true rather than what is assumed:**

```text
$ node packages/db/src/index.ts
node:internal/modules/esm/resolve:274
    throw new ERR_MODULE_NOT_FOUND
```

The cause is specific, and it is **not** that Node cannot execute TypeScript. Node v22.21.0 is installed and
strips types natively — `node /tmp/strip.ts` on a file containing `const x: number = 41` prints `42`. What
fails is **module resolution**: this repository writes relative imports with `.js` extensions
(`export { createDb } from './client.js'`) while the files on disk are `.ts`. Node resolves `./client.js`
literally, finds nothing, and stops. Type stripping never rewrites specifiers.

That style is not an accident — it is what `moduleResolution: "Bundler"` and `verbatimModuleSyntax` in
`tsconfig.base.json` were set up to produce, and it is the conventional emit-correct form for NodeNext.

So the real question is narrower than "which runner": **the repository must either change how it writes
import specifiers, or bring in a tool that rewrites them at run time.** `.claude/context/tech-stack.md`
names no runner, and a dependency cannot be added without an ADR — which is this one.

Two constraints shape the answer:

**The `engines` floor is `node >=20.11.0`.** Native type stripping needs Node 22.18 or later, so the
zero-dependency route is only available if that floor moves.

**Type stripping does not type-check.** It erases annotations and runs the result. Whatever is chosen,
`tsc --noEmit` in CI stays the thing that decides whether the types are right — a runner that executes a
type error without complaint is not a regression, it is a division of labour, but only if CI is actually
holding the other half. It is: the `CI` check has been required on `main` since 2026-07-31 (ADR-0011).

## Options considered

### Option A — Node's native type stripping, with `.ts` import specifiers

Move the `engines` floor to `>=22.18.0`, rewrite relative specifiers from `./client.js` to `./client.ts`,
and set `allowImportingTsExtensions` with `rewriteRelativeImportExtensions` (TypeScript 5.7+; 5.9.3 is
installed). `node packages/db/src/migrate.ts` then runs directly.

**Verified to work** before this ADR was written: a `.ts` file importing `./dep.ts` executed under Node
v22.21.0 and printed the imported value.

**Advantages.** No new dependency, so nothing is added to the stack and no supply-chain surface grows —
which is the whole reason `tech-stack.md` requires an ADR. One execution model for every future CLI. It is
also the direction the ecosystem is moving, so this is unlikely to need revisiting.

**Disadvantages.** It touches **every relative import in the repository**, not just `packages/db` — a large,
mechanical, entirely reviewable diff, but a large one. It raises the Node floor, which is a real constraint
on contributors and on any deployment target pinned below 22.18. And it permanently restricts the codebase
to **erasable syntax only**: no `enum`, no `namespace`, no constructor parameter properties. The tree is
already clean on that point (checked), and `erasableSyntaxOnly: true` makes the restriction enforced rather
than remembered — but it is a real, permanent narrowing of the language.

Node also emits a `MODULE_TYPELESS_PACKAGE_JSON` warning for files whose nearest `package.json` lacks
`"type": "module"`; every package here sets it, so this is a non-issue in-tree and a papercut for loose
scripts.

### Option B — `tsx`

Add `tsx` as a dev dependency; run `tsx packages/db/src/migrate.ts`.

**Advantages.** Changes nothing about how the repository is written — `.js` specifiers keep working,
because `tsx` resolves them to `.ts`. Smallest possible diff: one dependency, one script. Keeps the Node
floor at 20.11. No restriction on TypeScript syntax.

**Disadvantages.** A dependency whose entire job is to paper over a specifier convention this repository
chose. It is esbuild-based, so it also does not type-check — the same division of labour as Option A, but
paid for with a dependency instead of a migration. And it is a *permanent* runtime dependency for
operational commands: migrations would be applied through a third-party loader.

### Option C — `vite-node`

Same shape as Option B, via Vite's module runner.

**Advantages.** Vitest is already in the stack (ADR-0007) and is built on Vite, so the transform pipeline
is one the repository already trusts and already ships.

**Disadvantages.** Heavier than `tsx` for the actual task, and it pulls Vite's resolution semantics into
production operations, where the goal is the fewest moving parts between a migration and the database.
Sharing machinery with the test runner sounds like a saving but couples an operational path to test
tooling.

### Option D — A real build step

Emit JavaScript with `tsc`, run `node dist/migrate.js`.

**Advantages.** No new dependency and no runner at all. What runs in production is exactly what was
type-checked, which is the strongest correctness story of any option here.

**Disadvantages.** Introduces a build artifact, a build step before every local migration, and the
stale-`dist` failure mode — where the thing that ran is not the thing that was edited. `tsconfig.json` is
`noEmit: true` today; undoing that pulls in output layout, `.gitignore`, and eventually project references.
Heavy for running one script, and it front-loads work the roadmap has explicitly deferred.

### Option E — Do nothing

Keep applying migrations programmatically from the integration suite.

**Advantages.** Zero cost today. Honest about a repository with one contributor and no deployment.

**Disadvantages.** The only way to apply a migration is to run a test, so the moment there is any database
that is not local and disposable, there is no supported way to migrate it. It also blocks every future
operational script — seeds, backfills, one-off repairs — behind the same wall, so the cost is paid again
each time. `packages/db/README.md` already names this a gap; leaving it named does not make it smaller.

## Decision

**Not yet decided — this ADR is Proposed.** Choosing a runner is a stack change, and
`.claude/context/tech-stack.md` makes that the project lead's call, not an implementation detail to be
settled while writing a `migrate` command.

**The recommendation is Option A**, for one reason that outweighs its larger diff: every other option
either adds a permanent dependency to the operational path (B, C), adds a build artifact and a staleness
failure mode (D), or leaves migrations reachable only through a test runner (E). Option A's costs are paid
once, mechanically, and leave the repository with fewer moving parts than it has now.

The honest counterargument is that Option B is one line and reversible in an afternoon, while Option A
touches every file and raises the Node floor. If the priority is reaching M1 quickly rather than keeping
the stack minimal, Option B is the defensible choice, and this ADR should record that reasoning rather than
pretend it lost on the merits.

## Consequences

*Written against the recommendation (Option A). If another option is chosen, this section is rewritten
before the ADR is Accepted.*

**Accepted costs.**

- Every relative import in the TypeScript tree changes extension. Mechanical and reviewable, but it is the
  largest diff in the repository's history so far and will conflict with anything in flight.
- The `engines` floor moves from `>=20.11.0` to `>=22.18.0`. Anyone on Node 20 or 21 must upgrade, and any
  deployment target pinned below 22.18 is excluded.
- `enum`, `namespace`, and constructor parameter properties become permanently unavailable. `.claude` skills
  and templates that show them would need correcting.
- Running a script no longer type-checks it. `tsc --noEmit` in CI is the only thing standing between a type
  error and a migration that runs — acceptable only because the `CI` check is required on `main`.

**Follow-up work.**

- Rewrite relative specifiers to `.ts`; set `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`,
  and `erasableSyntaxOnly` in `tsconfig.base.json`.
- Raise `engines.node`, and pin the same major in `.github/workflows/ci.yml` (currently `node-version: '22'`)
  and `infra/ci/actions/setup-node-pnpm`.
- Write the actual `migrate` command in `packages/db`, with a dry-run mode — the point of the exercise.
- Update `packages/db/README.md`, which currently documents this gap, and `.claude/context/tech-stack.md`,
  which names no runner.
- Add an ESLint rule or a check that rejects a relative import ending in `.js`, so the convention does not
  drift back one file at a time.

**Reversal cost.** Moderate and bounded. Reverting to Option B means adding `tsx` and rewriting specifiers
back — the same mechanical diff in reverse, plus a dependency. Nothing is one-way; the cost is a day, not a
redesign.

## Compliance

- **Verified by attempting to violate it:** a relative import written as `./foo.js` must fail the build.
  Until that lint rule exists and has been shown to reject, the correct statement is "the convention is
  documented", not "the convention is enforced" (`.claude/context/decision-gate.md`).
- `node packages/db/src/migrate.ts --dry-run` runs without a loader flag, from a clean checkout, on the
  Node version in `engines`.
- `erasableSyntaxOnly: true` in `tsconfig.base.json` makes the syntax restriction a compile error rather
  than a convention, and `tsc --noEmit` runs in CI.
- `engines.node`, the CI `node-version`, and the version this was verified against agree. A drift between
  them is how "works on my machine" gets committed.

## Related

- ADR-0007 — Vitest, which is why nothing has needed a runner until now
- ADR-0012 — the database access layer whose `migrate` command this unblocks
- ADR-0011 — the required `CI` check that `tsc --noEmit` runs under, which this decision leans on
- `packages/db/README.md` — "The remaining gap"
- `.claude/context/tech-stack.md` — the fixed stack this would change
