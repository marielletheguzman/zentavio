# MVP Scope — Options and Recommendation

> **Purpose:** Analyse the candidate MVP scopes and recommend one. **Product decision, not an ADR.**
> **Decided 2026-07-28: modified Option A, cloud / platform engineering, Germany.** Canonical definition:
> [`mvp.md`](mvp.md) — this document is kept for the reasoning and the rejected options.

## First: these are two separate decisions

The options as posed bundle two questions that should be answered independently, because they trade off
against different things:

| Decision | Question | Axis |
|---|---|---|
| **Feature scope** | which capabilities ship first? | breadth of the product |
| **Vertical slice** | which career track, which destination? | depth of one answer |

`mvp.md` already answers the second (one track, Germany) and the roadmap method requires a **vertical
slice** — one complete answer through every layer, because horizontal phases produce nothing demonstrable
until the last one (`.claude/skills/roadmap/SKILL.md`).

Options A, B, and C are **feature bundles** — a horizontal axis. So they need translating into slices, and
the translation is where the real recommendation lies.

## The options as posed

### Option A — Career Profile + Résumé Optimization + Job Matching

**User value.** Familiar and immediately legible. A user uploads a résumé and gets matched jobs.

**Complexity.** Moderate, but **higher than it looks**: résumé *optimization* is generation, not extraction.
`ai/resume-parser` currently only parses. Generation needs its own versioned prompt, its own eval cases, and
a hard rule that it never invents an achievement the profile does not support — a fabrication surface aimed
directly at a document the user will submit to an employer.

**Time to usable.** Fastest of the three.

**The problem.** This is the closest of the three to a job board with an AI résumé tool attached. For a
Filipino professional targeting Germany, it answers "which jobs match my skills?" while leaving the actual
blocking question — *can I legally take any of them?* — untouched. It is the option most likely to produce a
product that demos well and does not change a decision.

### Option B — Career Profile + AI Career Agent + Interview Coach

**User value.** Strong for someone already employable in their target market and preparing.

**Complexity.** High, and partly **blocked by data rather than effort**: the Interview Coach needs report
volume above the minimum-support threshold, and there are zero reports. Below that threshold it can only
offer role-generic prep, which is honest but is not the feature
(`docs/features/interview-prep.md`).

**Time to usable.** Slowest, because one component cannot be good until users have contributed data.

**The problem.** It prepares people for interviews they may not be eligible to attend. For this user base
that inverts the order of their actual problem.

### Option C — Full Career Intelligence Platform

**User value.** Highest, eventually.

**Complexity.** Highest. Ten capabilities, four destinations, origin-side rules, regulated professions,
outcome prediction.

**Time to usable.** Longest, and the failure mode is specific: ten capabilities each at 60% completeness,
none trustworthy, and a design that has hardcoded the shallowness because nothing was forced to be deep
first. This is what depth-before-breadth exists to prevent.

**Also blocked.** Regulated professions need the origin-jurisdiction ADR; prediction needs outcome volume
that cannot be backfilled.

## Recommendation

**A modified Option A — swap résumé optimization for eligibility.**

> **Career Profile + Skill Gap + Immigration & Sponsorship view**, for **one career track × Germany**, end to
> end, with `REMOTE` as a comparison target.

### Why

**Eligibility is the differentiator and the trust anchor.** Every alternative to Zentavio — job boards,
Facebook groups, recruitment agencies — can show a Filipino professional a job in Germany. None of them can
tell them, with citations, whether they are eligible and what specifically is missing. `business.md` says
the primary user's alternative is "an expensive, sometimes exploitative, mistake"; eligibility is the part
that prevents that.

**It answers the question in the right order.** Eligible → employable → which jobs → how to present
yourself. Options A and B both start at step three or four.

**`needsFromUser` is the strongest interaction we have.** "Add your expected salary and this becomes a
definite answer" converts an `undetermined` into a verdict with one input. That is a better first experience
than a ranked list.

**It defers the two riskiest surfaces.** Résumé generation is a fabrication surface pointed at an employer;
interview prep is gated on data we do not have. Neither is cut permanently — both move to Phase 4 and 5,
where they can be done properly.

**It matches `mvp.md`**, so approving this changes nothing already written — it confirms it.

### What this deliberately excludes

Résumé generation · interview prep · the other three destinations · a second career track · job aggregation
at scale (seeded facts with real provenance are acceptable) · billing · prediction.

### The track choice — decided: software / IT

**Decided 2026-07-28: software / IT.** It satisfies the criterion below, and it means Phase 1 does not wait
on origin-side recognition rules being sourced.

Still to narrow: which concrete node inside that family — software engineering, cloud / platform, or IT
support. The skill graph and `references/careers/<track>.md` need one, not a family.

The criterion that produced the decision: largest Philippines→Germany demand whose recognition path is
**not** licence-gated, because licence-gated tracks are blocked until ADR-0010's rules are ingested.

| Candidate | Demand | Licence-gated? | Viable for MVP |
|---|---|---|---|
| **Software / IT** | high | no | **CHOSEN** |
| Nursing | very high | **yes** — licence recognition required | no, until the origin ADR |
| Engineering (regulated disciplines) | high | **yes** in several disciplines | no, until the origin ADR |
| Skilled trades | high | varies by trade | needs per-trade checking |

The uncomfortable part: **nursing is probably the largest real Philippines→Germany flow, and it is the one we
cannot serve first.** Not because it is unimportant — because serving it honestly requires the rule model to
express origin-side licence recognition, and shipping a visa-only verdict to a nurse would be the single most
harmful thing this product could do. That is Phase 3, and it is the strongest argument for prioritising the
origin-jurisdiction ADR.

## If you prefer a different option

Both alternatives are defensible with a stated reason, and neither is wrong:

- **Option A as posed**, if speed to a demonstrable product outweighs differentiation — accepting that the
  first version does not answer the eligibility question, and that résumé generation needs its eval suite
  before it ships.
- **Eligibility only, no matching**, if you want the narrowest possible honest slice — "am I eligible for
  Germany, and what is missing?" That is smaller than my recommendation and would ship sooner, at the cost
  of not showing the user any opportunity.

What I would not recommend is Option C, and the reason is structural rather than about effort: it produces
ten shallow answers and a design that cannot be deepened.

## Decision status — all settled 2026-07-28

- [x] **Feature scope** — modified Option A
- [x] **Career track family** — software / IT
- [x] **Track node** — **cloud / platform engineering**
- [x] **Launch destination** — Germany

Once approved, `mvp.md` is updated to match and Phase 1 is unblocked — subject to the remaining
architectural blockers in `.claude/context/decision-gate.md`.

## Related

- [`mvp.md`](mvp.md) — the canonical definition this would confirm
- [`phases.md`](phases.md), [`milestones.md`](milestones.md)
- `.claude/context/business.md` — who the users are and what they are paying to avoid
- `docs/architecture/immigration.md` — the gap that blocks regulated professions
