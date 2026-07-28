# UI Guidelines

> **Purpose:** Zentavio's design philosophy, so that "make it look good" is never a judgment
> call. The `frontend` skill enforces the code rules; this file decides how the product should
> feel and what a screen must accomplish.

## The test every page must pass

> **What should the user do next?**

If a screen shows data but no next action, it is a report, not a product surface. Every page
ends in an actionable insight: close this gap, compare these two countries, practice this
question, widen this search.

## Philosophy

- **Dashboard first.** The default surface is a dashboard of the user's own trajectory, not a
  search box. Search is a tool inside the product, not its front door.
- **Dark mode first.** Design dark, verify light. Both ship from the same tokens.
- **Minimal.** Density where it informs, whitespace everywhere else. No decoration that does
  not carry information.
- **Professional, modern SaaS.** Calm, precise, trustworthy. This product tells people
  uncomfortable truths about their careers — it should look like it knows what it is talking
  about.
- **Cards, progress, charts, insights.** The four building blocks: a card is a claim, progress
  is a gap, a chart is a comparison, an insight is a next action.
- **No unnecessary animation.** Motion only to show a relationship — where a panel came from,
  what changed. Never for delight. Respect `prefers-reduced-motion`.
- **Maximum width.** Content is constrained (roughly 1280px) and centered. Full-bleed text is
  unreadable and looks unfinished.
- **Responsive down to 320px.** Every surface, including tables and charts.
- **Accessible by construction.** WCAG 2.1 AA is the floor, not an audit item.

## Design tokens

Values live in `packages/ui`. This is the intent behind them.

**Color** — a neutral scale carries the interface; one accent carries action. Semantic
colors mean exactly one thing each: positive (progress, met requirement), caution (gap,
approaching threshold), negative (blocked, ineligible), info (neutral fact). Confidence has
its own visual language — see below. Never encode meaning in hue alone; pair it with an
icon, a label, or a shape. Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries, in **both**
themes.

**Spacing** — a 4px base scale (4/8/12/16/24/32/48/64). Nothing off-scale. Vertical rhythm
between sections is one step larger than within them.

**Typography** — one sans family. A restrained scale (12/14/16/20/24/32/40) with three
weights (regular, medium, semibold). Body text 16px minimum. Numbers tabular wherever they
are compared — misaligned digits in a score column read as sloppiness.

**Radius** — rounded, consistently. Cards and panels use the large radius; controls the
medium; inputs match their buttons. Nothing square, nothing pill-shaped except tags.

**Elevation** — borders over shadows. One subtle shadow level for genuinely floating things
(menus, dialogs). Shadow is not a hierarchy tool.

**Icons** — one line-icon set, one stroke weight, consistent optical size. Icons label; they
do not decorate. Never an icon-only control without an accessible name.

**Charts** — see the `dataviz` guidance before writing any chart. Categorical colors from one
palette, sequential scales for magnitude, and axis labels that name their units.

## Rendering confidence and evidence

This is where the product's credibility lives.

- Every score shows its **confidence**, and low confidence looks visibly different — not the
  same badge in a lighter tint. Understating uncertainty is a correctness bug.
- Every score has a reachable **why**: inline, in a disclosure, or in a detail view. A bare
  `87%` is a defect.
- **Unknown is a first-class state.** "We don't know yet — here's what's missing" gets a
  designed treatment, not an empty cell or a zero.
- Facts show their **source**, linked. Judgments are labeled as the platform's assessment.
  Never style them identically.

## Required states

Every async surface designs all four before the success state is styled:

| State | Requirement |
|---|---|
| **Loading** | A skeleton matching the final layout. No spinner-in-a-void, no layout shift on arrival. |
| **Empty** | Say why it is empty and offer the next action. "No matches in Germany yet — widen to remote?" not "No results". |
| **Error** | What failed, whether it is retryable, and a retry affordance. Never a raw error code alone. |
| **Success** | The data, its evidence, and the next action. |

Partial success is its own case: show what loaded, name what did not, keep the page usable.

## Forms and input

Labels always visible — placeholders are not labels. Validate on blur and on submit, never
per keystroke. Errors sit beside the field, in words ("Enter a salary in EUR"), and are
announced. Long flows (resume upload, immigration questionnaire) save progress and say what
remains. Destructive actions confirm and name what will be lost.

## Accessibility floor

Semantic elements before ARIA. Every control keyboard-reachable with a visible focus ring.
Logical tab order and a skip link. Async results announced via `aria-live`. Images and charts
carry text alternatives — a chart's alternative is its finding, not its title. Nothing
conveyed by color alone. Test the keyboard path for anything a user could complete without a
mouse.

## Related

- `frontend` skill — the enforceable code rules
- `dataviz` skill — read before writing any chart
- `docs/features/*` — what each surface must accomplish
- `packages/ui` — where tokens and primitives actually live
