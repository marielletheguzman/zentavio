# ADR-0038: Inter as the product typeface, self-hosted through `next/font`

- **Status:** Accepted
- **Accepted:** 2026-08-23
- **Date:** 2026-08-23
- **Deciders:** project lead
- **Affects:** `packages/ui/src/tokens.css`, `apps/web/app/layout.tsx`,
  `.claude/context/ui-guidelines.md`, `.claude/context/tech-stack.md`

## Context

`.claude/context/ui-guidelines.md` says **"one sans family"** and does not name it. `tokens.css`
resolved that to a system stack:

```css
--font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
```

That is a stack, not a typeface. It renders Segoe UI Variable on Windows, SF Pro on macOS and
Roboto on Android — three faces with different metrics, different x-heights and different numeral
widths. The guidelines also require **tabular numerals wherever numbers are compared**, and every
comparison surface in the product depends on that: a readiness band, a cluster contribution table,
a salary threshold, a quota. Whether those digits align at all is currently a property of the
reader's operating system.

The redesign spec asks for Inter or Geist by name. Naming a typeface is a design decision with a
dependency attached, and `tech-stack.md` is unambiguous that nothing enters the stack without an
ADR — which is what this is.

**What makes it more than a preference.** The tokens file carries a promise that every colour pair
clears WCAG 2.1 AA. Nothing equivalent is true of the type, because the type is not fixed: a face
with a smaller x-height renders 14px secondary text meaningfully smaller than the face it was
verified against, and no test in this repository would notice. Pinning the face is what makes a
typographic verification mean anything the next time someone runs it.

## Options considered

### A. Keep the system stack

Change nothing.

**Pros.** Zero dependency, zero build step, zero bytes over the wire, no flash of fallback text, and
no privacy question at all. It is also what `ui-guidelines.md` currently implies, so it needs no
ADR — which has real value. On Windows 11, the machine this product is developed on, it resolves to
Segoe UI Variable, a competent humanist sans that is close to Inter in exactly the ways that matter
here.

**Cons.** The product has **no typeface**, it has three. Verified line lengths, verified type sizes
and verified numeral alignment hold on one platform and are untested on the others. It also cannot
satisfy the redesign brief, which names a face because a named face is part of a product having a
visual identity rather than inheriting the operating system's.

### B. Inter, self-hosted through `next/font/google`

`next/font` downloads the font files **at build time** and serves them from this origin.

**Pros.** One face everywhere, with real tabular numerals (`tnum`) and the large x-height that makes
14px secondary text readable — which is what the spec's "avoid overly small text" rule actually
needs. Self-hosting means **no runtime request to Google**: no third-party origin in a future CSP,
no user IP handed to a font CDN on page load, and no dependency on a CDN being reachable. `next/font`
also generates the `@font-face` and preload automatically and emits a CSS variable, which lets
`tokens.css` stay the single place a typeface is decided rather than splitting that between a token
file and a layout.

**Cons.** **A build-time network fetch enters `next build`.** The first build in a clean environment
must reach Google; after that it is cached, but a CI runner with no egress fails a build that used to
pass, and the failure will not obviously read as "font". Font files are added to the bundle — roughly
100 KB across the subsets actually used, which is real on a slow connection. `display: swap` means a
visible reflow when the face arrives. And it is a dependency on a Google-hosted artifact even though
nothing is requested from Google at run time.

### C. Geist

Vercel's sans, self-hosted the same way.

**Pros.** Identical mechanism and identical cost to B. More geometric, tighter apertures.

**Cons.** Reads as a developer-tooling identity, which is the specific thing the redesign brief lists
under what Zentavio must **not** look like — *"a developer/admin console"*. That is a weak reason to
reject a face in general and a sufficient one here, because the brief made it a requirement.

### D. Ship the font files in the repository

Vendor the `.woff2` files into `packages/ui` and write the `@font-face` rules by hand.

**Pros.** No build-time network access at all, and the exact bytes served are in version control and
reviewable.

**Cons.** Binary assets in a repository that has none, a licence file to carry and keep accurate, and
manual subsetting — which, done wrong, silently drops glyphs. The product is aimed at Filipino users
considering Germany and Luxembourg; German and French text needs diacritics that a careless Latin
subset omits, and the failure mode is a missing glyph in someone's own name.

## Decision

**Option B.** Inter, self-hosted through `next/font/google`, exposed as `--font-inter` and consumed
by `--font-sans` in `packages/ui/src/tokens.css`.

The deciding argument is **the same one ADR-0023 made about colour**: a design value that varies by
environment is not a design value. ADR-0023 moved the palette from review discipline into the build
so that an off-token colour has no class to write. This does the same for type — after it, the face a
reader sees is the face the layout was verified against, rather than whichever one their operating
system supplies.

Geist is rejected on the brief's own terms, not on quality. Option A is rejected because "one sans
family" cannot be true of a list of six.

### The token layer stays the decision site

```css
--font-sans: var(--font-inter), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto,
  sans-serif;
```

`apps/web/app/layout.tsx` supplies `--font-inter` and nothing else. It does not set a font on
`<body>`, and no component names Inter. This is ADR-0023's ownership hierarchy applied to type: the
token is canonical, the layout is plumbing, and a second app adding its own face would have to change
`tokens.css` to do it — where it would be seen.

**The fallback stack behind the variable is load-bearing, not decoration.** It renders during
`display: swap`, and it renders permanently in any surface that does not set the variable — `apps/admin`
and `apps/mobile` do not exist yet, and neither does a deployed environment, so today that is most of
them.

## Consequences

**Accepted costs.**

- **`next build` acquires a network dependency.** It is cached after the first successful build, and
  it is a new way for CI to fail in an environment that has no egress. Nothing here has ever built on
  a runner without one, so this is untested rather than known-good.
- **Font files enter the bundle. Measured 2026-08-26, replacing the estimate this line used to
  carry** (it said "roughly 100 KB"): `next build` emits **7 `.woff2` files totalling 213.8 KB**
  into `.next/static/media`. Only one of them, the 47.3 KB preloaded Latin subset, is fetched on
  first paint — the rest are `unicode-range` subsets a reader downloads only if their text needs
  them. So the estimate was wrong in both directions: **worse than stated as a total, better than
  stated as a first-paint cost.** The reversal signal below is written against the first-paint
  number, and 47.3 KB does not trip it.
- **A reflow on first paint** from `display: swap`. The alternative blocks first paint on a font
  file, which is worse for surfaces whose entire job is to tell someone where they stand.
- **`tokens.css` now depends on a variable it does not declare.** If `--font-inter` is never set the
  stack falls through silently and correctly — but "silently" means a missing layout wiring looks
  like nothing at all, on a machine where the fallback happens to look fine.

**Follow-up work.**

1. **Verify the numerals actually align.** `font-variant-numeric: tabular-nums` is already set on
   `.numeric` and on table cells; whether Inter's `tnum` is being applied is a browser observation,
   not an inference from this file.
2. **Re-verify type sizes in a browser at 1310px and 318px in both themes** — Inter's x-height differs
   from Segoe UI's, so the 14px secondary text that was verified against the system stack is a
   different size on the screen now.
3. ~~**Measure the bundle cost**~~ — done 2026-08-26, recorded above. The first `next build` also
   confirmed the build-time fetch works on a machine with egress; a runner without one is still
   untested.
4. ~~**Update `.claude/context/ui-guidelines.md`**~~ — done, in this slice.
5. ~~**Update `.claude/context/tech-stack.md`**~~ — done, in this slice.

**Reversal cost.** **Low, and it stays low.** Deleting the `Inter(...)` call and the `className` on
`<html>` returns the product to the system stack, because `--font-sans` already names that stack as
its fallback. No component references the face, so nothing else changes. This is the property Option
D would have given up.

**The signal to reverse** is a CI runner without egress becoming the normal case, or the first
measured bundle number being materially worse than the estimate above.

## Compliance

- **No component names a typeface.** A grep for `Inter`, `font-family` and `next/font` across
  `apps/` and `packages/` finds the layout and the tokens file, and nothing else.
- **`--font-sans` keeps a real fallback stack**, so removing the variable degrades rather than breaks.
- **The font is self-hosted.** The built output contains no request to `fonts.googleapis.com` or
  `fonts.gstatic.com` — checkable in the network panel, and it is the property the privacy argument
  rests on.

## Related

- ADR-0023 — Tailwind v4, and the ownership hierarchy this ADR applies to type
- `.claude/context/ui-guidelines.md` — "one sans family", and the tabular-numeral rule
- `.claude/context/tech-stack.md` — nothing enters the stack without an ADR
- `packages/ui/README.md` — the token layer as the single source of design truth
