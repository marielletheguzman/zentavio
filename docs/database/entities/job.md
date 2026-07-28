# Entity: Job

> **Purpose:** Canonical normalized job shape.

`job_postings` is the reconciled result of one or more sources describing the same opening. It is a
**world fact**: provenance required, never mutated in place, not personal data.

## Table

```sql
CREATE TABLE job_postings (
  id                uuid         PRIMARY KEY,          -- UUIDv7, app-generated
  dedup_key         text         NOT NULL,             -- stable derived key; see connectors.md

  title             text         NOT NULL,
  company_id        uuid,                              -- null until resolved
  company_name_raw  text,                              -- what the source said, kept
  description       text,

  location_raw      text,
  country_code      char(2),
  region            text,
  city              text,
  is_remote         boolean      NOT NULL DEFAULT false,
  remote_scope      text,                              -- 'worldwide' | 'country' | 'region' | null

  employment_type   text,                              -- 'full-time' | 'contract' | ...
  seniority         text,                              -- 'entry' | 'mid' | 'senior' | 'staff' | null

  salary_min        numeric(14,2),                     -- null when the source is silent
  salary_max        numeric(14,2),
  currency          char(3),
  salary_period     text,                              -- 'year' | 'month' | 'hour'
  salary_is_stated  boolean      NOT NULL DEFAULT false,

  posted_at         timestamptz,
  first_seen_at     timestamptz  NOT NULL,
  last_seen_at      timestamptz  NOT NULL,
  source_expires_at timestamptz,
  stale_after       timestamptz  NOT NULL,
  expired_at        timestamptz,
  expiry_reason     text,                              -- 'source-delisted' | 'source-expiry' | null

  confidence        text         NOT NULL,             -- 'high' | 'medium' | 'low'
  contested         boolean      NOT NULL DEFAULT false,
  flags             text[]       NOT NULL DEFAULT '{}',

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT fk_job_postings__companies FOREIGN KEY (company_id)
    REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_postings__salary_range CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min),
  CONSTRAINT ck_job_postings__currency_with_salary CHECK ((salary_min IS NULL AND salary_max IS NULL) OR currency IS NOT NULL),
  CONSTRAINT ck_job_postings__confidence CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT ck_job_postings__remote_scope CHECK (remote_scope IS NULL OR remote_scope IN ('worldwide','country','region'))
);

CREATE UNIQUE INDEX uq_job_postings__dedup ON job_postings (dedup_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_postings__country_posted_at ON job_postings (country_code, posted_at DESC) WHERE deleted_at IS NULL AND expired_at IS NULL;
CREATE INDEX idx_job_postings__company ON job_postings (company_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_postings__live_remote ON job_postings (is_remote, posted_at DESC) WHERE deleted_at IS NULL AND expired_at IS NULL;
CREATE INDEX idx_job_postings__stale ON job_postings (stale_after) WHERE expired_at IS NULL;
```

## Why these columns exist

**`salary_is_stated` alongside nullable salaries.** "The source published no salary" and "the source
published a salary we failed to parse" are different facts, and the second is a connector bug we need
to see. Without this flag both look like `null`.

**`company_name_raw` alongside `company_id`.** `normalize` is pure and has no registry access
(`docs/architecture/connectors.md`), so a posting arrives with a name and is resolved to a company
later. The raw string is kept permanently — it is the evidence for the resolution and the input to a
re-resolution when the alias registry improves.

**`location_raw` alongside parsed fields.** Same reasoning. Location parsing will be wrong sometimes,
and the original is what makes it fixable retroactively.

**`expiry_reason`.** Distinguishes "the source delisted it" from "we stopped fetching that source".
The second is our failure and must never expire a user's tracked postings
(`docs/architecture/data-flow.md`).

**`contested`.** Two equal-tier sources disagreeing on a field. Kept visible rather than averaged into
an invented middle.

**`stale_after`.** Derived at write time from the source's refresh window, so "is this posting still
trustworthy?" is an indexed comparison rather than a computation.

## Relationships

| Table | Cardinality | Purpose |
|---|---|---|
| `job_posting_sources` | 1:N | which sources contributed, with each one's tier and `external_id` |
| `job_posting_skills` | 1:N | requirements, each with a weight and how it was determined |
| `companies` | N:1 | resolved employer, nullable until resolution |
| `raw_payloads` | 1:N | every raw payload that contributed, kept forever |
| `matches` | 1:N | derived scores against this posting |

```sql
CREATE TABLE job_posting_sources (
  id              uuid        PRIMARY KEY,
  job_posting_id  uuid        NOT NULL,
  source_id       text        NOT NULL,        -- connector_sources.id, permanent
  external_id     text        NOT NULL,        -- the source's own identifier
  source_tier     smallint    NOT NULL,
  source_url      text        NOT NULL,
  retrieved_at    timestamptz NOT NULL,
  connector_version text      NOT NULL,
  run_id          uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_jps__job_postings FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE RESTRICT,
  CONSTRAINT ck_jps__tier CHECK (source_tier BETWEEN 1 AND 4)
);

-- Re-ingesting the same posting from the same source is a no-op, not a duplicate.
CREATE UNIQUE INDEX uq_jps__source_external ON job_posting_sources (source_id, external_id);
```

`ck_jps__tier` between 1 and 4 is the schema-level expression of "tier 5 is never stored as fact"
(`.claude/context/knowledge-sources.md`).

```sql
CREATE TABLE job_posting_skills (
  id              uuid        PRIMARY KEY,
  job_posting_id  uuid        NOT NULL,
  skill_id        uuid        NOT NULL,
  weight          numeric(4,3) NOT NULL,        -- importance for this posting
  basis           text        NOT NULL,         -- 'stated-requirement' | 'description-extraction' | 'market-frequency'
  is_required     boolean     NOT NULL DEFAULT true,
  source_span     text,                         -- the sentence it came from, when extracted
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_jpsk__job_postings FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_jpsk__skills       FOREIGN KEY (skill_id)       REFERENCES skills(id)       ON DELETE RESTRICT,
  CONSTRAINT ck_jpsk__weight CHECK (weight >= 0 AND weight <= 1)
);

CREATE UNIQUE INDEX uq_jpsk__posting_skill ON job_posting_skills (job_posting_id, skill_id);
```

`basis` is what lets a match explain *why* a requirement counted, and at what strength. A weight
without a basis cannot be defended to a user.

## Lifecycle

```text
raw payload → normalize (pure) → validate → reconcile by dedup_key → job_postings row
                                    │
                                    └── reject → quarantined_records (with reason)

live → not seen in N runs of a source that should list it → expired_at, expiry_reason
     → never hard-deleted
```

An expired posting is retained: it is evidence about the market, and about the user's own application
history.

## Retention

Indefinite. Not personal data. An application linking a person to a posting is person data and lives
in its own table with its own retention (`data-retention.md`).

## Invariants

- `dedup_key` is unique among live rows — that is what makes cross-source reconciliation one posting.
- A missing source field is `null`. Never a default, never a market average.
- `expired_at` set requires `expiry_reason` set.
- Salary present requires `currency` present.
- `source_tier` is 1–4, never 5.
- Never `UPDATE` a field to a value from a lower-tier source than the one that wrote it.

## Related

- `docs/architecture/connectors.md` — where `dedup_key` and `normalize` are specified
- `docs/architecture/data-flow.md` — the eight-stage lifecycle
- `entities/connector-source.md`, `entities/skill.md`, `entities/match.md`
- `.claude/skills/database/SKILL.md`, `.claude/skills/job-aggregation/SKILL.md`
