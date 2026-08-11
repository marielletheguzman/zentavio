# career-roadmap

> **Purpose:** Career transition engine: readiness, transferable skills, roadmap generation.

**What is built:** `eligibility.py` — deterministic evaluation of stored requirements against a
person's facts — and `main.py`, its HTTP surface. Readiness, transferable skills, and roadmap
generation are **not** built; readiness lives in `ai/skill-gap` today.

## No model in this path

`docs/architecture/immigration.md`: an LLM may summarise a retrieved rule for display; it may never
decide one. Every function here is comparison over data the caller supplies. There are no runtime
dependencies at all — no model client, no database driver.

## Generic by construction

The evaluator branches on a requirement's `evaluation` field, never on its jurisdiction. Adding a
country adds rows, never a branch (ADR-0002).

**A test enforces this by parsing the module's AST** and asserting no country code, country name, or
pathway id appears as a string literal or identifier. Docstrings are exempt, because naming the
motivating example is legitimate — and a guard that fires on prose is one that gets deleted for
being noisy rather than fixed.

## The three rules that carry the value

1. **`undetermined` never collapses** into `met` or `not_met`. A missing fact is not a failure, and
   reporting it as one tells someone they are ineligible when they simply have not answered.
2. **`undetermined` dominates.** One unknown makes the whole verdict undetermined even when
   everything else is met. It never rounds toward the friendlier answer.
3. **Every `undetermined` names the input that would resolve it** — `needs_from_user`, which turns a
   dead end into a next action. That is M2's milestone test.

## Routes: a pathway can have more than one way in (ADR-0024)

A rule declaring `applies_to.route` belongs to that route; one declaring none is **pathway-wide** and
belongs to every route. **The pathway is `met` when any route is**, and the verdict names which.

This exists because Germany's Blue Card has two salary thresholds that are not both requirements —
they belong to different provisions. Conjoined, the higher one always bound, and an ISCO-25
professional earning €47 000 was told `not_met` when § 18g Abs. 1 S. 2 makes them eligible.

| Concept | Rule |
|---|---|
| `not_applicable` | a rule on a route this person cannot use. **Never a failure, never a blocker, never a question.** |
| a `right` | a **gate**: it opens the route it belongs to. It never blocks the pathway — another route can carry it. |
| **gates are ANY** | one met gate opens the route. § 18g Abs. 1 S. 2 reads *"Nr. 1 oder Nr. 2"* — a listed occupation **or** a degree earned within three years, so requiring both would deny every recent graduate outside the list. |
| **conditions are ALL** | every non-`right` rule on an open route must hold. A gate says *may this person attempt this route*; a condition says *do they satisfy it*. |
| an unanswered gate | leaves the route `undetermined`, never closed. A way in nobody has asked about has not been ruled out. |
| every gate answered no | makes the route `not_applicable`, and the reason names each gate tried. |
| `needs_from_user` | comes from the **nearest open route**: the undetermined one asking fewest further questions. Every other route is still reported in full. |
| a routeless pathway | behaves exactly as it did before routes existed, asserted by test. That is what makes the model additive. |

**Route ids are opaque here.** They arrive in the data. This module never constructs one, infers
one, or branches on a particular value — an AST test keeps it that way.

## Applicability is containment, never a null end date

```python
effective_from <= as_of and (effective_to is None or as_of <= effective_to)
```

Some sources publish open-ended rules; others publish bounded ones. Germany's Blue Card salary
minimum is announced **for one calendar year**, so every stored row has an `effective_to` and none
is ever null. A query treating `effective_to IS NULL` as "current" silently excludes every annual
rule and returns an empty rule set — which reads as *"we have no requirements"* rather than as the
bug it is.

## What it refuses to do

| Refusal | Why |
|---|---|
| compare across currencies or periods | 55 000 USD against a 50 700 EUR threshold is a confident wrong answer |
| treat a non-numeric answer as zero | a coerced zero fails a threshold that was never tested |
| decide `document-present` or `manual` | one needs the document, the other needs an authority |
| answer for a licence-gated profession with no recognition rule | a visa-only verdict to a nurse whose licence does not transfer is the most harmful output this product could produce |
| return `met` for an empty rule set | nothing evaluated is `unknown`, not success |
| resolve a `contested` rule | ambiguity is written down, never settled by picking the friendlier reading |

## Confidence

`high` only when every fact relied on is `verified`. A self-reported salary is an **intention**, and
a verdict computed from one is not wrong but is less certain — saying so is cheaper than being
confidently wrong.

## The HTTP surface

```text
POST /evaluate      requirements + facts + as_of  ->  verdict
GET  /health/live
GET  /health/ready
```

**Stateless.** Requirements, facts, and the evaluation date arrive in the request; the gateway owns
the database. That keeps `ai/` free of a persistent store and makes determinism observable from
outside — a test asserts the same body twice produces the same response.

**`as_of` has no default.** A verdict without a stated date is unreproducible, so omitting it is a
422 rather than an implicit "today".

**Every eligibility outcome is a 200, including `unknown`.** An unmodelled pathway and a
licence-gated profession with no recognition rule are results the user must be *shown*, with the
reason. `4xx` stays reserved for "the caller sent something wrong", so an honest non-answer and our
own defect remain distinguishable.

`/health/ready` reports `dependencies: none` and means it — this service has no database, no model
host, and no downstream. Saying so is more useful than a check that checks nothing and implies
otherwise.

## Not yet wired

Nothing calls this. The gateway route that reads requirements and person facts, and the web surface
that renders the verdict, are what remain for M2.

## Related

- `docs/architecture/immigration.md` — the evaluation contract this implements
- ADR-0010 (six domains, one table), ADR-0002 (rules as rows, never branches)
- `packages/db/src/repositories/requirements.ts` — `requirementsAsOf`, the query that feeds this
