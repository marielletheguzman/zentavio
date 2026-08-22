# ADR 0031: A company's interview process is described per role family, above a stated support floor, and never from a single report

- **Status:** Proposed
- **Date:** 2026-08-22
- **Deciders:** project lead
- **Affects:** `knowledge-engine/interview-reports`, `ai/interview-prep`, `services/api-gateway`, `apps/web`, `docs/features/interview-prep.md`, `.claude/skills/interviews/SKILL.md`

## Context

M8's verified-by is *"a company with thin reports produces 'we don't have enough reports yet' plus
useful role-generic prep — never fabricated stages."* Both halves depend on a number that does not
exist.

**Four documents require a minimum support threshold and none of them states one.**
`docs/features/interview-prep.md` has a section titled *"Below minimum support"*;
`.claude/skills/interviews/SKILL.md` says *"minimum support before surfacing a pattern"* and
*"enforce a minimum support threshold"* and *"if support is below threshold, say so"*. There is no
number, no unit, and no definition of what is being counted.

**There are also no reports, and no way to submit one.** `backlog.md` lists *"interview report
contribution flow"* under Middle with the note **"must precede M8"**. That is still true: this
decision settles what a report has to add up to, and the flow that produces them is separate work.

### The constraint that makes this non-obvious

Interview knowledge is **tier 4 — self-reported experience**, and it is the only tier-4 data this
product would surface. Every other claim here traces to a statute, an official announcement, or
something the person told us about themselves. This traces to strangers describing a private meeting
from memory, months later, with an incentive to look competent about it.

**Both failure directions are real and neither is safe.**

A threshold too low fabricates specificity. *"They ask system design at stage 3"* on the strength of
two reports sends somebody into a week of the wrong preparation, and they will never know it was our
sample size rather than the company that misled them. `interview-prep.md` names this exactly: a
person's preparation time is at stake.

A threshold too high makes the feature inert. Every company reads *"we don't have enough reports"*
forever, nobody sees value, nobody contributes a report, and the threshold is never reached — a
cold-start deadlock that looks like caution and is actually a product that does not work.

**And the unit matters more than the number.** Fifteen reports about a company's sales interviews say
nothing about its backend process. Counting per company is the mistake that makes any threshold
meaningless.

## Options considered

### Option A — A fixed count per company

Surface a company's process once it has *n* reports, whatever roles they describe.

**Advantages.** Simplest to explain and to implement. One number, one query.

**Disadvantages.** **The unit is wrong.** A large company's process differs by function, by level and
by office; fifteen reports drawn from four functions describe no single process. It would produce its
most confident output for exactly the companies where the variance is highest.

### Option B — Support counted per company × role family, with a floor per stage

A process is described when the **company and role family** pairing clears a floor, and each
individual stage claim clears its own smaller floor. Everything below falls back to role-generic
preparation.

**Advantages.** Counts the thing that is actually being claimed. Lets a well-covered pairing surface
while the same company's uncovered pairings honestly say nothing, which is both more accurate and
more legible to a person. The per-stage floor stops one outlier report inventing a round nobody else
mentioned.

**Disadvantages.** Two numbers rather than one, and both are judgement. Slower to activate — a
company needs coverage per pairing, not in total. Role family has to be defined, and mis-assigning a
report to one silently pollutes a pairing.

### Option C — Confidence bands instead of a floor

Surface at any *n*, with confidence scaled to it: `low` at 2, `medium` at 8.

**Advantages.** Nothing is hidden; the user sees everything and its strength. No cold-start deadlock.

**Disadvantages.** **A confidence label does not undo a specific claim.** Told *"system design at
stage 3 (low confidence, 2 reports)"*, people prepare for system design — the number is read as
detail, not as a warning, and this product has already refused this shape once: ADR-0026 grouped
destinations rather than ranking them for the same reason, because a qualifier under a specific claim
is not read as one.

### Option D — Never describe a company's process; role-generic prep only

**Advantages.** Impossible to fabricate. Removes the tier-4 problem by removing tier 4.

**Disadvantages.** Discards the thing M8 exists for. The feature doc's own example — *"12 of 15
reports (last 18 months) describe a system-design round at stage 3"* — is genuinely useful and
honestly stated, and this option says it may never be said even when true.

### Option E — Do nothing until reports exist

**Advantages.** Costs nothing, and there is no data to threshold yet.

**Disadvantages.** The contribution flow is built against a definition of what a report must contain
and what it will be used for. Building it first and deciding this after means collecting reports that
do not answer the question — which is the mistake ADR-0019 was written to avoid for outcomes.

## Decision

**Option B — support is counted per company × role family, a process is described only above a stated
floor, each stage claim carries its own floor, and everything below produces role-generic preparation
that says why.**

Five parts.

**1 — The unit is the pairing.** `(company, role_family)`. A count against a company alone is never
sufficient support for anything, and the schema should make that combination the key rather than a
filter somebody remembers to apply.

**2 — Two floors, both stated on the surface.** A pairing needs **at least five reports** before its
process is described at all, and an individual stage needs **at least three** mentioning it before it
appears. The first stops a process being drawn from anecdote; the second stops one report inventing a
round. Both numbers are judgement, and are recorded here so they can be argued with rather than
discovered in code.

**3 — Recency is part of support.** Only reports from the **last 18 months** count toward either
floor. A process from four years ago is a different company's process, and an old report that still
matches is no loss — a current one will say the same thing.

**4 — Confidence is capped at `medium`, always.** Tier 4 has a ceiling that consistency does not
raise. Fifty agreeing reports are still fifty strangers' recollections, and an officially published
process is tier 1 and outranks all of them.

**5 — Below the floor is an answer, not an error.** *"We don't have enough reports for this role at
this company yet"*, plus preparation built from the role's requirement facts — and the count is shown,
because *"3 reports, we need 5"* is an invitation to contribute one and *"not enough"* is a dead end.

## Consequences

**Accepted costs.**

- **Almost nothing will clear the floor for a long time.** Five reports per pairing in eighteen months
  is a lot of contribution, and the honest state of this feature for the foreseeable future is the
  below-threshold message. That will read as the product not working.
- **The cold-start risk is real and this decision does not solve it.** It mitigates it only by showing
  the count and the gap. If contribution never arrives, M8 delivers role-generic prep and nothing
  else — which is still the useful half, and is worth saying out loud now rather than discovering.
- **Role family has to be defined and assigned**, and a mis-assigned report pollutes a pairing
  silently. `careers.family` exists and is the obvious source; whether it is granular enough is
  unproven.
- **Two numbers chosen by judgement.** Five and three are defensible and not derived. Nothing
  calibrates them until enough reports exist to check whether pairings that cleared the floor actually
  predicted the process people met — which is M9's shape, and is the honest revisit trigger.
- **A determined company could seed reports.** Five is not many. Mitigations belong with the
  contribution flow — one report per person per pairing, authenticated — and are named as its work
  rather than pretended to be solved here.

**Follow-up work.**

- Entity documentation and schema for interview reports and the process model, keyed on
  `(company, role_family)`.
- The contribution flow the backlog already names as preceding M8, with its own anti-gaming posture —
  the same treatment `assessment-integrity.md` gave the assessment.
- The below-threshold surface, showing the count and what is still needed.
- Role-generic preparation built from the role's requirement facts, which is what the below-threshold
  path returns and therefore the part that must be good.
- An officially published process, where one exists, as a tier-1 record that outranks reports.

**Reversal cost.** Low for the numbers, higher for the unit. Changing five to four is an edit;
changing the unit from `(company, role_family)` to something else is a re-key of stored aggregates.
The signal to revisit the numbers is M9-shaped: pairings that cleared the floor and then described a
process people did not meet. The signal to revisit the unit is role family proving too coarse — one
pairing whose reports visibly describe two different processes.

## Compliance

A reviewer verifies this by:

- **A test that no process is surfaced below the floor**, per pairing and per stage, with the counts
  as fixtures rather than as constants imported from the code under test.
- **A test that the below-threshold path returns role-generic content and names the shortfall** — the
  count and the gap, not "not enough".
- **A test that confidence never exceeds `medium`** for a report-derived process, at any *n*.
- **A test that a pairing's reports are counted per pairing**, not per company: the same company with
  a well-covered pairing and an uncovered one returns a process for the first and the shortfall
  message for the second.

## Related

- ADR-0026 — why a qualifier under a specific claim is not read as a warning
- ADR-0019 — deciding what data is for before collecting it
- `docs/features/interview-prep.md`, `.claude/skills/interviews/SKILL.md` — the documents that
  require this threshold
- `.claude/context/knowledge-sources.md` — tier 4 and its ceiling
