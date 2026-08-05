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
nothing new enters the stack without an ADR. So this package ships the half that needs no new
dependency, and the component library waits for that decision rather than arriving through a
`pnpm add` nobody wrote down.

That ADR now exists and is **Accepted**:
**[ADR-0023](../../docs/architecture/decisions/0023-tailwind-css-adoption.md)** — Tailwind v4 with
this file as its `@theme` source, Tailwind's own scales disabled rather than extended, and **these
tokens canonical over the utilities generated from them**. A design value that is not here has no
utility class.

**It authorises the install; it did not perform it.** Nothing is installed, no component exists, and
the second-export rule below still holds — it is spent by phase 4, not before. **shadcn itself is
not approved**: the ADR approves the vendoring pattern, and each component and each transitive
dependency (Radix, `cva`, `clsx`, `tailwind-merge`) is reviewed in the PR that first needs it.

Until then `apps/web/app/globals.css` holds the layout rules, built from these tokens.

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
