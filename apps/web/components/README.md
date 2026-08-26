# components

> **Purpose:** Reusable React UI components for the web app.

## What is here

The primitive layer the redesign is built from, written against Tailwind utilities generated from
`packages/ui/src/tokens.css` (ADR-0023).

```text
cx.ts             class-name joining, four lines, written rather than installed
status-tones.ts   the state → treatment table. No JSX, so the rule it encodes is testable
status.tsx        StatusBadge, and the six status glyphs
button.tsx        Button and ButtonLink — primary, secondary, tertiary
card.tsx          Card, CardHeader, CardSection, CardFooter
field.tsx         Field, TextField, SelectField, FileField
states.tsx        LoadingSkeleton, EmptyState, ErrorState, UnknownState
progress.tsx      ReadinessBand (a range), SupportMeter (a count against a floor)
page-header.tsx   the contextual header every screen opens with
nav-items.ts      what the navigation may link to, and active-route matching
nav-icon.tsx      the seven navigation glyphs
app-shell.tsx     sidebar on desktop, drawer and bottom bar on a phone
```

## Why they are here and not in `packages/ui`

`packages/ui`'s purpose line names a **shadcn** component library, and ADR-0023 approves the
vendoring *pattern* without approving a single component — shadcn, Radix, `cva`, `clsx` and
`tailwind-merge` are each reviewed in the PR that first needs them. Its README also says a second
export path is the signal that question needs answering, and ADR-0023 reserves that signal for
phase 4.

These are hand-written primitives against the utility layer — ADR-0023's **Option D**, which it
keeps as *"a standing position rather than a discarded alternative."* One app uses them, so they
live in that app. When a second app needs one, moving it to `packages/ui` is the change that makes
the shadcn and Radix question concrete, which is exactly where the ADR wants it decided: on a real
case rather than in the abstract.

## The rules these encode

**No state is told apart by colour alone.** Every entry in `status-tones.ts` differs from every
other in colour, in border *style*, and in words. `unmodelled` and `not_applicable` are the pair
this exists for — both are quiet, both are grey-adjacent, and they mean opposite things (ADR-0026).
`status.test.ts` asserts they can never collapse into the same treatment.

**Uncertainty is a different shape, never a paler tint.** `.claude/context/ui-guidelines.md` calls
the lighter-tint version a correctness bug: it reads as "the same thing, quieter" when it means "we
are less sure this is true".

**A label is required, never defaulted.** `StatusBadge` takes no default label, because a default
is how a chip ends up shipping with a colour as its only content.

**Nothing links to a route that does not exist.** `nav-items.ts` holds the whole list, and
`nav-items.test.ts` walks `app/` and compares. The redesign brief's Account group (Profile,
Settings) is deliberately absent — neither route exists, and a stub page under a real URL claims
more than a missing one does.

**44px is the floor for anything you press.** Written as `min-h-12` (3rem), which is the touch
target and the "do not use tiny buttons" rule meeting in the middle.

**No `dark:` variant anywhere.** The semantic tokens swap themselves under `prefers-color-scheme`,
so `bg-surface` is already right in both themes. Reaching for `dark:` to fix a colour means a
literal was used where a token belonged.

## Pure logic goes in a `.ts` file

Same split `../lib/README.md` describes, and for the same reason: *"that is what makes the state
machine assertable instead of clickable."* It is also mechanical — the unit project runs under
`jsx: preserve`, so a test that imports a `.tsx` fails to parse before it fails an assertion.

`status-tones.ts` and `nav-items.ts` exist because of that rule, and both are tested.

## Related

- `packages/ui/src/tokens.css` — the tokens every class here resolves to
- `.claude/context/ui-guidelines.md` — the required states, the confidence rules, the a11y floor
- `.claude/skills/frontend/SKILL.md` — the enforceable code rules
- ADR-0023 — Tailwind, the ownership hierarchy, and why shadcn is still unapproved
