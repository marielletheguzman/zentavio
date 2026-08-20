# ADR-0024: A pathway has routes, and a verdict names the one it used

- **Status:** Accepted
- **Accepted:** 2026-08-06
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
6. **Gates are ANY; conditions are ALL.** A **gate** (`kind: right`) answers *may this person
   attempt this route*. A **condition** answers *do they satisfy it*. The two questions are
   answered independently: any one gate opens the route, and every condition must then hold.

   **A route is one legal consequence.** § 18g Abs. 1 S. 2 does not create two routes — it creates
   one outcome, the reduced salary threshold, reachable through either a listed occupation *or* a
   degree earned within three years. Modelling those as separate routes would duplicate the salary
   and qualification rules beneath both and break the one-to-one relation between a route id and a
   legal outcome, which is what makes a stable id worth having.

   A route with no met gate and no unanswered one is `not_applicable`, and the reason names every
   gate that was tried. A route with an unanswered gate is `undetermined` — never closed, because
   a way in nobody has asked about has not been ruled out.

   *Amended twice during implementation, both times against a false result the original wording
   produced.* The first wording said rights never decide within a route, which hands the reduced
   threshold to every occupation. The second required all gates, which denies every recent graduate
   outside the listed ISCO groups. What survives from the original guarantee is the part that was
   always right — **a right never blocks the pathway**, because another route can carry it, and
   **a pathway with no routed rows keeps today's behaviour exactly**, where rights are reported and
   never decide.
7. **No composite, no ranking of routes** beyond rule 5. A route is met or it is not; nothing scores
   how nearly. ADR-0022's argument applies unchanged.
8. **The evaluator never learns a route's meaning.** Route ids are opaque strings from data. The
   existing AST test that forbids a hardcoded jurisdiction is the guard, and it already passes over
   this module.
9. **Route identifiers are stable, and changing one is a breaking data change.** Not a rename, not a
   documentation edit. Stored rows, superseded versions and any recorded outcome referencing a route
   all key on it, and the Bundesanzeiger rows are re-ingested every year against ids that must still
   match. **Legal wording may change without the id changing** — that is the point of separating the
   id from `domain_detail.legalBasis`. A provision that genuinely becomes a different route gets a
   new id and the old one is superseded, never edited in place.
10. **The evaluator never invents a route.** Every route it reports came from connector data. It may
    group by route, aggregate across routes, and compare them. It may **not** generate an id, infer
    a route that no row declares, or derive one from a legal citation. A pathway whose rows declare
    no route has exactly one implicit route — the pathway itself — and that is rule 2, not an
    invention.

**On the vocabulary, stated exactly.** The requirement-level `Result` is
`met | not_met | undetermined`, and this ADR adds `not_applicable` to it — **`not_met`, not
`unmet`**. The pathway-level `Status` is `met | not_met | undetermined | unknown`; `unknown` stays
pathway-only and keeps its existing meaning (nothing on file, or a licence-gated profession with no
recognition rule). `not_applicable` is **not** added to `Status`: a pathway with no applicable route
is `not_met` for this person, and saying otherwise would let "no way in exists for you" read as "we
have no data".

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

1. ~~`applies_to.route` in `packages/types`' `SourcedRequirement`, and route ids in both German
   connectors, replacing `category` and the prose `route`.~~ **Done** — `abs1-s1` / `abs1-s2`.
2. ~~The gateway carries `applies_to` — a fourteenth field in `#inputs`.~~ **Done.**
3. ~~`Requirement` gains `applies_to`; `evaluate_pathway` groups by route and aggregates per rules
   3–5; `Verdict` gains the route it used and the per-route outcomes.~~ **Done.**
4. ~~`not_applicable` through `packages/types`, the fixtures, and the gateway.~~ **Done**, including
   the label `apps/web` renders for it — *"Does not apply to you"*, never "not met".
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
- **No route id is constructed in `ai/` or `services/`.** Route ids appear only in connector source
  and in stored rows. A reviewer greps both trees for a string-built route; the AST test that
  forbids a hardcoded jurisdiction covers the evaluator's half.
- **A routeless pathway is unchanged.** An existing-behaviour test evaluates a pathway with no
  routed rows and asserts the verdict is identical to the conjunctive one — the property the
  reversal cost depends on.
- **`not_applicable` never becomes a blocker** and never appears in `needs_from_user`. Asserted
  directly, because a route the person cannot use is not something they can fix.
- **The evaluator stays jurisdiction-agnostic.** The existing AST test covers this module and must
  keep passing: no route id, no ISCO group, and no section number in the source.
- **The gateway passes `applies_to` through unread.** It maps the column; it does not interpret it.
  A reviewer greps `services/api-gateway` for `route` and finds nothing that branches on one.

## Amendment — 2026-08-20: any-of conditions

- **Status:** Accepted
- **Accepted:** 2026-08-20
- **Raised by:** Luxembourg's EU Blue Card, Art. 45 (2) f) of the loi du 29 août 2008
- **Evidence base:** one statute. Germany, New Zealand and Switzerland do not need this
  mechanism, so rule 10 is justified by Luxembourg alone — a narrower base than ADR-0025 had
  when Luxembourg forced `requirement_sources`, and stated here rather than left to be found.

**The decision above is unchanged.** Routes, gates and rules 1–9 all stand. This adds one mechanism
they do not cover, and it is written before the implementation rather than discovered inside it.

### What Luxembourg exposed

Art. 45 (1) 2. requires *"les qualifications professionnelles élevées"*. Art. 45 (2) d) defines those
as sanctioned **either** by a higher-education diploma **or** by *"compétences professionnelles
élevées"*, and (2) f) defines those two ways:

- **f) i)** ICT managers and specialists — CITP-08 groups `133` or `25` — with *"au moins trois ans
  d'expérience professionnelle pertinente au cours des sept années précédant la demande"*;
- **f) ii)** *"en ce qui concerne les autres professions"* — at least **five years**.

**One condition. Three ways to satisfy it.** They are not separate legal consequences: same permit,
same salary rule, same everything downstream. And Luxembourg's existing routes — `general` and
`citp-1-2` — are **salary** routes, so the qualification limbs are orthogonal to them.

### Why neither existing mechanism holds it

**Not routes.** Rule 6 says *"a route is one legal consequence"*. Making each limb a route would need
the cross-product — three limbs × two salary routes — duplicating the salary and qualification rules
beneath all six and breaking the one-to-one relation between a route id and a legal outcome that
rule 6 exists to protect. Rule 9 then makes that a **breaking data change** to undo.

**Not gates.** Gates are the right disjunction and the wrong sentence. Rule 3: a route with no met
gate is **`not_applicable`** — *"this way in is not open to you"*. A person holding no degree and no
qualifying experience has not met a closed door. **They failed the qualification requirement, and
that is `not_met`.** Telling them otherwise misdescribes their own case, which is the error class
`docs/architecture/immigration.md` calls the most costly output this product produces.

**Germany never surfaced this** because § 18g bundles qualification and threshold per Absatz, so its
alternatives genuinely are separate legal consequences. Luxembourg carries the same EU directive
article with a different statutory shape, and the shape is what the model has to hold.

### The amendment

**10. A condition may belong to an `any-of` group, and the group is satisfied by any one member.**

```jsonc
applies_to: { anyOf: 'qualification' }   // a stable group id, scoped to its pathway
```

- **Members are alternatives to each other, and the group is one condition** wherever conditions are
  aggregated. Nothing else in rule 6's ALL-semantics changes: the group contributes one result.
- **`met`** if any member is `met`. Otherwise **`undetermined`** if any member is `undetermined` —
  an unanswered alternative is never a failure. Otherwise **`not_met`**, and only when *every*
  member is `not_met`.
- **`not_applicable` members are excluded from the group** before it is decided. A member that does
  not apply can neither satisfy the condition nor fail it. A group whose every member is
  `not_applicable` is itself `not_applicable`.
- **`needs_from_user` comes from the nearest member** — the `undetermined` one needing fewest
  additional inputs, ties broken by `DOMAIN_ORDER`. This is rule 5 applied one level down, and for
  the same product reason: ask for the shortest path first, report the rest.
- **The blocker names the group, not an arbitrary member.** A person who fails all three is not told
  *"you lack a degree"* — they are told the qualification condition is unmet and by which means it
  could have been met.
- **Group ids obey rules 1, 8 and 9 unchanged**: a stable id scoped to its pathway, never prose,
  never constructed in `ai/` or `services/`, and changing one is a breaking data change.
- **A group may sit inside a route**, and a member may carry its own route or — under ADR-0029 — its
  own origin scope. Group membership and route membership are independent scopes on the same row.

**Choosing between a gate and an any-of group has one test, and it is the failure sentence.** If
failing every alternative means *"this way in is not open to you"*, it is a gate. If it means
*"you did not satisfy this requirement"*, it is an any-of group. Anything else — which reads more
naturally, which is fewer rows — is not a reason.

### Consequences

**Accepted costs.**

- **A second disjunction mechanism.** The real risk is not the code; it is a contributor picking the
  wrong one. The failure-sentence test above is the mitigation, and it is stated as a rule rather
  than as advice.
- **The evaluator changes**, so this is not free and not additive-by-construction the way rule 2 was.
  A groupless pathway must behave exactly as today — see Compliance.
- **A one-member group must be indistinguishable from an ungrouped condition.** That identity is
  what makes the mechanism safe to adopt gradually, and it is asserted rather than assumed.
- **Luxembourg's salary rows will need re-scoping.** `lu.eu-blue-card.salary-threshold.general` and
  `.reduced` currently sit on `general` / `citp-1-2`; once qualification is a group rather than a
  route dimension, those routes mean *only* salary. **That is a change to stored `requirement_id`s'
  `applies_to`, and it should happen once, in the implementing change.**

**Follow-up work.**

- `any-of` support in `evaluate_pathway`, with the aggregation above.
- Validation that `applies_to.anyOf` is a non-empty string, alongside the existing route check.
- Ingest Luxembourg's Art. 45 (2) f) limbs plus the degree limb as one group, and re-scope the salary
  rows in the same change.
- `lu.md`'s qualification section updated from *"researched, not ingested"* to what was built.

**What acceptance does not approve.**

- **No schema migration.** `applies_to` is jsonb and already carries `route`; this adds a key.
- **Not a boolean expression language.** `any-of` only — **no nesting, no negation, no all-of
  group.** A rule needing those is a new decision, not an extension of this one. ADR-0029's open
  exemption-versus-inclusion question is precisely such a case and stays open.
- **Not the Luxembourg content.** Which limbs become rows, and their values, is the implementing
  change's evidence to present.

**Reversal cost.** Low while one pathway uses it: delete the key and the group members become
ordinary ALL-conditions, which changes verdicts — so reversal is a data change, not only a code one.
The signal to reverse is a second mechanism arriving that subsumes it.

### Compliance

- **A one-member group is identical to no group.** Asserted directly: same verdict, same
  `needs_from_user`, same blockers.
- **A group is `not_met` only when every member is.** Asserted with a three-member group where one
  member is `undetermined`, which must keep the group `undetermined`.
- **`not_applicable` members are excluded**, and an all-`not_applicable` group is `not_applicable` —
  never `not_met`. This is rule 3's distinction applied inside the group.
- **A groupless pathway is unchanged.** The existing-behaviour test that rule 2 relies on extends to
  cover groups, and must produce a byte-identical verdict.
- **The blocker names the group.** Asserted, because naming one arbitrary member is the failure mode
  that would make the output wrong in exactly the way this amendment exists to prevent.
- **The evaluator stays jurisdiction-agnostic.** The existing AST test must keep passing: no group
  id, no ISCO or CITP group, no article number in the source.
- **The gateway passes `applies_to` through unread**, as it already does for `route`.

## Related

- ADR-0010 — six domains, one table; `employment_clearance` is the domain the consent asymmetry needs
- ADR-0022 — the refusal to collapse distinct states into one value, which rule 3 applies to
  `not_applicable`
- `docs/architecture/immigration.md` — the misleading-answer standard this exists to meet
- `connectors/immigration-data/de-aufenthg/README.md` — the unmodelled provisions this unblocks
- `ai/career-roadmap/src/career_roadmap/eligibility.py` — `evaluate_pathway`, the function this
  changes
