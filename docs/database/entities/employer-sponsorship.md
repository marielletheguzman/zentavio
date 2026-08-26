# Entity: Employer Sponsorship

> **Purpose:** What is known about an employer's migration support, and the derived
> Migration-Friendly Employer Score.

Two things with different rules: **sponsorship facts** (world facts, provenance required, per employer)
and the **score** (derived, recomputable, never authoritative).

Specification: `docs/features/migration-friendly-jobs.md`.

**`employer_sponsorship_facts` is built** — migration `20260826100000`, written through
`packages/db/src/repositories/employer-sponsorship.ts`, with every constraint below exercised by
direct INSERT in `tests/integration/db/employer-sponsorship-facts.test.ts`. **Nothing writes to it
yet**: the sponsor-registry connector does not exist, no employer statement has been curated, and
`outcomes` is recorded but unread. An empty table with its rules enforced is the honest state, and
it is the same one `job_board_employers` shipped in.

**`employer_migration_scores` is still a specification.** A composite over these facts needs its
factor list and its scorer version decided first — the question ADR-0022 and ADR-0037 each answered
with an ADR rather than a migration. Nothing below it has been built.

## `employer_sponsorship_facts`

One row per (company, jurisdiction, claim). Versioned, because sponsor licences lapse and policies change.

```sql
CREATE TABLE employer_sponsorship_facts (
  id              uuid         PRIMARY KEY,          -- UUIDv7
  company_id      uuid         NOT NULL,
  jurisdiction    char(2)      NOT NULL,             -- support is per country

  claim           text         NOT NULL,             -- what is asserted
  status          text         NOT NULL,             -- the four-valued state
  detail          jsonb        NOT NULL DEFAULT '{}',

  -- Provenance. Tier decides whether this can be stated at all.
  source_id       text,                              -- connector, when ingested
  source_tier     smallint     NOT NULL,
  source_url      text,
  source_kind     text         NOT NULL,             -- how we know
  retrieved_at    timestamptz  NOT NULL,

  -- Observed-from-outcomes support needs its sample size.
  support_count   integer,
  support_window  interval,

  effective_from  date         NOT NULL,
  effective_to    date,
  supersedes      uuid,
  refresh_after   date         NOT NULL,

  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_esf__companies FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_esf__connector_sources FOREIGN KEY (source_id) REFERENCES connector_sources(id) ON DELETE RESTRICT,
  CONSTRAINT fk_esf__supersedes FOREIGN KEY (supersedes) REFERENCES employer_sponsorship_facts(id) ON DELETE RESTRICT,

  CONSTRAINT ck_esf__claim CHECK (claim IN (
    'visa_sponsorship','work_permit_sponsorship','relocation_support',
    'immigration_assistance','dependent_support','sponsor_licence_held'
  )),
  -- unknown is a value, and it is never the same as stated_unavailable.
  CONSTRAINT ck_esf__status CHECK (status IN (
    'stated_available','stated_unavailable','inferred_likely','unknown'
  )),
  CONSTRAINT ck_esf__source_kind CHECK (source_kind IN (
    'official_register','employer_statement','posting_text','observed_outcome'
  )),
  CONSTRAINT ck_esf__tier CHECK (source_tier BETWEEN 1 AND 4),
  -- An inferred claim must say what it was inferred from, and how much of it there was.
  CONSTRAINT ck_esf__inferred_needs_support CHECK (
    status <> 'inferred_likely' OR (support_count IS NOT NULL AND support_window IS NOT NULL)
  ),
  -- A stated claim must point at where it was stated.
  CONSTRAINT ck_esf__stated_needs_url CHECK (
    status NOT IN ('stated_available','stated_unavailable') OR source_url IS NOT NULL
  ),
  -- ADR-0039 rule 3, in the table the value was reserved for: an inference comes from a register or
  -- from aggregated outcomes, never from prose.
  CONSTRAINT ck_esf__inferred_source_kind CHECK (
    status <> 'inferred_likely' OR source_kind IN ('official_register','observed_outcome')
  ),
  CONSTRAINT ck_esf__support_count CHECK (support_count IS NULL OR support_count > 0),
  CONSTRAINT ck_esf__source_url CHECK (source_url IS NULL OR source_url ~ '^https?://'),
  CONSTRAINT ck_esf__validity CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_esf__supersedes_self CHECK (supersedes IS NULL OR supersedes <> id)
);

CREATE UNIQUE INDEX uq_esf__current ON employer_sponsorship_facts (company_id, jurisdiction, claim)
  WHERE effective_to IS NULL;
CREATE INDEX idx_esf__company ON employer_sponsorship_facts (company_id) WHERE effective_to IS NULL;
CREATE INDEX idx_esf__stale ON employer_sponsorship_facts (refresh_after) WHERE effective_to IS NULL;
```

### What the constraints enforce

**`ck_esf__stated_needs_url`** — a "this employer sponsors" claim must point at where it was stated. An
unsourced sponsorship claim is the single most damaging fabrication available here: someone applies, and
relocates their expectations, on it.

**`ck_esf__inferred_needs_support`** — an inference must carry its sample size and window. "Probably
sponsors" from one observed outcome and from forty are different facts.

**`ck_esf__inferred_source_kind`** — and the inference may only come from the two source kinds
ADR-0039 reserved the value for. `ck_job_postings__no_inferred_sponsorship` refuses `inferred_likely`
outright on the posting side, because a posting has only prose; this table is where the value was
reserved *to* live, so refusing it here would be wrong and permitting it from prose would let the
reservation evaporate one table away.

**`source_kind` is a closed set of four**, and the absent fifth is deliberate: **no
`third_party_listing`.** Aggregator "we think they sponsor" pages are not used
(`docs/features/migration-friendly-jobs.md`).

**No column for the nationality of an employer's staff, in any form.** Inferring hiring history from
individuals' names, photos, or profiles would be discriminatory processing of data about non-users. The
legitimate substitute is `source_kind = 'observed_outcome'` — sponsorship we recorded, aggregated
(`docs/architecture/privacy.md`).

**`refresh_after`** — a sponsor licence can lapse. A stale sponsorship claim presented as current is how a
user wastes an application, so staleness lowers confidence and is visible.

## Sponsorship on the posting

`job_postings` carries the posting-level view, because a company that sponsors generally may not sponsor
for a particular role:

```sql
ALTER TABLE job_postings
  ADD COLUMN sponsorship_status     text NOT NULL DEFAULT 'unknown',
  ADD COLUMN sponsorship_source     text,      -- 'posting_text' | 'employer_statement' | 'inherited_company'
  ADD COLUMN sponsorship_span       text,      -- the verbatim sentence, when stated in the posting
  ADD COLUMN relocation_status      text NOT NULL DEFAULT 'unknown',
  ADD COLUMN immigration_support_status text NOT NULL DEFAULT 'unknown',
  ADD CONSTRAINT ck_job_postings__sponsorship CHECK (sponsorship_status IN
    ('stated_available','stated_unavailable','inferred_likely','unknown')),
  ADD CONSTRAINT ck_job_postings__sponsorship_span CHECK (
    sponsorship_status NOT IN ('stated_available','stated_unavailable') OR sponsorship_span IS NOT NULL
  );

CREATE INDEX idx_job_postings__sponsorship ON job_postings (country_code, sponsorship_status)
  WHERE deleted_at IS NULL AND expired_at IS NULL;
```

**`DEFAULT 'unknown'` is the important part.** The default state of the world is that nobody said, and the
schema says so rather than implying absence. `sponsorship_span` requires the verbatim sentence for any
stated value, so the claim is always traceable to the posting text.

## `employer_migration_scores`

Derived. Same rules as every other derived row: evidence, versions, recomputable.

```sql
CREATE TABLE employer_migration_scores (
  id                uuid         PRIMARY KEY,
  company_id        uuid         NOT NULL,
  jurisdiction      char(2)      NOT NULL,

  score             numeric(5,4),                      -- null when too few factors are known
  status            text         NOT NULL,              -- 'scored' | 'insufficient_data'
  factors_known     smallint     NOT NULL,
  factors_total     smallint     NOT NULL,
  confidence        text         NOT NULL,

  evidence          jsonb        NOT NULL,              -- per-factor, with each fact id
  scorer_version    text         NOT NULL,
  knowledge_as_of   timestamptz  NOT NULL,
  computed_at       timestamptz  NOT NULL,

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_ems__companies FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT ck_ems__status CHECK (status IN ('scored','insufficient_data')),
  CONSTRAINT ck_ems__score_iff_scored CHECK ((status = 'scored') = (score IS NOT NULL)),
  CONSTRAINT ck_ems__evidence CHECK (jsonb_array_length(evidence) > 0),
  -- The score must disclose how much of it is known.
  CONSTRAINT ck_ems__known_disclosed CHECK (factors_known <= factors_total AND factors_known >= 0),
  -- Below the floor, no number is produced.
  CONSTRAINT ck_ems__min_factors CHECK (status = 'insufficient_data' OR factors_known >= 3)
);

CREATE UNIQUE INDEX uq_ems__company_jurisdiction ON employer_migration_scores (company_id, jurisdiction);
```

**`ck_ems__min_factors`** is the schema form of the rule that a composite built from one or two known
factors is a fabrication with a decimal point. Below three known factors the row is
`insufficient_data`, and the UI lists the known factors instead of a number.

**`factors_known` / `factors_total` are not optional.** The score is meaningless without them:
`0.62 · 3 of 6 known · low` is honest; `62/100` alone is not.

**Unknown factors are omitted, never zeroed.** A zero asserts the employer does *not* offer something.
Omission says nobody told us. Those are different claims, and only one of them is true.

**No PR or citizenship factor.** Those are destination properties and never an employer's
(`docs/GLOSSARY.md`). Including them would attribute a government decision to a company.

## Retention

World facts and derived rows: indefinite, versioned. Not personal data — these describe employers.
Superseded sponsorship facts are retained, because they explain an answer we gave last year.

## Invariants

- `unknown` is never stored as `stated_unavailable`.
- A stated claim has a `source_url`; a posting-stated claim has its verbatim span.
- An inferred claim has `support_count` and `support_window`.
- No `third_party_listing` source.
- No data about the nationality of an employer's staff, in any column.
- A score is null unless at least three factors are known, and always discloses the count.
- No PR or citizenship factor in an employer score.
- Facts are versioned, never mutated.

## Related

- `docs/features/migration-friendly-jobs.md` — the feature and its four-valued semantics
- `entities/job.md`, `entities/outcome.md` (the observed-sponsorship source), `entities/match.md`
- `docs/GLOSSARY.md` — sponsorship terminology and banned phrasings
- `.claude/context/knowledge-sources.md` — tiers
