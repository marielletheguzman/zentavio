# Entity: Immigration Rule

> **Purpose:** Per-country rule/requirement record.

**World fact, highest stakes.** A wrong threshold or a stale rule sends someone into a failed
application or a collapsed relocation. The table is shaped so that guessing is not expressible.

Rules are **rows, not branches** — there is no country conditional anywhere in `services/` or `ai/`
(`docs/architecture/immigration.md`).

## `immigration_rules`

```sql
CREATE TABLE immigration_rules (
  id              uuid         PRIMARY KEY,           -- UUIDv7
  rule_id         text         NOT NULL,              -- 'de.eu-blue-card.salary-threshold.it' — stable, permanent
  pathway_id      text         NOT NULL,              -- 'de.eu-blue-card'
  jurisdiction    char(2)      NOT NULL,              -- SEE GAP BELOW: currently assumes the destination
  subdivision     text,                               -- where a rule is subnational

  kind            text         NOT NULL,
  value           jsonb        NOT NULL,              -- typed by kind; amounts carry currency and period
  applies_to      jsonb        NOT NULL DEFAULT '{}', -- occupation lists, qualification levels, age bands — explicit
  evaluation      text         NOT NULL,              -- how it is checked: 'numeric-gte' | 'set-member' | 'boolean' | 'document-present' | 'manual'
  needs_input     text[]       NOT NULL DEFAULT '{}', -- person facts required to evaluate it

  -- Provenance. Tier 1 only, enforced below.
  source_tier     smallint     NOT NULL,
  source_url      text         NOT NULL,
  source_document text,                               -- the archived page in object storage
  retrieved_at    timestamptz  NOT NULL,
  authority       text         NOT NULL,              -- the issuing body

  -- Temporal validity. This is what makes an answer reproducible.
  effective_from  date         NOT NULL,
  effective_to    date,                               -- null while current
  version         text         NOT NULL,
  supersedes      uuid,

  contested       boolean      NOT NULL DEFAULT false,
  contested_note  text,
  refresh_after   date         NOT NULL,              -- past this, confidence drops

  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_ir__pathways   FOREIGN KEY (pathway_id) REFERENCES immigration_pathways(pathway_id) ON DELETE RESTRICT,
  CONSTRAINT fk_ir__supersedes FOREIGN KEY (supersedes) REFERENCES immigration_rules(id)            ON DELETE RESTRICT,

  CONSTRAINT ck_ir__kind CHECK (kind IN ('eligibility','threshold','quota','document','timeline','condition','right')),
  CONSTRAINT ck_ir__evaluation CHECK (evaluation IN ('numeric-gte','numeric-lte','set-member','boolean','document-present','manual')),
  -- Tier 1 only. Not a preference — the schema will not hold anything else.
  CONSTRAINT ck_ir__tier_one CHECK (source_tier = 1),
  CONSTRAINT ck_ir__validity CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_ir__contested_note CHECK (NOT contested OR contested_note IS NOT NULL)
);

-- One current version per rule_id. A second live row for the same rule is a data error.
CREATE UNIQUE INDEX uq_ir__current ON immigration_rules (rule_id) WHERE effective_to IS NULL;
CREATE UNIQUE INDEX uq_ir__rule_version ON immigration_rules (rule_id, version);
CREATE INDEX idx_ir__pathway_current ON immigration_rules (pathway_id) WHERE effective_to IS NULL;
CREATE INDEX idx_ir__asof ON immigration_rules (rule_id, effective_from DESC);
CREATE INDEX idx_ir__stale ON immigration_rules (refresh_after) WHERE effective_to IS NULL;
```

### The constraints that do the work

**`ck_ir__tier_one`.** `source_tier = 1`, not `BETWEEN 1 AND 4`. Every other fact table allows tiers
1–4; this one allows only government portals, official immigration authorities, and official gazettes.
A law firm's blog post cannot be written here, and neither can an LLM's recollection
(`.claude/context/knowledge-sources.md`).

**`uq_ir__current`.** Exactly one live version per `rule_id`. Two live rows would make eligibility
non-deterministic — the evaluator would pick whichever the query returned first.

**`ck_ir__contested_note`.** If a source is genuinely ambiguous, the ambiguity must be written down.
Never resolved by picking the friendlier reading.

**`needs_input`.** The person facts required to evaluate this rule. It is what produces
`needsFromUser` in an eligibility response — the most actionable field we return, because it converts
an `undetermined` into a definite answer with one input.

## Open gap: `jurisdiction` assumes the destination

Zentavio's primary users are from the Philippines, and their viability depends on **origin-imposed**
requirements — overseas employment regulation, professional-licence recognition, credential evaluation,
document authentication — as much as on destination rules. This table cannot currently express one.

**ADR-0010 (Proposed)** recommends more than a role column: generalizing this table into `requirements`
with `domain`, `imposed_by`, and `authority`. A `jurisdiction_role` column alone would leave a table named
`immigration_rules` holding requirements set by a nursing board and by an origin labour authority, and no
place to record which authority decides — so "who do I contact?" would stay unanswerable.

If accepted, this document is renamed to `requirement.md`.

**Until then, regulated professions must return `unknown`** with recognition named as the missing piece,
rather than a visa-only verdict that reads as an answer.

## One requirement per row

A paragraph-sized rule cannot be evaluated, diffed, or explained. If a row cannot be answered
`met` / `not_met` / `undetermined` against a person's facts, it is not yet modeled — split it.

```text
de.eu-blue-card.qualification            recognized degree or equivalent
de.eu-blue-card.salary-threshold.it      annual gross ≥ X for IT occupations
de.eu-blue-card.salary-threshold.general annual gross ≥ Y otherwise
de.eu-blue-card.contract-duration        employment contract ≥ 6 months
de.eu-blue-card.documents                the required document set
```

## Version chains

Rules are historical facts. A change is a **new row**, never an `UPDATE`:

```text
de.eu-blue-card.salary-threshold.it
├── id=A  version=2025.1  effective_from=2025-01-01  effective_to=2025-12-31  supersedes=null
└── id=B  version=2026.1  effective_from=2026-01-01  effective_to=null        supersedes=A
```

Three reasons this is non-negotiable:

1. A user planned against the rule as it stood; their plan must remain explicable.
2. Every eligibility response carries `asOf`, and must be reproducible as of that date.
3. "The threshold you were planning against changed on 2026-01-01" is among the most valuable
   notifications the platform sends — and it exists only if history does.

Querying as-of a date:

```sql
SELECT * FROM immigration_rules
 WHERE pathway_id = $1
   AND effective_from <= $2
   AND (effective_to IS NULL OR effective_to >= $2);
```

## `immigration_pathways`

```sql
CREATE TABLE immigration_pathways (
  id                  uuid        PRIMARY KEY,
  pathway_id          text        NOT NULL,      -- 'de.eu-blue-card', permanent
  jurisdiction        char(2)     NOT NULL,
  name                text        NOT NULL,
  description         text,
  stages              jsonb       NOT NULL DEFAULT '[]',  -- ordered: what, who acts, requires, duration
  dependent_rights    jsonb,
  permanent_residency jsonb,                              -- conditions and the clock
  citizenship         jsonb,                              -- conditions and the clock
  quota               jsonb,
  official_sources    jsonb       NOT NULL,               -- [{url, authoritative_for}]
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ip__sources CHECK (jsonb_array_length(official_sources) > 0)
);
CREATE UNIQUE INDEX uq_ip__pathway_id ON immigration_pathways (pathway_id);
```

`stages`, `permanent_residency`, and `citizenship` are what make it a pathway rather than a visa type
in isolation — they are what people actually plan around.

## Evaluation

Deterministic code walking retrieved rows. **No LLM in this path.** Each rule evaluates to `met`,
`not_met`, or `undetermined`, and `undetermined` never collapses into a yes or a no — it produces
`needsFromUser` instead.

`evaluation` and `needs_input` exist so the evaluator is generic: adding a country adds rows, never a
branch.

## Freshness

`refresh_after` is set per jurisdiction from its legislative cadence. Past it, confidence drops and the
UI says so; `idx_ir__stale` makes finding those cheap. A rule that has not been re-verified is never
silently trusted, and an eligibility verdict is never cached past the window.

## Retention

Indefinite, all versions. A superseded rule is the explanation for an answer we gave last year.
`source_document` archives the official page, because pages change and disappear and a claim with a
dead link is unverifiable.

## Invariants

- `source_tier = 1`, always.
- One live row per `rule_id`.
- Never `UPDATE` a value — new version, `supersedes` set.
- One evaluable requirement per row.
- `contested` requires a note.
- Every response carries `asOf` and the disclaimer — information, never advice.
- No inference across jurisdictions: Sweden is not derived from Norway; an EU-level rule does not
  settle a member state's implementation.

## Related

- `docs/architecture/immigration.md` — the model and the evaluation contract
- `.claude/skills/immigration/SKILL.md`, `references/countries/_TEMPLATE.md`
- `.claude/context/countries.md`, `.claude/context/knowledge-sources.md`
- `docs/features/immigration-tracking.md`
