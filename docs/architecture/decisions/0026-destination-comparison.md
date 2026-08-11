# ADR-0026: Destinations are compared, grouped and explained — never ranked by a score

- **Status:** Proposed
- **Date:** 2026-08-11
- **Deciders:** project lead
- **Affects:** `packages/types`, `services/api-gateway`, `apps/web`, `ai/career-roadmap` (read-only),
  `docs/roadmap/milestones.md`, `.claude/context/countries.md`

## Context

M4 is *"four destinations, honestly compared"* — DE, LU, NZ, CH and `REMOTE`, side by side. The word
carrying the weight is **honestly**, and ADR-0022 already spent this argument once: it refused a
composite viability score because **a single number cannot carry a refusal**. `undetermined` and
`unknown` are not low values; they are statements that an answer does not exist yet, and any
arithmetic admitting them invents a magnitude for *we do not know*.

ADR-0022 also predicted this decision and deliberately declined to make it:

> **M4 cannot sort by viability.** *"Four destinations, honestly compared"* needs an explicit
> ordering rule, and that ordering is now its own decision rather than a consequence of this one.
> The likely shape — group by binding constraint, order within a group by readiness — is not decided
> here, and M4 should not assume it.

**The tension is that a comparison surface invites an order, and the data cannot honestly supply
one.** Five destinations on a screen create an implied ranking whether or not anything sorted them.
Doing nothing is therefore not neutral — top-of-list reads as *best* to every user who has ever seen
a list.

Three constraints narrow this before any option is weighed.

**M4's own verification says nothing about order.** It is: *"a user sees one market marked `unknown`
on salary while another is complete, and the comparison is still usable — partial coverage rendered
as a designed state rather than a blank."* The milestone is about **honest partial coverage**, not
about ranking. The pull toward a leaderboard is imported from elsewhere.

**`REMOTE` is already modelled as not-a-country** (`.claude/context/countries.md`): no jurisdiction,
no pathway, constrained instead by employer policy, time-zone overlap, contracting and tax
treatment, and payment mechanics — and *"for a Philippines-based user it is often the correct answer
and the fastest one, so it never renders as a country with an empty visa section"*. Any comparison
that scores it on immigration dimensions contradicts a decision already taken.

**Ranking already exists in this product, and its rule is explainability.**
`recommendations/SKILL.md` ranks *next actions* by expected value and states the constraint: *"a
ranking whose order cannot be explained factor by factor is not shippable"*, with commercial
interest permanently out of the ordering. Destinations are not next actions, but that bar applies.

**What is not yet true.** Only DE and LU have reference files, connectors and ingested rules. NZ, CH
and `REMOTE` have none. This ADR decides semantics; M4's implementation is gated on that data
existing, and the comparison must behave correctly when three of five destinations have nothing on
file — which is, conveniently, exactly what its verification tests.

## Options considered

### Option A — A single composite ranking

One score per destination, one order for everybody.

**Cons.** It is ADR-0022's refusal with a wider blast radius. The weights would be ours, invented,
global, and applied to people whose priorities we have never asked about — and every `undetermined`
would need a numeric stand-in. **A destination missing a salary rule would sort below one whose rule
we happen to have ingested**, which measures our coverage and presents it as the world. Rejected,
and it may not be reintroduced as a "sensible default" later.

### Option B — A user-weighted ranking

The person states what matters — immigration ease, salary, cost, time, employment — and the order
follows.

**Pros.** The weights belong to the person, so the order is theirs rather than ours, and it can be
shown back to them factor by factor. This is the only form of a total order this product could
honestly ship.

**Cons.** It needs weights we cannot default without smuggling our own judgement back in, and it
answers a question nobody has asked yet: no user has told us their priorities, and M4's verification
does not involve them. It also makes missing data worse, not better — a dimension a user weighted
heavily and we have not sourced produces an order driven by *our* gaps against *their* priorities.
**Not rejected — deferred**, and named as the only path to a total order if one is ever wanted.

### Option C — A comparison, grouped by what binds, with no total order

Destinations are shown as a matrix of dimensions. They are **grouped** by the binding constraint
ADR-0022 already computes — a closed set — and within a group nothing is scored against anything.
Incomparability is preserved and rendered rather than resolved.

**Pros.** It is what M4 actually asks for. The grouping is already computed, already explained by
`binding_reason`, and adds no new judgement. Missing data has an honest place: a destination with no
rules on file is `unmodelled`, which is a group, not a low rank.

**Cons.** It does less for a user who wants to be told where to go. A matrix is harder to design
than a list, and the ordering *within* a group still has to come from somewhere.

### Option D — A partial order (Pareto)

A destination is preferred only when it is at least as good on every selected dimension and strictly
better on one.

**Pros.** No weights, and genuine incomparability is expressed rather than hidden.

**Cons.** With most dimensions unsourced for three of five destinations, almost every pair is
incomparable and the answer is a near-empty relation — sophistication that produces nothing. It also
needs per-dimension orderings we do not have: *is a four-year permit better than a five-year one?*
is a question about a person's plans. **Rejected as premature**, and revisitable once every
destination has data.

### Option E — Do nothing; ship a list

**Cons.** The list has an order and users will read it as a ranking whichever way it happens to fall.
An accidental ranking is worse than a decided one, because nobody can explain it.

## Decision

**Option C. Destinations are compared, grouped and explained. No score orders them, and no total
order exists.**

Precisely:

- **Comparison is per dimension**, and each cell carries a **state**, not a number:
  `met` · `not_met` · `undetermined` · `not_applicable` · `unmodelled`. These are the states the
  evaluator already produces; the comparison layer **passes them through and never collapses them**.
- **Grouping is by binding constraint** — ADR-0022's closed set (`none`, `employability`,
  `eligibility`, `recognition`, `unmodelled`), in that order. That order is a **statement about what
  stands in the way**, not about which destination is better: `none` first because nothing blocks
  it, `unmodelled` last because we have nothing to say. **It is not a ranking and the surface must
  not present it as one.**
- **Within a group there is no ordering claim.** Destinations appear in a stable, arbitrary order —
  alphabetical by code — and the surface says so. An arbitrary order that admits it is arbitrary is
  honest; a plausible order nobody can explain is not.
- **`REMOTE` is a separate class**, compared on its own dimensions and never scored on immigration
  ones. Its immigration cells are `not_applicable`, which is a fact about `REMOTE` rather than a gap
  in our coverage — and the two must never render alike.
- **Nothing about eligibility semantics changes.** The comparison consumes normalized verdicts. No
  country-specific branch enters the evaluator, and `ai/` gains no ranking role.

### Missing data has a rule, and it is not zero

| State | Means | Never becomes |
|---|---|---|
| `undetermined` | we have the rule and not the answer | a low score, or a worse position |
| `unknown` | nothing is modelled for this pathway | a zero |
| `not_applicable` | the rule does not apply to this person or destination | a failure |
| `unmodelled` | we have ingested nothing for this destination | "poor coverage" as a verdict about the country |

**A destination is never penalised for our ignorance.** A missing salary rule for NZ says something
about Zentavio, not about New Zealand, and the surface must attribute it correctly.

### Explainability

Every cell and every grouping decision carries its evidence: the dimension, the state, the rule ids
behind it, and — where the state is `undetermined` — the input that would resolve it. The question
*"why is Germany in a different group from Luxembourg?"* is answered by the binding constraint and
its `binding_reason`, both of which already exist.

**`ai/` does not reconstruct this.** The comparison emits structured evidence; if a model ever
narrates it, it narrates that structure and invents nothing.

## Consequences

**Accepted costs.**

- **No "best destination" answer**, which is the thing a user most wants and the thing we cannot
  honestly give while three destinations have no data. The surface has to be designed to be useful
  without it.
- **The group order will be read as a ranking by some users** regardless of wording. Mitigated by
  labelling groups with what binds rather than with position, and by never numbering them.
- **A matrix is harder to render than a list**, especially on a phone, and partial coverage is most
  of what it will show at first.
- **Option B is deferred, not free.** If personal priorities are ever collected, this ADR is
  reopened rather than extended quietly.

**Follow-up work.**

- A comparison shape in `packages/types`: destinations, dimensions, per-cell state and evidence,
  group membership. No score field, enforced the way ADR-0022's is.
- A gateway route composing per-destination viability into the comparison, computing nothing new.
- NZ and CH reference files, connectors and ingested rules — the data M4 needs and does not have.
- `REMOTE`'s dimension set, which is not the country one and is currently modelled nowhere.
- `.claude/context/countries.md` gains the comparison model; `milestones.md`'s M4 row cites this ADR.

**Reversal cost.** Low and asymmetric, the same shape ADR-0022 noted. Adding a user-weighted order
later is additive — the dimensions and states are already stored. Removing a ranking after users
have chosen a country against it is not.

## Non-goals

- **No generic recommendation engine.** `recommendations/SKILL.md` governs next actions; this is a
  comparison of destinations and does not become a feed.
- **No AI-generated ranking.** A model may narrate structured results and may not produce the order.
- **No global weights**, defaulted or otherwise.
- **No change to legal eligibility semantics**, and **no country-specific evaluator branch** — the
  rule M3 established.
- **No composite score**, here or anywhere. ADR-0022's compliance rule extends to this surface.

## Compliance

- **No score field exists in the comparison shape**, and no `viability_score`-equivalent column. A
  reviewer greps; a type test asserts the absence.
- **Every cell state is one of the five**, a closed union, so a sixth is a type error.
- **The group order is data, not a sort key.** A test asserts that reordering the input destinations
  does not change grouping, and that within-group order is alphabetical rather than derived.
- **`REMOTE` never carries an immigration verdict.** A test asserts its immigration cells are
  `not_applicable` and that `not_applicable` and `unmodelled` render differently.
- **The jurisdiction-free AST test in `ai/career-roadmap/tests/` keeps passing.** If this decision
  ever requires touching the evaluator, it has been implemented wrongly.

## Related

- ADR-0022 (viability is a pair, not a score — and the source of this decision's constraint),
  ADR-0024 (routes), ADR-0025 (multi-source provenance), ADR-0002 (adding a country costs no code)
- `.claude/context/countries.md` — `REMOTE`'s model, decided before this
- `.claude/skills/recommendations/SKILL.md` — the explainability bar any ordering must clear
- `docs/roadmap/milestones.md` — M4's verification, which is about partial coverage rather than order
