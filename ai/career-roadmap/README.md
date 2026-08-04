# career-roadmap

> **Purpose:** Career transition engine: readiness, transferable skills, roadmap generation.

**What is built:** `eligibility.py` — deterministic evaluation of stored requirements against a
person's facts. Readiness, transferable skills, and roadmap generation are **not** built; readiness
lives in `ai/skill-gap` today.

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

## Not yet wired

Nothing calls this. The gateway route that reads requirements and person facts, and the web surface
that renders the verdict, are what remain for M2.

## Related

- `docs/architecture/immigration.md` — the evaluation contract this implements
- ADR-0010 (six domains, one table), ADR-0002 (rules as rows, never branches)
- `packages/db/src/repositories/requirements.ts` — `requirementsAsOf`, the query that feeds this
