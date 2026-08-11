# web

> **Purpose:** Main Zentavio SaaS UI (Next.js App Router): dashboard, jobs, skills, learning, interview, immigration, settings.

```text
app/
├── page.tsx + resume/upload-panel.tsx                 upload, and correct what was extracted
├── gap/page.tsx + gap-panel.tsx                       choose a track, see the gap and readiness
├── eligibility/page.tsx + eligibility-panel.tsx       viability, the rules, and the ways in
└── applications/page.tsx + applications-panel.tsx     record what you applied to, and what came of it
lib/
├── parse-view.ts         response → the five upload states
├── gap-view.ts           response → the six gap states
├── eligibility-view.ts   verdict → requirements, routes, and the questions that move them
└── applications-view.ts  applications → the timeline, and what we predicted before it
```

**Every state decision lives in `lib/`, which is pure and tested.** The components are markup and a
fetch. A state that lives only in JSX gets tested by clicking; these get tested by asserting, and
`.claude/context/ui-guidelines.md` requires all states designed before the success state is styled.

**Six gap states, not five.** `no_gap` is its own: rendering "you meet every requirement" as an
empty list reads as a loading bug. `unknown` is likewise not a gap of zero — a person deciding what
to spend six months learning deserves "we have not modelled this track" over a plausible empty list.

**An outcome is one tap, or it is not recorded** (ADR-0019, `docs/features/outcomes-learning.md`).
Outcome data cannot be bought or backfilled, so the applications surface never asks for a form to
report a rejection — the most common outcome and the one nobody returns to type. Nothing there is
required or blocking: a person who records nothing gets a product that works exactly as well, minus
the calibration.

**What we predicted is shown beside what happened.** That pairing is why outcomes are stored at
all, and showing it to the person it was about is what makes a readiness score falsifiable rather
than decorative. A prediction that was never made is said to be absent — never rendered as `0%`,
which would be a claim we did not make.

**Data goes through the API gateway only.** The browser never talks to `ai/*` directly — those are
internal services with no auth of their own, and a page that could reach one would be an open
endpoint. The gateway needs `ZENTAVIO_WEB_ORIGIN` set or every request here is blocked by the
browser.

**Numbers are never shown bare.** A weight becomes words, because `0.92` is not a sentence and "92%"
invites reading an importance as a probability. Readiness carries its band, its per-cluster
breakdown, and what it does not account for. Partial credit is hedged — the graph says how
competence transfers in general, not how it transferred for this person.

The dev credential is a header (ADR-0017) and disappears when a real session lands, since a real one
will be an httpOnly cookie the browser sends by itself.

## Not here

Dashboard, jobs, learning, interview, immigration, settings. `apps/admin` and `apps/mobile` are
untouched.
