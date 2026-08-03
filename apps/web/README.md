# web

> **Purpose:** Main Zentavio SaaS UI (Next.js App Router): dashboard, jobs, skills, learning, interview, immigration, settings.

```text
app/
├── page.tsx + resume/upload-panel.tsx   upload, and correct what was extracted
└── gap/page.tsx + gap-panel.tsx         choose a track, see the gap and readiness
lib/
├── parse-view.ts   response → the five upload states
└── gap-view.ts     response → the six gap states
```

**Every state decision lives in `lib/`, which is pure and tested.** The components are markup and a
fetch. A state that lives only in JSX gets tested by clicking; these get tested by asserting, and
`.claude/context/ui-guidelines.md` requires all states designed before the success state is styled.

**Six gap states, not five.** `no_gap` is its own: rendering "you meet every requirement" as an
empty list reads as a loading bug. `unknown` is likewise not a gap of zero — a person deciding what
to spend six months learning deserves "we have not modelled this track" over a plausible empty list.

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
