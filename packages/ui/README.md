# ui

> **Purpose:** Shared React component library (shadcn base).

## What is here today: tokens, and only tokens

`src/tokens.css` is the design-token layer `.claude/context/ui-guidelines.md` points at — the
spacing scale, the type scale, the radii, the one shadow level, and both colour themes. Every
surface in `apps/web` imports it and styles against those variables; nothing hardcodes a colour or
an off-scale length.

There are **no React components here yet.** The purpose line above is still the contract, and the
gap between it and this directory is deliberate — see below.

## Why the purpose line is not yet met

shadcn is a Tailwind component library. Tailwind is a framework, and CLAUDE.md is unambiguous:
nothing new enters the stack without an ADR. So this package shipped the half that needed no new
dependency, and the component library waited for that decision rather than arriving through a
`pnpm add` nobody wrote down.

That ADR exists and is **Accepted**:
**[ADR-0023](../../docs/architecture/decisions/0023-tailwind-css-adoption.md)** — Tailwind v4 with
this file as its `@theme` source, Tailwind's own scales disabled rather than extended, and **these
tokens canonical over the utilities generated from them**. A design value that is not here has no
utility class.

**Phase 1 is done and phase 4 has not started.** Tailwind v4 is installed and pinned in `apps/web`,
`tokens.css` carries the `@theme` block, `eslint.config.mjs` rejects arbitrary values, and
`src/tokens.test.ts` asserts the stock scales generate nothing. **No component has been vendored,
so `src/components/` does not exist and the second-export rule below still holds** — it is spent by
phase 4, not by phase 1. **shadcn itself remains unapproved**: the ADR approves the vendoring
pattern, and each component and each transitive dependency (Radix, `cva`, `clsx`, `tailwind-merge`)
is reviewed in the PR that first needs it.

`apps/web/app/globals.css` still holds the layout rules for surfaces that have not migrated
(ADR-0023 phases 2 and 3). Two mechanisms coexisting is the migration, not the destination.

## What the `@theme` block is, and is not

It contains **mappings, not values**. Every declaration in it points at a custom property declared
above it in the same file, because a literal length or colour there would put a design value outside
the file `.claude/context/ui-guidelines.md` points at — which ADR-0023 names as a defect.

It uses `@theme inline`, and that is load-bearing rather than stylistic. Four of Tailwind's
namespaces — `--font-*`, `--text-*`, `--radius-*`, `--shadow-*` — collide with names this file
already declares, so a plain `@theme` would re-emit `--text-lg: var(--text-lg)` and every type size
would silently resolve to itself. `inline` makes the utility carry the resolved value instead, which
is also why a theme swap needs no `dark:` variant anywhere: `bg-surface` compiles to
`var(--bg-raised)`, and that property is what the `prefers-color-scheme` block redefines.

**Spacing is declared as eight discrete steps, not as Tailwind's `--spacing` multiplier.** The
multiplier makes every integer valid, so `p-7` would compile to 1.75rem — off the 4px scale, by
default, with nothing in a diff to notice.

## The two rules the tokens exist to enforce

1. **Dark is the designed theme; light is the verification pass.** Both ship, and every colour
   pair clears WCAG 2.1 AA in both — which is why the semantic colours are *darker* in light mode
   rather than being the same hue re-used.
2. **Meaning never rests on hue.** `--shape-certain` / `--shape-uncertain` exist so low confidence
   can be a different *shape* — a dashed border — rather than a paler version of the confident one.
   The guidelines call the paler-tint version a correctness bug, because it reads as "the same
   thing, quieter" when it means "we are less sure this is true".

## Usage

```css
@import '@zentavio/ui/tokens.css';
```

The package exports that one path and nothing else. Adding a second export is a signal the
component-library question above needs answering first.
