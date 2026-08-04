# ADR-0022: Viability is two axes with the binding one named, not a single score

- **Status:** Accepted
- **Accepted:** 2026-08-04
- **Date:** 2026-08-04
- **Deciders:** project lead
- **Affects:** `ai/career-roadmap`, `ai/skill-gap`, `services/api-gateway`, `apps/web`,
  `docs/architecture/immigration.md`, `docs/roadmap/milestones.md` (M2, M4)

## Context

`docs/architecture/immigration.md` states the rule this ADR has to make real:

> **viability = eligibility × employability.** The binding constraint is always named.

Both halves now exist, and they are not the same kind of thing.

**Eligibility** (`ai/career-roadmap`) is **categorical**: `met`, `not_met`, `undetermined`,
`unknown`. `undetermined` means a rule could not be checked because a fact is missing; `unknown`
means nobody has modelled the pathway, or a licence-gated profession has no recognition rule on
file. Neither is a low score — they are the absence of an answer, and ADR-0010's evaluator refuses
to collapse them into one.

**Employability** (`ai/skill-gap`) is a **band**: `score_low` and `score_high`, where the width is
how much of the number rests on assertion rather than evidence, plus a `calibration` record naming
`CLAIMED_CREDIT` and what would replace it. It is deliberately not a single figure, for reasons
already decided in M1c.

So `×` is undefined. There is no multiplication between a category and an interval, and every way
of inventing one loses something the two halves were built to preserve.

The pressure toward inventing one is real and comes from M4 — *"four destinations, honestly
compared"* — which is easier to build if each destination has a number to sort by. That is exactly
the pressure this ADR exists to resist, because the same document that asks for viability also says:

> visa-eligible and unemployable at the threshold salary is **not** an opportunity
> hirable and ineligible is **not** an opportunity

Both statements are about a *binding constraint*, not about a magnitude.

## Options considered

### A. Gate — eligibility filters, employability ranks

Show only pathways where eligibility is `met`, ordered by readiness.

**Pros.** Simple. Produces an ordered list M4 can render directly. Never multiplies incompatible
things.

**Cons.** **It hides the most common case.** An `undetermined` verdict — the ordinary state for
anyone who has not yet answered every question — disappears from the list entirely, so a person
sees nothing and is told nothing. It also silently discards `unknown`, which is where a
licence-gated profession lands, and that is the population `docs/architecture/immigration.md`
warns hardest about. A filter that removes people we cannot answer for is a product that only
works on complete profiles, which M2's own milestone test was written to prevent.

### B. Product — map each status to a factor and multiply

`met` → 1.0, `undetermined` → 0.5, `not_met` → 0, times the readiness midpoint.

**Pros.** One number. M4 sorts trivially. Feels like the documented formula.

**Cons.** The factors are invented. `ai-principles.md` forbids exactly this, and `principles.md`
makes a number with no provenance a bug — there is no source that says an unanswered question is
worth half an answer. It also **destroys the distinction the evaluator works hardest to keep**:
`undetermined × 0.62` and `met × 0.31` both produce 0.31, so "we have not asked you something yet"
and "you are eligible but weakly prepared" become indistinguishable at the exact moment they need
different actions from the user. And collapsing the readiness band to a midpoint throws away the
width, which M1c added because the width is how much rests on assertion.

### C. Two axes, and the binding constraint named

Viability is a **pair** — an eligibility verdict and a readiness band — plus one field naming which
of the two currently binds, and why. No composite number is computed or stored.

**Pros.** Every refusal already built survives: `undetermined` still names the input that resolves
it, `unknown` still says what is missing, the band still shows its width. The binding constraint —
the thing `immigration.md` says must *always* be named — becomes the primary output rather than a
footnote. It answers "is this worth pursuing?" with the sentence a person can act on: *"eligible,
but you are 31% ready"* or *"ready, but the salary threshold is not met"*.

**Cons.** **Viability stops being a number**, and M4 cannot sort by it directly. Ranking four
destinations needs an explicit ordering rule instead of a numeric sort, and that rule has to be
designed and defended rather than falling out of arithmetic. The word "viability" also stops being
literal — it names a shape, not a scalar.

### D. Do nothing — ship eligibility alone, defer

**Pros.** No work. M2's verification test already passes.

**Cons.** It is the current state, and the current state is the failure `immigration.md` names: a
person who is visa-eligible and unemployable at the threshold salary sees a `met` verdict with no
qualification at all. That is the most confidently wrong output the product can produce, and it
gets worse the more pathways are ingested.

## Decision

**Option C.** Viability is an eligibility verdict and a readiness band, with the binding constraint
named. **No composite viability score is computed, stored, or rendered.**

The deciding argument is that a single number cannot carry a refusal. `undetermined` and `unknown`
are not low values — they are statements that an answer does not exist yet — and any arithmetic
that admits them has to invent a magnitude for "we do not know". Both remaining options that
produce a number do so by inventing one, and `ai-principles.md` outranks the convenience.

**`immigration.md`'s `viability = eligibility × employability` is amended** to say what it meant:
viability is composed *of* both, and neither alone is an answer. The `×` was shorthand for "you
need both", not for multiplication.

**The binding constraint is a closed set, not prose**: `eligibility`, `employability`, `recognition`
(licence-gated with no rule on file), `unmodelled` (no rules ingested), or `none` when both axes are
satisfied. Its evidence is the existing per-rule results and the readiness breakdown; nothing new is
computed to produce it.

## Consequences

**Accepted costs.**

- **M4 cannot sort by viability.** *"Four destinations, honestly compared"* needs an explicit
  ordering rule, and that ordering is now its own decision rather than a consequence of this one.
  The likely shape — group by binding constraint, order within a group by readiness — is not
  decided here, and M4 should not assume it.
- **"Viability" is a slightly wrong word** for a pair. Kept because it is what every existing
  document calls it, and renaming across the roadmap would cost more clarity than it buys.
- **Two surfaces must render two things.** A single figure is easier to design around, and the
  UI now has to make "eligible but not ready" legible without implying a ranking that does not
  exist.
- **`viability` cannot be a column.** Anything wanting to persist it stores the two axes and the
  binding constraint separately, which is more schema for the same information.

**Follow-up work.**

1. A `viability` shape in `packages/types` — the verdict, the band, the binding constraint, and the
   `asOf` both halves were computed against. Both axes must share one `asOf`, or the pair describes
   two different moments.
2. `ai/career-roadmap` composes it: it already owns eligibility, and `immigration.md` assigns
   employability to it too. It calls neither service — the gateway supplies both inputs, keeping
   `ai/` stateless.
3. A gateway route joining `GET /v1/eligibility` and the existing readiness path.
4. Amend `docs/architecture/immigration.md`'s formula line and the M2/M4 rows in `milestones.md`.
5. The M4 ordering rule, as its own decision.

**Reversal cost.** Low, and asymmetric in a useful direction. Adding a composite score later is
additive — both axes are already stored, so a number can be derived whenever someone can justify the
weights. Removing one after it has been shown to users is not: people will have made decisions
against it, and every stored score would need a provenance nobody recorded.

## Compliance

- **No composite viability number exists anywhere.** No `viability_score` column, no field of that
  shape in `packages/types`, no such value in an API response. A reviewer greps for it; a schema
  test asserts no such column.
- **The binding constraint is a closed union**, so a new one is a type error rather than a string
  nobody notices.
- **`undetermined` and `unknown` still reach the surface intact.** `ai/career-roadmap`'s existing
  tests already assert this per-rule; a viability test asserts the pair does not collapse either
  into a low reading.
- **Both axes carry the same `asOf`**, asserted in the composition — a pair describing two moments
  is not a verdict about anything.
- **The band keeps its width.** No midpoint is taken anywhere in the viability path; M1c added the
  width precisely because it says how much rests on assertion.

## Related

- `docs/architecture/immigration.md` — the formula this amends, and the two "not an opportunity"
  statements that decide it
- ADR-0010 (six domains, one table), ADR-0019 (outcomes, which will eventually let the binding
  constraint be checked against reality)
- `ai/skill-gap/src/skill_gap/readiness.py` — the band and its calibration record
- `.claude/context/ai-principles.md` — rules against inventing a number
- `docs/roadmap/milestones.md` — M2's scope line and M4's comparison
