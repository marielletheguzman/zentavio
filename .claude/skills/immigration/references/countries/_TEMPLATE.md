# <Country Name> (`<ISO CODE>`)

> **Purpose:** Immigration reference model for <country>. Defines which pathways exist, which
> rules constitute them, and which official sources are authoritative. **Values live in
> `knowledge-engine/immigration`, not here.**

_Status: placeholder — content to be authored._

---

## Official sources (tier 1 only)

| Source | Authoritative for | URL | Refresh window |
|---|---|---|---|
| <authority name> | pathway eligibility, thresholds | <official URL> | <e.g. quarterly> |
| <statistical office> | salary data, labor market | <official URL> | <e.g. annually> |

Nothing below tier 1 may produce a rule for this country. See
`.claude/context/knowledge-sources.md`.

## Language

- **Official language(s):**
- **Workplace reality by sector:** (what teams actually use — sourced, not assumed)
- **Required level per pathway:** (CEFR where applicable)
- **English-only career viability:** by sector, with the basis for the claim

Language is part of relocation viability, not a footnote. State the level actually needed.

## Pathways

For each pathway:

### `<pathwayId>` — <Name>

- **Who it is for:**
- **Constituent rules:** (rule ids in `knowledge-engine/immigration`)
  - `<code>.<pathway>.qualification`
  - `<code>.<pathway>.salary-threshold[.<occupation-class>]`
  - `<code>.<pathway>.language`
  - `<code>.<pathway>.documents`
- **Occupation lists:** where they live, how often they change
- **Stages:** ordered — what happens, who acts, what it requires, typical duration
- **Dependent rights:**
- **Permanent residency:** conditions and the clock
- **Citizenship:** conditions and the clock
- **Quota:** if any
- **Known ambiguities:** where sources are unclear (mark rules `contested`)

## Qualification recognition

How foreign qualifications are assessed, by which body, and whether recognition is a
prerequisite or a parallel process.

## Labor market

- **Demand by career/skill:** (sourced)
- **Hiring difficulty:** and what makes it hard
- **Sponsorship prevalence:** do employers here actually sponsor?
- **Typical hiring timeline:**
- **Preferred certifications:**

## Compensation

- **Where salary data comes from** (tier 1, or tier 2 with a named methodology)
- **Transparency rules:** is salary disclosure mandated?
- **Bonus/equity norms:**

Figures live in `knowledge-engine`. Do not write bands here.

## Cost and living

Cost of living (by city where it differs materially) · housing reality · taxation (brackets,
social contributions, treaties) · healthcare (access model, cost, waiting period for arrivals).

## Culture and process

- **Interview norms:**
- **Resume conventions:** photo, length, personal details — these differ sharply and getting
  them wrong costs interviews
- **Notice period norms:**
- **Working hours norms:**

## Gotchas

Country-specific traps that cost applicants time or money. Each with its source.

## Related

- `.claude/context/countries.md` — the full country model
- `.claude/skills/immigration/SKILL.md` — the rules that govern this data
- `docs/architecture/immigration.md`, `docs/database/entities/immigration-rule.md`
