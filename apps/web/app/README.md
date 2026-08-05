# app

> **Purpose:** App Router route tree (marketing, auth, dashboard segments, BFF api handlers).

```text
layout.tsx · globals.css
page.tsx                  + resume/upload-panel.tsx        upload, and correct what was extracted
gap/page.tsx              + gap/gap-panel.tsx              choose a track, see the gap and readiness
eligibility/page.tsx      + eligibility/eligibility-panel.tsx   the two axes, and what binds
```

**The panels are markup and a fetch.** Every state decision lives in `../lib`, which is pure and
tested — a state that lives only in JSX gets tested by clicking.

`globals.css` imports `@zentavio/ui/tokens.css` and holds the layout rules built from it. It
carries no colour, spacing, or type value of its own — those are tokens, and a literal here is a
value that has escaped the theme. There is **no Tailwind and no shadcn**: `packages/ui` promises
them, Tailwind is a framework, and CLAUDE.md wants an ADR before one enters the stack.

Of the purpose line above, three routes are filled. **Marketing, auth segments, and BFF api
handlers do not exist**: there is no session to build an auth segment around yet (ADR-0017 is implemented but
needs a provider), and a BFF route would be a second place that talks to the gateway. Today the
panels call it directly.
