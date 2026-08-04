# Immigration Architecture

> **Purpose:** Immigration rules-as-data model, per-country versioning, pathway modeling.

Immigration is the highest-stakes knowledge in Zentavio. A wrong threshold or a stale rule sends
someone into a failed application, a lost deposit, or a relocation that collapses. The architecture
makes that structurally hard rather than relying on care.

## Six domains, one table

**ADR-0010 (Accepted)** generalized `immigration_rules` into `requirements`, because a Filipino
applicant's viability depends on requirements that are **not** immigration and are decided by other
authorities:

| `domain` | Decided by | `imposed_by` |
|---|---|---|
| `immigration` | destination immigration authority | destination |
| `recognition` | destination regulatory body (e.g. a nursing board) | destination |
| `credential` | destination evaluation body, assessing an origin qualification | destination |
| `authentication` | origin authorities (apostille chain) | origin |
| `employment_clearance` | origin labour authority | origin |
| `language` | destination body, test taken at origin | bilateral |

Every row records `domain`, `imposed_by`, and the `authority` that decides — so "who do I contact?" is
answerable, which it was not before.

**The binding constraint is frequently recognition, not the visa.** A destination can be visa-accessible
while a licence is not transferable without re-assessment. So evaluation runs one ordered pass, ordered by
what blocks what:

```text
authentication → credential → recognition → immigration → employment_clearance → language
```

An unrecognised qualification makes a visa threshold moot, so recognition is reported **before** the visa.

**Still blocked on data, not schema.** The schema can now express these requirements; none are ingested.
Until a profession's recognition rules exist and are dated, a **licence-gated profession returns `unknown`**
with recognition named — never a visa-only verdict that reads as an answer. Sourcing each authority is
research (ADR-0010's follow-up), and it is the expensive part.

## Rules as data, never as code

A rule is a **row**, not a branch. There is no `if (country === 'DE')` anywhere in `services/` or
`ai/` — adding a country is a reference file, connector coverage, ingested rows, and a registry entry
(`principles.md`, multi-country by construction).

The consequence: eligibility is evaluated by walking retrieved rows, so a rule change is an ingest,
not a deployment.

## Requirement model

```text
requirementId   de.eu-blue-card.salary-threshold.it   -- stable, namespaced, permanent
domain          immigration | recognition | credential | authentication | language | employment_clearance
imposedBy       origin | destination | bilateral
authority       the body that decides, with its official page
jurisdiction    ISO country code of the imposing authority (subnational where it matters)
pathwayId       de.eu-blue-card        -- immigration domain
profession      registered-nurse       -- recognition and credential domains
kind            eligibility | threshold | quota | document | timeline | condition | right | assessment
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

> **Viability is eligibility *and* employability, with the binding constraint named** (ADR-0022).
>
> *This line read `viability = eligibility × employability` until 2026-08-04. The `×` was shorthand
> for "you need both", and reading it literally produced a question nobody could answer: eligibility
> is categorical and employability is a band, and there is no multiplication between a category and
> an interval. **No composite viability score is computed, stored, or rendered.***

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
knowledge-engine/immigration ──► curates: source tier, provenance, dating, conflict resolution
            │
            ▼
packages/db ──► stores: requirements (6 domains, versioned, dated, tier-1) + pathways
            │
            ▼
services/api-gateway ──► reads, and is the only component that does
            │
            ▼
ai/career-roadmap ──► eligibility evaluation (deterministic) × employability
            │
            ▼
services/matching ──► viability in context; services/notifications ──► rule-change alerts
```

**`knowledge-engine/` curates; `packages/db` stores** (ADR-0020, Accepted). A requirement is
queried per request, so it lives in PostgreSQL like every other row the gateway reads. What the
knowledge engine owns is everything that decides whether a fact is fit to store — which is the
expensive part of immigration knowledge, not the persistence.

*This diagram showed `knowledge-engine/immigration ──► requirements` until 2026-08-04, which
ADR-0020 contradicts.*

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
- `docs/database/entities/requirement.md`, `docs/features/immigration-tracking.md`,
  `docs/features/country-preferences.md`
- `.claude/skills/immigration/SKILL.md` and `references/countries/`
- `.claude/context/countries.md`, `.claude/context/knowledge-sources.md`
