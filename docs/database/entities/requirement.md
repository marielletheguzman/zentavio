# Entity: Requirement

> **Purpose:** Per-country requirement record across immigration, recognition, credential evaluation,
> authentication, language, and origin employment clearance.

**World fact, highest stakes.** A wrong threshold or a stale rule sends someone into a failed application
or a collapsed relocation. The table is shaped so that guessing is not expressible.

Generalized from `immigration_rules` by **ADR-0010**, because recognition, credential evaluation, and
origin employment clearance are decided by different authorities and are not immigration — however similar
their structure. Requirements are **rows, not branches**: there is no country conditional anywhere in
`services/` or `ai/`.

## `requirements`

```sql
CREATE TABLE requirements (
  id              uuid         PRIMARY KEY,           -- UUIDv7
  requirement_id  text         NOT NULL,              -- 'de.eu-blue-card.salary-threshold.it' — stable, permanent

  -- What kind of requirement this is, and who imposes it (ADR-0010).
  domain          text         NOT NULL,
  imposed_by      text         NOT NULL,              -- 'origin' | 'destination' | 'bilateral'
  jurisdiction    char(2)      NOT NULL,              -- the country whose authority imposes it
  subdivision     text,                               -- where a requirement is subnational

  -- Scope: an immigration requirement belongs to a pathway; a recognition requirement
  -- belongs to a profession. Enforced by ck_req__scope below.
  pathway_id      text,
  profession      text,                               -- occupation/licence scope, e.g. 'registered-nurse'

  kind            text         NOT NULL,
  value           jsonb        NOT NULL,              -- typed by kind; amounts carry currency and period
  applies_to      jsonb        NOT NULL DEFAULT '{}', -- occupation lists, qualification levels, age bands
  domain_detail   jsonb        NOT NULL DEFAULT '{}', -- documented per domain; see below
  evaluation      text         NOT NULL,              -- 'numeric-gte' | 'set-member' | 'boolean' | 'document-present' | 'manual'
  needs_input     text[]       NOT NULL DEFAULT '{}', -- person facts required to evaluate it

  -- Provenance. Tier 1 only, enforced below.
  source_tier     smallint     NOT NULL,
  source_url      text         NOT NULL,
  source_document text,                               -- the archived page in object storage
  retrieved_at    timestamptz  NOT NULL,
  authority       text         NOT NULL,              -- the body that decides — answers "who do I contact?"
  authority_url   text,                               -- that body's official page

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

  CONSTRAINT fk_req__pathways   FOREIGN KEY (pathway_id) REFERENCES immigration_pathways(pathway_id) ON DELETE RESTRICT,
  CONSTRAINT fk_req__supersedes FOREIGN KEY (supersedes) REFERENCES requirements(id)                 ON DELETE RESTRICT,

  CONSTRAINT ck_req__domain CHECK (domain IN (
    'immigration','recognition','credential','authentication','language','employment_clearance'
  )),
  CONSTRAINT ck_req__imposed_by CHECK (imposed_by IN ('origin','destination','bilateral')),
  CONSTRAINT ck_req__kind CHECK (kind IN (
    'eligibility','threshold','quota','document','timeline','condition','right','assessment'
  )),
  CONSTRAINT ck_req__evaluation CHECK (evaluation IN (
    'numeric-gte','numeric-lte','set-member','boolean','document-present','manual'
  )),
  -- Tier 1 only, for every domain. Not a preference — the schema will not hold anything else.
  CONSTRAINT ck_req__tier_one CHECK (source_tier = 1),
  -- Scope must match the domain: a visa rule has a pathway, a licence rule has a profession.
  CONSTRAINT ck_req__scope CHECK (
    (domain = 'immigration' AND pathway_id IS NOT NULL)
    OR (domain IN ('recognition','credential') AND profession IS NOT NULL)
    OR (domain IN ('authentication','language','employment_clearance'))
  ),
  CONSTRAINT ck_req__validity CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_req__contested_note CHECK (NOT contested OR contested_note IS NOT NULL)
);

-- One current version per requirement_id. A second live row is a data error.
CREATE UNIQUE INDEX uq_req__current ON requirements (requirement_id) WHERE effective_to IS NULL;
CREATE UNIQUE INDEX uq_req__id_version ON requirements (requirement_id, version);
CREATE INDEX idx_req__pathway_current ON requirements (pathway_id) WHERE effective_to IS NULL;
CREATE INDEX idx_req__profession ON requirements (profession, jurisdiction) WHERE effective_to IS NULL;
CREATE INDEX idx_req__domain ON requirements (domain, jurisdiction) WHERE effective_to IS NULL;
CREATE INDEX idx_req__asof ON requirements (requirement_id, effective_from DESC);
CREATE INDEX idx_req__stale ON requirements (refresh_after) WHERE effective_to IS NULL;
```

### The constraints that do the work

**`ck_req__tier_one`.** `source_tier = 1`, for **every** domain. Other fact tables allow tiers 1–4; this one
allows only the responsible official authority. A recognition rule from a forum is not a recognition rule
(`.claude/context/knowledge-sources.md`).

**`ck_req__scope`** is the modelling consequence acceptance surfaced: `pathway_id` could not stay
`NOT NULL`, because a licence-recognition requirement belongs to a **profession** and a destination
regulatory body, not to a visa pathway. The `CHECK` enforces the right scope per domain rather than leaving
both columns nullable and hoping.

**`authority` and `authority_url`.** The body that decides. Immigration and recognition are decided by
different bodies on different timelines, so "who do I contact?" is only answerable if the row records it —
and that is one of the most useful things this feature produces. `authority` is `NOT NULL` for that reason.

**`uq_req__current`.** Exactly one live version per `requirement_id`. Two live rows would make evaluation
non-deterministic — the evaluator would pick whichever the query returned first.

**`ck_req__contested_note`.** If a source is genuinely ambiguous, the ambiguity is written down. Never
resolved by picking the friendlier reading.

**`needs_input`.** The person facts required to evaluate this requirement. It produces `needsFromUser` in a
response — the most actionable field we return, because it converts an `undetermined` into a definite answer
with one input.

## `domain_detail` per domain

Documented shapes rather than typed columns, which is ADR-0010's accepted Option D tradeoff:

| `domain` | `domain_detail` holds |
|---|---|
| `immigration` | nothing extra today |
| `recognition` | `{ route, assessing_body, reassessment_required, bridging_options }` |
| `credential` | `{ framework, comparable_level, evaluating_body }` |
| `authentication` | `{ chain: [...], issuing_authority }` |
| `language` | `{ test, accepted_level, accepting_body }` |
| `employment_clearance` | `{ process, exemptions }` |

A domain that grows real structure gets typed columns; that is the revisit trigger in ADR-0010.

## One requirement per row

A paragraph-sized rule cannot be evaluated, diffed, or explained. If a row cannot be answered
`met` / `not_met` / `undetermined` against a person's facts, it is not yet modelled — split it.

```text
de.eu-blue-card.qualification              recognized degree or equivalent      immigration
de.eu-blue-card.salary-threshold.it        annual gross ≥ X for IT occupations  immigration
de.nursing.licence-recognition             licence assessed by <body>           recognition
de.nursing.language-requirement            <level> accepted by <body>           language
ph.overseas-employment.clearance           clearance required before departure  employment_clearance
```

The last three are what the old model could not express at all. **The values above are placeholders** —
every one must come from its authority, dated, before it is stored.

## Evaluation order

One ordered pass, and **the binding constraint is named** (ADR-0010):

```text
authentication → credential → recognition → immigration → employment_clearance → language
```

Ordered by what blocks what. An unrecognised qualification makes a visa threshold moot, so recognition is
reported **before** the visa. `undetermined` in any domain keeps the overall verdict `undetermined`; it
never collapses to a yes or a no.

**A licence-gated profession with no recognition row returns `unknown`** with recognition named — never a
visa-only verdict that reads as an answer.

## Version chains

Requirements are historical facts. A change is a **new row**, never an `UPDATE`:

```text
de.eu-blue-card.salary-threshold.it
├── id=A  version=2025.1  effective_from=2025-01-01  effective_to=2025-12-31  supersedes=null
└── id=B  version=2026.1  effective_from=2026-01-01  effective_to=null        supersedes=A
```

Three reasons this is non-negotiable:

1. A user planned against the requirement as it stood; their plan must remain explicable.
2. Every response carries `asOf` and must be reproducible as of that date.
3. "The threshold you were planning against changed on 2026-01-01" is among the most valuable
   notifications the platform sends — and it exists only if history does.

Querying as-of a date:

```sql
SELECT * FROM requirements
 WHERE (pathway_id = $1 OR profession = $2)
   AND effective_from <= $3
   AND (effective_to IS NULL OR effective_to >= $3);
```

## `immigration_pathways`

Unchanged, and still named for immigration, because a pathway genuinely is an immigration route.
Recognition requirements are **not** part of a pathway — they are scoped by profession.

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

`stages`, `permanent_residency`, and `citizenship` are what make it a pathway rather than a visa type in
isolation — they are what people actually plan around.

## Evaluation is deterministic

Code walking retrieved rows. **No LLM in this path.** Each requirement evaluates to `met`, `not_met`, or
`undetermined`, and `undetermined` produces `needsFromUser` rather than a guess.

`evaluation` and `needs_input` exist so the evaluator is generic: adding a country or a profession adds
rows, never a branch.

## Freshness

`refresh_after` is set per jurisdiction and domain from its cadence — legislative for immigration,
regulatory for recognition. Past it, confidence drops and the UI says so; `idx_req__stale` makes finding
those cheap. A verdict is never cached past the window.

## Retention

Indefinite, all versions. A superseded requirement is the explanation for an answer we gave last year.
`source_document` archives the official page, because pages change and disappear and a claim with a dead
link is unverifiable.

## Invariants

- `source_tier = 1`, in every domain.
- One live row per `requirement_id`.
- Never `UPDATE` a value — new version, `supersedes` set.
- One evaluable requirement per row.
- Scope matches domain: immigration has a pathway; recognition and credential have a profession.
- `authority` is always populated.
- `contested` requires a note.
- Every response carries `asOf` and the disclaimer — information, never advice.
- No inference across jurisdictions, professions, or domains.
- A licence-gated profession with no recognition row returns `unknown`.

## Related

- ADR-0010 — why this is one table rather than four, or a role column
- `docs/architecture/immigration.md` — the model and the evaluation contract
- `.claude/skills/immigration/SKILL.md`, `.claude/context/countries.md`
- `docs/features/immigration-tracking.md`
