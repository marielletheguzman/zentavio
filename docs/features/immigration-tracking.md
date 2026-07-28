# Immigration Tracking

> **Purpose:** Visa/requirement tracking per country, deadlines.

The highest-stakes feature in the product. A wrong threshold or a stale rule sends someone into a failed
application or a collapsed relocation, so this feature is built to make guessing impossible rather than
unlikely.

**User question:** *am I actually eligible to work there, and what would it take?*

**It is information, never advice.** Zentavio reports sourced rules and their implications, and names who
to consult.

## What a user gets

1. **Pathway eligibility** — per-rule `met` / `not met` / `undetermined`, each citing its source and
   effective date.
2. **What is still needed** — the specific inputs that would resolve an `undetermined`.
3. **Stages and timelines** — what happens, who acts, what it requires, how long it typically takes.
4. **What it leads to** — permanent residency and citizenship conditions, and their clocks.
5. **Change alerts** — when a rule they depend on changes.

## Eligibility output

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
  "needsFromUser": ["expected gross annual salary in EUR"],
  "confidence": "high",
  "asOf": "2026-07-28",
  "disclaimer": "Sourced official information, not legal advice. Confirm with the authority or a qualified adviser."
}
```

**`needsFromUser` leads the UI when present.** One missing salary figure converting an `undetermined`
into a definite answer is the most actionable output the platform produces.

## Three rules that shape the feature

**Tier 1 only.** Government portals, official immigration authorities, official gazettes. Not a law firm's
blog, not a relocation agency, not a forum, not the model's memory. Enforced in schema:
`requirements` accepts `source_tier = 1` exactly.

**`undetermined` never collapses.** Not into "probably qualify", not into "likely eligible". The
evaluator's three states survive to the screen.

**Evaluation is deterministic code.** No LLM in the eligibility path. The model may restate a retrieved
rule in plain language; it may never decide one (`docs/prompts/immigration/README.md`).

## Viability, not eligibility alone

> **viability = eligibility × employability**, and the binding constraint is always named.

Visa-eligible and unemployable at the threshold salary is not an opportunity. Hirable and ineligible is
not an opportunity. Presenting one without the other is misleading in a way that costs money. Language is
part of this, not a footnote: the level actually required for that sector, stated plainly.

## Deadlines and change alerts

Real dates only — application windows, document expiry, tracked stage due dates, cohort starts. **No
manufactured urgency**, no countdowns invented to drive engagement
(`.claude/skills/recommendations/SKILL.md`).

Because rules are versioned rather than overwritten, a change is detectable and notifiable:

> The EU Blue Card IT salary threshold you were planning against changed on 2026-01-01.

That notification only exists because history does — one of the clearest payoffs of never mutating a
fact.

## Freshness

Each jurisdiction carries a refresh window matched to its legislative cadence. Past it, confidence drops
and the UI says so. A rule that has not been re-verified is never silently trusted, and an eligibility
verdict is never cached past the window.

## States

| State | Shown |
|---|---|
| **Loading** | skeleton per rule |
| **Empty** | no target country yet |
| **Undetermined** | per-rule results plus `needsFromUser` as the headline |
| **Unsupported country** | we do not cover it yet, said plainly — never a generic answer |
| **Stale** | the verdict with its date and reduced confidence, visibly flagged |
| **Blocked** | the specific rule not met, and whether anything would change it |
| **Success** | eligibility with citations, stages, and what it leads to |

## Unknown path

No current sourced rules for a pathway → `unknown` with what is missing named. Partial coverage is
honest and shippable: visa rules complete while labour-market data is `unknown` for the same country.
Invented coverage is not.

## Adding a country

A reference file, connector coverage, ingested rules, a registry entry. **Zero changes to services or AI
code** — if code must change, the design is wrong (`.claude/context/countries.md`).

## Dependencies

`knowledge-engine/immigration` · `connectors/immigration-data` · `ai/career-roadmap` (evaluation) ·
`services/notifications` (rule changes)

## Related

- `docs/architecture/immigration.md`, `docs/database/entities/requirement.md`
- `country-preferences.md`, `notifications.md`
- `.claude/skills/immigration/SKILL.md`, `.claude/context/countries.md`
