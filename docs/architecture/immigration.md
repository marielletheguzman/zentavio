# Immigration Architecture

> **Purpose:** Immigration rules-as-data model, per-country versioning, pathway modeling.

Immigration is the highest-stakes knowledge in Zentavio. A wrong threshold or a stale rule sends
someone into a failed application, a lost deposit, or a relocation that collapses. The architecture
makes that structurally hard rather than relying on care.

## Open gap: origin-side rules

**The model currently assumes one jurisdiction — the destination. That is not sufficient for our primary
users.**

Zentavio's primary users are professionals and students from the Philippines
(`docs/roadmap/vision.md`). Their viability depends on requirements imposed at **origin** as well as
destination:

| Domain | Imposed by |
|---|---|
| Overseas employment regulation and clearance | origin state |
| Professional-licence recognition for regulated professions | origin licensing body, re-assessed at destination |
| Academic credential evaluation | destination body, assessing an origin qualification |
| Document authentication / apostille | origin authorities |
| Language certification acceptance | destination, but obtained at origin |

Two consequences:

1. **`immigration_rules.jurisdiction` has no way to say "this rule is imposed by the origin".** Either
   the column needs a companion `jurisdiction_role` (`origin` | `destination` | `bilateral`), or
   origin-side requirements need a distinct rule kind. Without one of those, Filipino-specific
   requirements cannot be modelled, let alone evaluated.
2. **The binding constraint is frequently recognition, not the visa.** A destination can be
   visa-accessible while a licence is not transferable without re-assessment. An eligibility verdict that
   reports only the visa would be actively misleading for a nurse, engineer, or teacher — which is worse
   than returning `unknown`.

This is a schema and evaluation decision with a real tradeoff, so it belongs in an ADR rather than being
patched in silently. Until it is resolved, **regulated professions cannot be given an eligibility
verdict** — they must return `unknown` with recognition named as the missing piece.

## Rules as data, never as code

A rule is a **row**, not a branch. There is no `if (country === 'DE')` anywhere in `services/` or
`ai/` — adding a country is a reference file, connector coverage, ingested rows, and a registry entry
(`principles.md`, multi-country by construction).

The consequence: eligibility is evaluated by walking retrieved rows, so a rule change is an ingest,
not a deployment.

## Rule model

```text
ruleId          de.eu-blue-card.salary-threshold.it   -- stable, namespaced, permanent
pathwayId       de.eu-blue-card
jurisdiction    ISO country code (subnational where it matters)
kind            eligibility | threshold | quota | document | timeline | condition | right
value           typed; amounts carry currency and period
appliesTo       occupation lists, qualification levels, age bands — explicit, never implied
effectiveFrom   date the rule took effect
effectiveTo     null while current
version         the source's own version, or our sequence
sourceUrl       the exact official page
retrievedAt     UTC
supersedes      previous rule version id
contested       true where the source is genuinely ambiguous
```

**One requirement per row.** A paragraph-sized rule cannot be evaluated, diffed, or explained. If a
row cannot be answered `met` / `not met` / `undetermined` against a person's facts, it is not yet
modeled.

**Tier 1 only.** Government portals, official immigration authorities, official gazettes. Not a law
firm's blog, not a relocation agency, not a forum, not the model's memory
(`.claude/context/knowledge-sources.md`).

## Versioning

Rules are historical facts. A changed threshold is a **new row**: new `effectiveFrom`, old row closed
with `effectiveTo` and pointed at by `supersedes`. Never an `UPDATE`.

Three reasons this is non-negotiable:

1. A user planned against the rule as it stood. Their plan must remain explicable.
2. An answer must be reproducible **as of the date it was given** — `asOf` is part of every response.
3. "The threshold you were planning against changed on 2026-01-01" is among the most valuable
   notifications the platform can send, and it only exists if history does.

```text
de.eu-blue-card.salary-threshold.it
├── v2025.1  effectiveFrom 2025-01-01  effectiveTo 2025-12-31   superseded
└── v2026.1  effectiveFrom 2026-01-01  effectiveTo null         current
```

## Pathway model

A pathway is a **named route composed of rules**:

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

A visa type presented in isolation is not a pathway. The stages, the timeline, and what it leads to
are what people actually plan around.

## Eligibility evaluation

**Deterministic code over retrieved rows. Never an LLM judgment.**

```text
1  retrieve the pathway's rules as of today (or as of a stated date)
2  evaluate each rule against the person's facts → met | not_met | undetermined
3  undetermined never collapses to met or not_met
4  aggregate: undetermined dominates; not_met produces a named blocker
5  return per-rule results, what would change them, the evidence, and the disclaimer
```

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

`needsFromUser` is the most actionable field in the response: it converts an `undetermined` into a
definite answer with one input, and it is what `recommendations` surfaces as a next action.

## Relocation viability

> **viability = eligibility × employability.** The binding constraint is always named.

Eligibility comes from here. Employability comes from `ai/career-roadmap` — readiness, market demand,
and the language level actually required for that sector. Presenting one without the other is
misleading in a way that costs people money:

- visa-eligible and unemployable at the threshold salary is **not** an opportunity
- hirable and ineligible is **not** an opportunity

## Where components sit

```text
connectors/immigration-data ──► raw official pages (kept)
            │
            ▼
knowledge-engine/immigration ──► rules (versioned, dated, tier-1) + pathways
            │
            ▼
ai/career-roadmap ──► eligibility evaluation (deterministic) × employability
            │
            ▼
services/matching ──► viability in context; services/notifications ──► rule-change alerts
```

The LLM appears nowhere in the eligibility path. It may summarize a retrieved rule for display; it may
never decide one.

## Freshness

Rules change on legislative timelines, so each jurisdiction carries a refresh window. Past its window
a rule's confidence drops and the UI says so. A rule that has not been re-verified is not silently
trusted, and an eligibility verdict is never cached past the window.

## Information, never advice

Zentavio reports sourced rules and their implications, and names who to consult. Every immigration
output carries its `asOf` date and its disclaimer. No "you should apply", no "you will get", no
predicted approval.

## Constraints

- No rule below tier 1.
- No undated or unversioned rule.
- No rule mutated in place.
- No LLM-generated rule, threshold, timeline, or document list.
- No advice framing.
- No inference across jurisdictions or occupations — Sweden is not inferred from Norway; an EU-level
  rule does not settle a member state's implementation.
- No collapsing `undetermined` into yes or no.
- No output without `asOf` and the disclaimer.
- No cached verdict past the refresh window.
- No immigration status in a log line (`privacy.md`).

## Related

- `knowledge-engine.md`, `principles.md` (multi-country), `privacy.md`
- `docs/database/entities/immigration-rule.md`, `docs/features/immigration-tracking.md`,
  `docs/features/country-preferences.md`
- `.claude/skills/immigration/SKILL.md` and `references/countries/`
- `.claude/context/countries.md`, `.claude/context/knowledge-sources.md`
