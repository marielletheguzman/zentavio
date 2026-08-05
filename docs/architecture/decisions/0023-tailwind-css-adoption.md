# ADR-0023: Tailwind CSS v4, with `packages/ui/src/tokens.css` as its theme source

- **Status:** Accepted
- **Accepted:** 2026-08-05
- **Date:** 2026-08-05
- **Deciders:** project lead
- **Affects:** `packages/ui`, `apps/web`, `apps/admin`, `apps/mobile`,
  `.claude/context/tech-stack.md`, `.claude/context/ui-guidelines.md`,
  `.claude/skills/frontend/SKILL.md`, `eslint.config.mjs`

## Context

`packages/ui`'s purpose line — binding under CLAUDE.md — says **"Shared React component library
(shadcn base)."** The package currently ships one thing: `src/tokens.css`, a 104-line token layer
with a single export path. Its README states the gap plainly:

> shadcn is a Tailwind component library. Tailwind is a framework, and CLAUDE.md is unambiguous:
> nothing new enters the stack without an ADR.

`.claude/context/tech-stack.md` already lists Tailwind as **"approved for styling, not yet
installed"** and adds *"Being listed here permits it; it does not mean it is there."* So the tension
is not whether Tailwind is allowed in principle. It is that **no component primitive can be written
until the styling mechanism is chosen**, and three surfaces are now waiting on that.

**What exists today.** `apps/web/app/globals.css` is 548 lines of hand-written CSS styling `/`,
`/gap`, and `/eligibility` against the tokens. It works, it is WCAG 2.1 AA in both themes, and it
was browser-verified at 1310px and 318px (`451e8cd`). It is also a **single global stylesheet with
no scoping mechanism**, which is the thing that stops scaling: the design pass found that
`p { margin: 0 }` placed after `main > * + *` silently killed every paragraph's spacing at equal
specificity. That class of bug is what a global cascade produces, and it gets worse per surface
added, not per line added.

**What makes the choice non-obvious.** The token layer is not incidental — it is where two product
rules are enforced:

1. **Meaning never rests on hue.** `--shape-certain` / `--shape-uncertain` exist so low confidence
   renders as a different *shape*. `ui-guidelines.md` calls a paler-tint version a **correctness
   bug**, not a styling preference.
2. **Nothing off-scale.** A 4px spacing scale, a seven-step type scale, three radii, one shadow.

Any styling mechanism that ships **its own** scale alongside ours creates a second vocabulary for
the same concepts, and any mechanism that makes arbitrary values cheap to write makes rule 2
unenforceable. Tailwind's stock configuration does both — a default palette, a default spacing
scale, and `p-[13px]` arbitrary-value syntax. That is the real risk here, and it is a configuration
problem, not a reason to reject the tool.

**The stack context.** `apps/web` is Next.js 15.5.4 / React 19.2.0. Tailwind v4 configures in CSS
via `@theme` rather than a `tailwind.config.js`, which is what makes the token question answerable
rather than a fork. `.claude/context/tech-stack.md` lists **"a second CSS framework"** under
*Deliberately not in the stack* — so this decision is also the decision that there is exactly one.

## Options considered

### A. Vanilla CSS — do nothing, keep hand-writing global stylesheets

Continue as `globals.css` does today. Write component primitives as plain CSS classes.

**Pros.** Zero new dependencies, zero build-pipeline change, and it demonstrably works — every
current surface is styled, accessible, and verified this way. The tokens stay a plain `@import`
that any consumer can read with no tooling at all. It is also the only option that requires no ADR,
which is worth something.

**Cons.** It **cannot satisfy `packages/ui`'s purpose line**, which names shadcn specifically, so
choosing it means amending that contract rather than meeting it. It has no scoping: every class
name is global across every surface, and the `p { margin: 0 }` incident is what that costs at 548
lines — the failure mode is silent and does not show in a screenshot. It has no dead-code story
either; a class stops being used and nothing says so. And 548 lines for three surfaces extrapolates
badly across `apps/admin` and `apps/mobile`, which have not started.

### B. CSS Modules only — scoped stylesheets, no framework

`Component.module.css` beside each component, class names hashed at build time, values read from
`tokens.css` variables.

**Pros.** Solves the one thing vanilla CSS cannot: **scoping is structural**, so the equal-specificity
class of bug is gone by construction. Next.js supports it natively with no new dependency and no
postcss config. It composes cleanly with the token layer — a module file is ordinary CSS reading
ordinary custom properties, so `tokens.css` stays exactly what it is. Dead styles are at least
findable, because a module file is owned by one component.

**Cons.** It **still does not satisfy the purpose line** — shadcn components are Tailwind markup, so
adopting shadcn later would mean either rewriting every component or running both mechanisms, and
the second is the "second CSS framework" the stack forbids. It is the option that **defers the same
decision** rather than making it: primitives written as modules are the migration cost paid twice if
shadcn is ever adopted. It also gives no help on the two product rules — nothing stops a module
writing `color: #b91c1c` and `padding: 13px`, so enforcement stays entirely on review.

### C. Tailwind CSS v4, with `tokens.css` as the theme source, shadcn on top

Install Tailwind v4. `packages/ui/src/tokens.css` gains a `@theme` block so **the utility set is
generated from our tokens** — `bg-surface`, `p-4`, `text-lg` resolve to `--color-surface`,
`--space-4`, `--text-lg`. Tailwind's stock palette and stock spacing scale are **disabled**, not
merely unused. shadcn components are then vendored into `packages/ui/src/components/`.

**Pros.** It is the only option that **meets the purpose line as written**. The token layer becomes
*more* load-bearing rather than being bypassed: a colour that is not a token has no utility class,
so rule 1 moves from review discipline into the build. Utilities are scoped by being atomic — there
is no cascade to break. shadcn is **copy-in, not a runtime dependency**: components land in our tree
as ordinary React and are ours to edit, which matters because several will need the
`--shape-uncertain` treatment that no upstream component has. Both other apps inherit one vocabulary
instead of re-deriving it.

**Cons.** **A build-pipeline change.** `@tailwindcss/postcss` and a postcss config enter `apps/web`,
and `tokens.css` stops being consumable as plain CSS by anything that does not run Tailwind — today
it is a bare `@import` with no tooling, and that property is genuinely lost. **The arbitrary-value
escape hatch exists** (`p-[13px]`, `text-[#b91c1c]`), so rule 2 needs a lint rule or it is worse
than today, where writing an off-scale value at least looks deliberate. **Utility classes are
verbose in JSX** and reviewers read markup with styling interleaved, which is a real readability
cost several people find disqualifying on its own. And **shadcn brings transitive dependencies** —
Radix UI primitives, `class-variance-authority`, `clsx`, `tailwind-merge` — which arrive one
component at a time and are easy to accept without noticing; Radix in particular is a substantial
behavioural dependency that this ADR does **not** approve wholesale.

### D. Tailwind *without* shadcn

Adopt the utility layer, write primitives by hand against it.

**Pros.** All of C's token enforcement with none of the Radix dependency surface.

**Cons.** It rejects the accessibility work that is the actual reason shadcn is in the purpose line.
`ui-guidelines.md` puts WCAG 2.1 AA as the floor and demands keyboard paths, focus rings, and
`aria-live` announcements; a hand-written dialog, combobox, or disclosure gets those wrong in ways
that only a user finds. Kept as the **fallback position if a specific Radix primitive is rejected on
review** — the two are separable, which is the point of listing this separately.

## Decision

**Option C.** Adopt **Tailwind CSS v4** as the single styling mechanism, with
`packages/ui/src/tokens.css` as its **theme source via `@theme`**, and vendor shadcn components into
`packages/ui` on top of it — one at a time, under the boundary stated below.

The deciding argument is **where the design rules end up living**. The two rules that carry this
product's credibility — confidence is a shape not a tint, and nothing is off-scale — are today
enforced by review and by a README. Options A and B leave them there. Option C makes the token layer
generate the vocabulary, so an off-token colour has no class to write. That converts a documentation
promise into a build-time fact, which is the same move ADR-0021 made when it put archival
enforcement in `services/ingestion` rather than in a comment.

**Tailwind's own design system is disabled, not inherited.** `@theme` replaces rather than extends:
no stock palette, no stock spacing scale, no stock type scale. If `bg-red-500` resolves to anything,
the configuration is wrong and the compliance check below fails.

### Ownership hierarchy

**Design tokens remain the canonical design system. Tailwind is an implementation layer generated
from those tokens.** The dependency direction is one-way:

1. **`packages/ui/src/tokens.css`** — the canonical design system.
2. **Tailwind** consumes those tokens through `@theme`.
3. **Component libraries**, shadcn included, consume Tailwind and the tokens.
4. **No layer may redefine the layer above it.**

Changes to colour, spacing, typography, radii, shadow, sizing, or any other design primitive
**originate in `packages/ui/src/tokens.css`**. Tailwind configuration and utility classes must never
become the authoritative source for a design decision — a utility exists because a token exists, and
never the other way round.

Three consequences follow, and they are the binding part of this ADR:

- **A design value that is not in `tokens.css` has no utility class.** Adding one via a Tailwind
  config override is a defect, not a shortcut, because it puts a design value outside the file
  `.claude/context/ui-guidelines.md` points at.
- **Tailwind is replaceable; the tokens are not.** If this decision is reversed, `tokens.css`
  survives unchanged — which is the property the rollback section depends on.
- **`@theme` exposes tokens, it does not define them.** The block contains mappings, not values.

### What accepting this ADR does and does not approve

**Approved by acceptance:**

- Tailwind CSS v4 enters the stack as the **single** styling mechanism.
- `packages/ui/src/tokens.css` is its `@theme` source, with Tailwind's own scales disabled.
- The phase 1–3 work below — install, `@theme`, lint rule, surface migration.

**Not approved by acceptance, and each needs its own review:**

- **shadcn.** Acceptance approves the *vendoring pattern* — components copied into
  `packages/ui/src/components/` as ordinary reviewable code — and nothing more. **No component is
  approved, and no component may be vendored, until a PR proposes that specific one.**
- **Radix, `class-variance-authority`, `clsx`, `tailwind-merge`,** or any other package a component
  pulls in. Each is approved in the PR that first needs it. A component whose Radix primitive is
  rejected falls back to **Option D** for that one component, and Option D remains a standing
  position rather than a discarded alternative.
- **Any installation at all.** This ADR installs nothing; it authorises the follow-up work below.

**Tailwind adoption and component-library adoption are therefore separable decisions**, and this one
settles only the first. Rejecting shadcn later does not reopen Tailwind.

## Consequences

**Accepted costs.**

- **`tokens.css` stops being framework-free.** Today `@import '@zentavio/ui/tokens.css'` works in any
  context that understands CSS. After `@theme`, consuming it fully requires Tailwind. The raw custom
  properties still resolve for anything reading them directly, but the package acquires a build
  dependency it does not have today.
- **`apps/web` gains a postcss config and a build step it currently does without.** Next.js styles
  plain CSS with no configuration at all right now; that ends.
- **The arbitrary-value syntax is a permanent hole in the off-scale rule** unless linted. It is
  cheaper to write `p-[13px]` than to write the equivalent off-scale value today.
- **Markup gets noisier.** Styling moves into JSX class strings. Diffs of a component change become
  harder to read, and `.claude/skills/frontend/SKILL.md`'s review guidance needs to say what an
  acceptable class string looks like.
- **`globals.css` becomes a migration, not a rewrite.** 548 working, verified lines exist. They are
  not thrown away in one commit — see the strategy below.
- **A dependency surface arrives incrementally.** Radix, `clsx`, `cva`, `tailwind-merge`. Each is
  small; the aggregate is not, and it enters one component at a time, which is exactly how a stack
  grows without anyone deciding to grow it.

**Follow-up work.**

1. **Install Tailwind v4 in `apps/web`** — `@tailwindcss/postcss`, a postcss config, and
   `@import "tailwindcss"` in `globals.css`. Pin the exact version at install time; `v4` here names
   the CSS-first configuration model, not a resolved version.
2. **Add `@theme` to `packages/ui/src/tokens.css`**, mapping the existing custom properties to
   Tailwind's namespaces (`--color-*`, `--spacing-*`, `--text-*`, `--radius-*`, `--shadow-*`) and
   **disabling the stock scales**. The token values themselves do not change — this is a second
   export of the same numbers, not a new source of truth.
3. **Add the arbitrary-value lint rule** before the first primitive lands, not after.
4. **`packages/ui` gains a second export path** (`./components/*`). Its README says a second export
   is the signal this question needs answering — that signal is now spent, and the README must be
   rewritten to say so rather than left contradicting the tree.
5. **Migrate `globals.css` surface by surface**, verified in a browser at 1310px and 318px in both
   themes, matching the standard `451e8cd` set.
6. **Update `.claude/context/tech-stack.md`** — Tailwind moves from *approved but not installed* to
   installed, and the "second CSS framework" line gains the note that this is the first.
7. **Update `.claude/skills/frontend/SKILL.md`** with the utility-class review rules.
8. **First vendored component decides the Radix question in the concrete** — pick one that needs a
   Radix primitive, so the dependency review happens on a real case rather than in the abstract.

**Reversal cost.** **Moderate before the first shadcn component, high after.** Removing Tailwind
while only `@theme` and utility classes exist means rewriting class strings back into CSS — tedious,
mechanical, and bounded. After components are vendored, reversal means rewriting components that
were *copied in rather than authored*, so the work is not "undo a change" but "write from scratch
what was never written". **The signal to reverse** is the arbitrary-value rule proving unenforceable
in practice — if off-scale utilities keep landing despite lint, the token layer has become
decoration and Option B's structural scoping is the better trade.

## Migration strategy

Sequenced so that **every step leaves the tree shipping and verified**, and so the reversible steps
come before the expensive one.

| Phase | What lands | Reversible? |
|---|---|---|
| 1 | Tailwind installed, `@theme` added, stock scales disabled, lint rule added. **No markup changes.** A test asserts `bg-red-500` produces nothing. | Yes — delete the config |
| 2 | One surface (`/eligibility`, the smallest) migrated to utilities. `globals.css` keeps the other two. | Yes — revert one file |
| 3 | Remaining surfaces migrated. `globals.css` reduced to resets and true page-level layout. | Yes, tediously |
| 4 | **First shadcn component vendored**, with its Radix dependency reviewed in that PR. | This is the ratchet |
| 5 | Primitives replace bespoke markup as surfaces need them. Never a big-bang rewrite. | No |

**Phases 1–3 need no new runtime dependency beyond Tailwind itself.** The decision that is hard to
undo is phase 4, and it is deliberately last.

**Both themes and both breakpoints are re-verified at every phase that touches markup.** The design
pass recorded that screenshots did not catch the spacing regression and `getComputedStyle` did —
**measure spacing, do not eyeball it**, and that applies to each migrated surface.

## How Tailwind integrates with `packages/ui`

`packages/ui` stays the **single source of design truth** and gains a second responsibility.

```
packages/ui/
  src/
    tokens.css          # values + @theme — the vocabulary Tailwind generates from
    components/         # vendored shadcn, edited to Zentavio's rules
```

`apps/*` import both. **No app defines a token, and no app configures Tailwind's theme** — the
`@theme` block exists in exactly one file, so a third app cannot quietly acquire a fourth radius.
`tech-stack.md`'s existing instruction holds unchanged: *"Extend it; do not fork tokens or
primitives per app."*

## Relationship with design tokens

**The tokens are upstream of Tailwind, not derived from it.** This is the load-bearing part of the
decision:

- `--space-4: 1rem` already exists. `@theme` exposes it so `p-4` compiles to it.
- Tailwind's stock `--color-red-500` and its stock spacing scale are **removed**, so there is no
  second vocabulary and no way to write a colour the design system never defined.
- A new design value is added to `tokens.css` and becomes available as a utility. It is **never**
  added as a Tailwind config override, because that would put a design value outside the file
  `ui-guidelines.md` points at.
- `--shape-certain` / `--shape-uncertain` stay what they are — **border and shape** tokens, not
  colours. Utilities generated from them must not be interchangeable with colour utilities, because
  the whole point is that confidence is not expressed as a tint.

## Relationship with shadcn/ui

shadcn is **not a dependency**. Its CLI copies component source into the repository, where it
becomes ordinary code under review. That distinction drives three rules:

1. **Vendored components are edited to Zentavio's rules on arrival**, not wrapped. Upstream has no
   concept of `--shape-uncertain`, and a badge that renders low confidence as a lighter tint is a
   correctness bug the moment it is copied in unchanged.
2. **Each component's transitive dependencies are approved in the PR that vendors it.** Radix is a
   real behavioural dependency; this ADR approves the *pattern*, not every package shadcn might
   pull.
3. **A component is vendored when a surface needs it**, never speculatively. `packages/ui` should
   not accumulate primitives nothing renders.

## Risks

| Risk | Why it is real | Mitigation |
|---|---|---|
| **Two design vocabularies** — stock Tailwind scales survive alongside ours | The default is to *extend*; disabling requires deliberate configuration | Phase 1 asserts `bg-red-500` generates nothing; it is a test, not a convention |
| **Off-scale values via arbitrary syntax** | `p-[13px]` is one keystroke cheaper than looking up the scale | Lint rule lands in phase 1, before any primitive |
| **Confidence rendered as a tint** by a vendored component | Every upstream component encodes severity as colour, because upstream has no shape token | Rule 1 above; the existing `ui-guidelines.md` rule is the review gate |
| **Dependency creep through shadcn** | Each component adds "just one more" package | Per-PR approval; the aggregate is visible in the lockfile diff |
| **A half-migrated `globals.css`** stalls and both mechanisms live indefinitely | Migration is unglamorous and always loses to feature work | Phase 3 completes before phase 4 starts — no primitives while two mechanisms coexist |
| **Tailwind v4 churn** — the CSS-first model is newer than the config-file model | Fewer worked examples; some shadcn instructions still assume v3 | Pin the version; treat an upstream component's v3 assumptions as part of the vendoring edit |
| **Build-pipeline regression in CI** | `next build` currently passes with no postcss step | Phase 1 lands alone, so a CI break is attributable to one commit |

## Rollback strategy

**Before phase 4** (no vendored components):

1. Remove `@import "tailwindcss"`, the postcss config, and the dependency.
2. Delete the `@theme` block from `tokens.css`. **The custom properties themselves are untouched**,
   because `@theme` exposes them rather than replacing them — this is why the token values were not
   restructured to suit Tailwind.
3. Convert utility class strings back to CSS. Mechanical, and bounded by however many surfaces have
   migrated — which is why phase 2 migrates exactly one.
4. Restore `globals.css` from history for any surface already converted.

**After phase 4**, rollback is a rewrite of the vendored components, not a revert. Budget for it as
new work. This asymmetry is the reason the phase order is what it is.

**The signal that says to roll back** is stated in the reversal cost above and is worth repeating
because it is checkable rather than a feeling: **off-scale utilities landing despite the lint rule**.
If that happens, the token layer is no longer enforcing anything and the decision has failed on its
own deciding argument.

## Compliance

- **Stock Tailwind scales generate nothing.** A test compiles a fixture using `bg-red-500`,
  `p-[13px]`, and `text-[#b91c1c]` and asserts no matching CSS is produced. This is the check that
  makes "the tokens are upstream" true rather than intended.
- **`@theme` appears in exactly one file.** A grep across `apps/` and `packages/` finds it only in
  `packages/ui/src/tokens.css`; a second occurrence is a forked design system.
- **No design value lives in Tailwind configuration.** There is no `tailwind.config.*` defining a
  colour, length, radius, or shadow anywhere in the tree — a grep finds none. This is the check that
  makes the ownership hierarchy enforceable rather than stated: a value outside `tokens.css` means
  the implementation layer has started owning design decisions.
- **No hardcoded colour or off-scale length in `apps/*`.** The existing rule from the design pass —
  *nothing hardcodes a colour or an off-scale length* — becomes a lint rule rather than a README
  sentence.
- **`packages/ui`'s README states what the package is**, checked whenever its exports change. Its
  current text says a second export signals this question is unanswered; that sentence must go in
  the same change that adds the second export, or the package documents a decision that has been
  made as still open.
- **`.claude/context/tech-stack.md` says installed, not approved-but-absent**, from the commit that
  installs it. The current wording exists precisely to stop this ADR being assumed.
- **Exactly one CSS framework.** `tech-stack.md`'s *"a second CSS framework"* exclusion is unchanged
  and now has a first to be second to.

## Related

- `packages/ui/README.md` — the purpose line this unblocks, and the second-export signal
- `.claude/context/ui-guidelines.md` — the two rules the token layer exists to enforce
- `.claude/context/tech-stack.md` — *approved for styling, not yet installed*, and the
  single-CSS-framework exclusion
- `.claude/skills/frontend/SKILL.md` — the enforceable code rules that need utility-class guidance
- ADR-0014 (no runner; erasable syntax only) — the precedent that a build step is a decision
- ADR-0021 (archival enforced in code, not by a constraint) — the precedent for moving a rule out
  of documentation and into something that fails
