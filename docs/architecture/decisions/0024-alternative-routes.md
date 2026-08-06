# ADR-0024: A pathway has routes, and a verdict names the one it used

- **Status:** Proposed
- **Date:** 2026-08-06
- **Deciders:** project lead
- **Affects:** `ai/career-roadmap`, `services/api-gateway`, `packages/types`,
  `connectors/immigration-data/de-aufenthg`, `connectors/immigration-data/de-bundesanzeiger`,
  `apps/web`, `docs/architecture/immigration.md`

## Context

**Zentavio currently tells a qualifying person they are not eligible.** This was reproduced against
the built evaluator on 2026-08-05, not inferred:

```
ISCO group 25, €47 000 gross/year, as-of 2026-08-05

STATUS: not_met
BLOCKERS: ('de.eu-blue-card.salary-threshold.general',)
  de.eu-blue-card.reduced-threshold-occupations: met      '25' against 10 permitted value(s)
  de.eu-blue-card.salary-threshold.reduced:      met      47000 against a threshold of at least 45934.2
  de.eu-blue-card.salary-threshold.general:      not_met  47000 against a threshold of at least 50700
```

§ 18g Abs. 1 S. 2 AufenthG gives that person the reduced threshold of 45,3 % — **€45 934,20 for
2026**. Every part of the rule is on file and evaluates correctly. The verdict is still wrong,
because there is nothing in the model that says the reduced threshold **replaces** the general one
rather than sitting beside it.

**The mechanism is missing in three places at once.** `Requirement` in
`ai/career-roadmap/src/career_roadmap/eligibility.py` has no `applies_to` field; the gateway's
`#inputs` maps thirteen columns and not that one; and `evaluate_pathway` conjoins every
non-`right` rule. The `requirements.applies_to` **column already exists** — `jsonb NOT NULL DEFAULT
'{}'`, migration `20260729120100` — and both connectors already write into it. It is read by
nothing.

**This is not one bug.** Every § 18g provision still unmodelled is the same shape:

| Provision | What it is |
|---|---|
| Abs. 1 S. 1 | academic qualification + 50 % threshold, **without** Bundesagentur consent |
| Abs. 1 S. 2 Nr. 1 | listed ISCO groups → 45,3 % threshold, **with** consent |
| Abs. 1 S. 2 Nr. 2 | degree obtained ≤ 3 years before application → 45,3 %, with consent |
| Abs. 1 S. 5 | a ≥ 3-year tertiary programme at ISCED 2011 / EQF level 6 counts as the qualification |
| Abs. 2 | **no** Abs. 1 qualification: ISCO 133 or 25, ≥ 3 years' experience in the last 7, 45,3 % |

Abs. 2 is the sharpest case. It opens *"Einem Ausländer, der die Voraussetzungen nach Absatz 1 nicht
erfüllt"* — **a person who does not satisfy Absatz 1**. A conjunctive model cannot express that at
all: the rule's precondition is the failure of another rule. Today the `qualification` row carries
`alternativeRouteNotModelled` in its `domainDetail` so it is not read as *"no degree means no Blue
Card"* — an honest label on a gap, and no substitute for closing it.

**Two vocabularies for the same idea are already in the data**, which is what an unread field
produces: `de-bundesanzeiger` writes `appliesTo: { category: 'general' | 'reduced' }`, and
`de-aufenthg` writes `appliesTo: { route: 'AufenthG § 18g Abs. 1 S. 1' }` — prose, in German, with a
section symbol. Whatever is decided here has to fix that too, because a route identifier that is
free text is a join key nobody can join on.

**The constraint that shapes every option.** `ai/career-roadmap` must stay jurisdiction-agnostic —
a test parses the module's AST to prove no jurisdiction is hardcoded. So routes are **data**, and
the evaluator may know that routes exist without ever knowing what Germany's are.

## Options considered

### A. Routes with any-of aggregation

A requirement may name a **route** in `applies_to`. A pathway is satisfied when **any one** of its
routes is satisfied. A requirement with no route is pathway-wide and belongs to every route. The
verdict names the route it used.

**Pros.** It is the shape the statute actually has, so all five outstanding provisions land in one
model rather than four special cases. Abs. 2's *"does not satisfy Absatz 1"* becomes ordinary — it
is a sibling route, and no rule needs to reference another rule's failure. It states something true
that nothing currently states: **which way in a person actually has**. Additive on storage —
`applies_to` exists, so no migration and no rewrite of stored rows, and a row with no route keeps
behaving exactly as it does today.

**Cons.** **The largest change of the four.** Aggregation is rewritten, the gateway gains a field,
`Verdict` gains a route and so changes a published contract, and `packages/types` and the
cross-language fixtures move with it. It introduces a genuinely new result — a route that does not
**apply** to this person is not a route they **failed** — and that distinction has to survive into
the API and the UI or it will be rendered as three rejections. It also creates a question the
conjunctive model never had: **when no route is met, whose missing inputs do we ask for?** That has
to be decided rather than emerging, and any answer is a product judgment.

### B. Grant/override — a right disables the requirement it supersedes

Read `applies_to`. When a `right` whose `grants` names another requirement evaluates `met`, disable
the requirement it supersedes.

**Pros.** Small and quick. It clears the reproduced false negative with a change confined to one
function. The connectors already emit exactly the field it needs — `de-aufenthg`'s occupation row
carries `appliesTo: { grants: 'de.eu-blue-card.salary-threshold.reduced' }`, written for this and
never read.

**Cons.** **It fixes the instance and not the class.** Abs. 2 is not a threshold swap — it is a
different route with a different qualification rule, and no amount of grant-wiring expresses *"if
Absatz 1 fails, try this instead"*. Abs. 1 S. 2 Nr. 2 would work; Abs. 1 S. 5 would not. So § 18g
would still be incomplete, and the next decision arrives immediately with a grant mechanism already
built and in the way. It also makes one rule **silently disable** another with nothing in the
verdict saying so, which is the opposite of the explainability rule: the person is told the reduced
threshold applied and never told the general one was set aside.

### C. One pathway per route

`de.eu-blue-card.general`, `de.eu-blue-card.reduced`, `de.eu-blue-card.experience`, each with its
own rows.

**Pros.** No evaluator change at all — the conjunctive model is already correct *within* a route.
Each verdict is independently explainable and independently sourced.

**Cons.** **It moves the aggregation problem to the surface without naming it.** Three verdicts for
one country, and something has to pick, so the "any route wins" rule still gets written — in
`apps/web`, in TypeScript, where the AST test does not reach and where no eligibility logic is
supposed to live. Pathway-wide rules like Abs. 3's six months are duplicated across every route, so
one statutory change becomes three edits and rows can silently disagree. And **M4 compares
destinations**, so Germany having three entries and Luxembourg one is a comparison the roadmap
cannot render honestly.

### D. Do nothing

**Pros.** None that survive the transcript above.

**Cons.** The current state emits a false negative on the most ordinary case Germany's Blue Card
has — a software professional slightly under the general threshold. It is worse than a missing
answer, because it looks like an answer. `docs/architecture/immigration.md` calls this class of
output misleading in a way that costs people money, and it gets worse with every route-shaped
provision ingested.

## Decision

**Option A.** A pathway has **routes**. A requirement may declare which route it belongs to; a
pathway is satisfied when **any one route** is satisfied; the verdict **names the route it used**
and says why the others did not apply.

The deciding argument is that Abs. 2's precondition is the failure of Abs. 1. **Only a model with
alternatives can express a rule whose trigger is another rule not applying**, and three of the five
outstanding § 18g provisions are of that shape. Option B would ship a mechanism that cannot hold
them and would have to be unpicked; Option C would write the same aggregation in the one layer that
must not contain it.

### The rules this fixes

1. **`applies_to.route` is a stable route id, scoped to its pathway** — `abs1-s1`, `abs1-s2`,
   `abs2`. Not prose, not a section symbol, not German. `de-aufenthg`'s current
   `route: 'AufenthG § 18g Abs. 1 S. 1'` and `de-bundesanzeiger`'s `category: 'general' | 'reduced'`
   both become route ids. **The legal citation stays in `domain_detail.legalBasis`, where it already
   is** — that is display text, and a join key must not be display text.
2. **A requirement with no route is pathway-wide** and is evaluated once, as part of every route.
   § 18g Abs. 3's six-month duration is exactly this. Untouched rows therefore keep today's
   behaviour, which is what makes this additive.
3. **Every route is evaluated. The person does not choose one.** A route whose conditions the person
   does not reach is **`not_applicable`** — a fourth result, distinct from `not_met`. "This way in
   is not open to you" and "you failed this test" are different sentences and the model must not
   collapse them, for the same reason ADR-0022 refuses to collapse `undetermined` into a low score.
4. **A pathway is `met` if any route is `met`.** Otherwise, if any route is `undetermined`, the
   pathway is `undetermined`. Otherwise `not_met`. It never rounds toward the friendlier answer —
   one open route keeps the whole verdict open.
5. **`needs_from_user` comes from the nearest open route**: among `undetermined` routes, the one
   needing the fewest additional inputs, ties broken by `DOMAIN_ORDER`. **The other open routes are
   still reported**, with their own inputs, so nothing is hidden — but the product asks for the
   shortest path first rather than the union of every question every route could ask. This is a
   product judgment, stated here so it is reviewable rather than emergent.
6. **Rights keep their existing semantics *within* a route** — evaluated, reported, never deciding,
   never contributing to `needs_from_user` (ADR's predecessor finding, `de-aufenthg`).
7. **No composite, no ranking of routes** beyond rule 5. A route is met or it is not; nothing scores
   how nearly. ADR-0022's argument applies unchanged.
8. **The evaluator never learns a route's meaning.** Route ids are opaque strings from data. The
   existing AST test that forbids a hardcoded jurisdiction is the guard, and it already passes over
   this module.

### What acceptance does not approve

- **No schema migration.** `requirements.applies_to` exists and is used as-is.
- **No new connector, and no new source.** § 18g's remaining provisions come from the page already
  archived.
- **Not the § 18g content itself.** This ADR decides the shape. Which provisions become rows, and
  their values, is the implementing PR's evidence to present.

## Consequences

**Accepted costs.**

- **`Verdict` is a published contract and it changes.** A route field, and `not_applicable` as a
  fourth result. `packages/types`, the cross-language fixtures, the gateway response and every
  consumer move together — the fixture guard means they fail in the same PR, which is the point of
  it, but it is still one wide change.
- **A fourth result value that surfaces must render.** `not_applicable` displayed as a rejection
  would be worse than not shipping it: a person told "you failed the experience route" when they
  hold a degree and never needed it has been told something false about themselves.
- **Aggregation is meaningfully harder to reason about.** One conjunction became a disjunction of
  conjunctions, with a tie-break rule inside it. The tests carry more weight, and rule 5 in
  particular is a judgment that will need revisiting against real usage.
- **Route explosion is now possible.** Nothing here caps how many routes a pathway may have, and a
  jurisdiction with many alternative entry classes could produce a verdict listing a dozen. No limit
  is imposed, because an invented one would hide a real rule — but it is a risk, not an oversight.
- **Route ids must stay stable across years.** The Bundesanzeiger rows are re-ingested annually with
  a new `version`; if the route id moves with them, last year's rows stop matching this year's. The
  id belongs to the *provision*, not to the announcement.
- **Two connectors must agree on a vocabulary they currently disagree on**, and both need updating
  before the evaluator can rely on either.

**Follow-up work.**

1. `applies_to.route` in `packages/types`' `SourcedRequirement`, and route ids in both German
   connectors, replacing `category` and the prose `route`.
2. The gateway carries `applies_to` — a fourteenth field in `#inputs`.
3. `Requirement` gains `applies_to`; `evaluate_pathway` groups by route and aggregates per rules 3–5;
   `Verdict` gains the route it used and the per-route outcomes.
4. `not_applicable` through `packages/types`, the fixtures, and the gateway.
5. **The § 18g provisions themselves** — Abs. 1 S. 2 Nr. 2, Abs. 1 S. 5, Abs. 2, and the
   Bundesagentur consent asymmetry (`employment_clearance`, a domain that already exists and has no
   rows).
6. `/eligibility` renders the route: which way in applies, and — without implying rejection — why
   the others do not.
7. Amend `docs/architecture/immigration.md`, and the M2 coverage paragraph in
   `docs/roadmap/milestones.md`, which still says the statute's rules are not on file.

**Reversal cost.** **Low while routes are unused; moderate afterwards.** A pathway whose rows carry
no route behaves identically before and after — rule 2 guarantees it — so reverting before any
routed rows exist is deleting a code path. After § 18g is routed, reverting means either
re-conjoining rules the statute states as alternatives, which restores the false negative, or
splitting into Option C's pathways. **The signal to revisit** is rule 5 proving wrong in practice:
if people routinely answer the nearest route's questions and end up on a different one, the
tie-break is optimising for the wrong thing and should be replaced — that is a change to one
function, and the ADR should be amended rather than superseded.

## Compliance

- **The reproduced case is a test.** ISCO group 25 at €47 000 on 2026-08-05 returns `met` via route
  `abs1-s2`. It is the transcript at the top of this ADR, asserted, so the regression cannot return
  silently.
- **A route id is never prose.** A connector test rejects any `applies_to.route` containing a space
  or `§`. The legal citation lives in `domain_detail.legalBasis`; a check asserts the two are not
  the same string.
- **A routeless pathway is unchanged.** An existing-behaviour test evaluates a pathway with no
  routed rows and asserts the verdict is identical to the conjunctive one — the property the
  reversal cost depends on.
- **`not_applicable` never becomes a blocker** and never appears in `needs_from_user`. Asserted
  directly, because a route the person cannot use is not something they can fix.
- **The evaluator stays jurisdiction-agnostic.** The existing AST test covers this module and must
  keep passing: no route id, no ISCO group, and no section number in the source.
- **The gateway passes `applies_to` through unread.** It maps the column; it does not interpret it.
  A reviewer greps `services/api-gateway` for `route` and finds nothing that branches on one.

## Related

- ADR-0010 — six domains, one table; `employment_clearance` is the domain the consent asymmetry needs
- ADR-0022 — the refusal to collapse distinct states into one value, which rule 3 applies to
  `not_applicable`
- `docs/architecture/immigration.md` — the misleading-answer standard this exists to meet
- `connectors/immigration-data/de-aufenthg/README.md` — the unmodelled provisions this unblocks
- `ai/career-roadmap/src/career_roadmap/eligibility.py` — `evaluate_pathway`, the function this
  changes
