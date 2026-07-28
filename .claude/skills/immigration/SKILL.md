---
name: immigration
description: How Zentavio handles immigration knowledge — tier-1-only rule sourcing, versioned dated rules, pathway modeling, eligibility evaluation, relocation viability, and the information-not-advice boundary. Load when working in knowledge-engine/immigration, ai/ paths that touch eligibility, connectors/immigration-data, adding or updating a country's rules, or answering any question about visas, work permits, residence, or citizenship.
---

# Immigration

## Purpose

Immigration is the highest-stakes knowledge in Zentavio. A wrong threshold or a stale rule can
send someone into a failed application, a lost deposit, or a relocation that collapses. This
skill exists to make that impossible by construction: tier-1 sources only, every rule dated and
versioned, and never a sentence that reads as advice.

## Scope

**Applies to:** `knowledge-engine/immigration` (rules, pathways), `connectors/immigration-data`,
any eligibility evaluation in `ai/`, and `references/countries/*`.

**Does not apply to:** whether the person is employable in that market
(`career-intelligence`), labor-market and salary data (`knowledge-engine`), how the result is
rendered (`frontend`, `.claude/context/ui-guidelines.md`).

## References

Per-country models live in `references/countries/<code>.md`. **Load the specific country file,
never the whole directory.** The country model is defined in
`.claude/context/countries.md`.

## The absolute rules

1. **Tier 1 only.** Government portals, official immigration authorities, official legal
   gazettes. Nothing else may produce a rule, threshold, timeline, or document requirement.
   Not a law firm's blog, not a relocation agency, not a forum, not the model's memory.
2. **Every rule is dated and versioned.** `effectiveFrom`, `effectiveTo`, `version`,
   `sourceUrl`, `retrievedAt`. A rule with no effective date is unusable.
3. **Never mutate a rule.** A change is a new version superseding the old. Someone planned
   against the old one.
4. **Information, never advice.** Report the sourced rule and what it implies. Never "you
   should apply for X". Always name who to consult for a decision.
5. **Unknown is the correct answer** when there is no current sourced rule — with what is
   missing. A plausible threshold is a liability, not a helpful estimate.
6. **Never generalize across jurisdictions.** Nothing about Sweden may be inferred from
   Norway. EU-level rules do not settle a member state's implementation without that state's
   own source.
7. **Stale is visible.** Past its refresh window, a rule's confidence drops and the UI says
   so. Immigration rules change on legislative timelines and must be re-checked, not trusted
   indefinitely.

## Rule model

```text
ruleId          de.eu-blue-card.salary-threshold.it
pathwayId       de.eu-blue-card
jurisdiction    ISO country code (subnational where it matters)
kind            eligibility | threshold | quota | document | timeline | condition | right
value           typed; amounts carry currency and period
appliesTo       occupation lists, qualification levels, age bands — explicit, never implied
effectiveFrom   date the rule took effect
effectiveTo     null while current
version         source's own version, or our sequence
sourceUrl       the exact official page
retrievedAt     UTC
supersedes      previous rule version id
```

## Pathway model

A pathway is a named route composed of rules:

```text
pathwayId          de.eu-blue-card
name               EU Blue Card (Germany)
rules[]            the rule ids that constitute it
stages[]           ordered: what happens, who acts, what it requires, typical duration
dependentRights    what family members may do
permanentResidency conditions and the clock
citizenship        conditions and the clock
quota              if any
officialSources[]  the tier-1 portals, and what each is authoritative for
```

Never present a visa type in isolation as a pathway. The stages, the timeline, and what it
leads to are the parts people actually plan around.

## Eligibility evaluation

Deterministic code over retrieved rules. Never an LLM judgment.

1. Retrieve the pathway's current rules as of today (or as of a stated date).
2. Evaluate each rule against the person's facts: **met**, **not met**, or **undetermined**
   (we lack a required fact about them, or we lack the rule itself).
3. `undetermined` never collapses to met or not met.
4. Output per-rule results, the overall status, what would change it, and the evidence.

```json
{
  "pathwayId": "de.eu-blue-card",
  "status": "undetermined",
  "rules": [
    { "ruleId": "de.eu-blue-card.qualification", "result": "met",
      "basis": "recognized degree on file", "sourceUrl": "…", "effectiveFrom": "2024-11-18" },
    { "ruleId": "de.eu-blue-card.salary-threshold.it", "result": "undetermined",
      "reason": "no offer salary on file; threshold known", "sourceUrl": "…" }
  ],
  "blockers": [],
  "needsFromUser": ["expected gross annual salary in EUR"],
  "confidence": "high",
  "asOf": "2026-07-28",
  "disclaimer": "Sourced official information, not legal advice. Confirm with the authority or a qualified adviser."
}
```

## Relocation viability

> **viability = eligibility × employability.** Always name the binding constraint.

Eligibility comes from here; employability from `career-intelligence`. Presenting one without
the other is misleading in a way that costs people money. Language requirement is part of
viability, not a footnote — say the level actually needed for that sector.

## Responsibilities

1. Source every rule from tier 1, with the exact URL and retrieval date.
2. Version rules; never overwrite. Keep the full history queryable.
3. Return `undetermined` with the missing input rather than guessing.
4. Attach the disclaimer to every immigration-bearing output.
5. Keep evaluation deterministic and reproducible as of a date.
6. Track refresh windows per jurisdiction and flag stale rules.
7. Emit a notification-worthy event when a rule a user depends on changes.

## Workflow

1. Read `docs/architecture/immigration.md`,
   `docs/database/entities/immigration-rule.md`, and `references/countries/<code>.md`.
2. Identify the official source and what it is authoritative for.
3. Model rules individually — one requirement per rule, never a paragraph in one row.
4. Ingest via `connectors/immigration-data` with full provenance; store the raw page.
5. Implement or extend deterministic evaluation. No LLM in the eligibility path.
6. Verify the `undetermined` path and the stale path render correctly.
7. Add the pathway's stages and timelines. Document refresh windows.
8. Update `docs/features/immigration-tracking.md` and the country reference.

## Constraints

- **No rule below tier 1.**
- **No undated or unversioned rule.**
- **No rule mutated in place.**
- **No LLM-generated rule, threshold, timeline, or document list.**
- **No advice framing.** No "you should", "we recommend applying", "you will get".
- **No inference across jurisdictions or across occupations.**
- **No collapsing `undetermined` into a yes or no.**
- **No immigration output without its disclaimer and its `asOf` date.**
- **No caching of an eligibility verdict past the rule's refresh window.**
- **No immigration status in a log line** (`docs/architecture/privacy.md`).

## Examples

**Bad.**

```python
if user.degree and user.salary > 45000:
    return {"eligible": True, "message": "You qualify for the German Blue Card — apply now!"}
```

A hardcoded threshold with no source or date, `undetermined` collapsed to `True`, advice
framing, no evidence, no disclaimer. Every one of those is a separate violation.

**Good.**

```python
rules = await knowledge.pathway_rules("de.eu-blue-card", as_of=date.today())
if not rules.current:
    return Unknown(reason="No current sourced rules for de.eu-blue-card", needs=["rule ingest"])

results = [evaluate(rule, user_facts) for rule in rules.current]   # met | not_met | undetermined
return Eligibility(
    pathway_id="de.eu-blue-card",
    status=aggregate_status(results),                # undetermined dominates
    rules=results,                                   # each with sourceUrl + effectiveFrom
    needs_from_user=[r.missing_input for r in results if r.result == "undetermined"],
    confidence=weakest(rules.confidence),
    as_of=rules.as_of,
    disclaimer=DISCLAIMER,
)
```

## Best Practices

- One requirement per rule row. Paragraph-sized rules cannot be evaluated or diffed.
- Store the raw official page alongside the parsed rule. Pages change and disappear; a claim
  with a dead link is unverifiable.
- Model what a user must *supply* as explicitly as what they must *meet* — `needsFromUser` is
  the most actionable field in the output.
- Rule changes are product events. "The threshold you were planning against changed on
  2026-01-01" is among the most valuable notifications Zentavio can send.
- When a source is ambiguous, mark the rule `contested` and say so. Never resolve an ambiguity
  by picking the friendlier reading.
- Adding a country must be additive: a reference file, connector coverage, ingested rules, a
  registry entry. If service or AI code changes, the design is wrong.
