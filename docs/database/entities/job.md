# Entity: Job

> **Purpose:** Canonical normalized job shape.

`job_postings` is the reconciled result of one or more sources describing the same opening. It is a
**world fact**: provenance required, never mutated in place, not personal data.

**`job_postings` and `job_posting_sources` are built** — migration `20260822233000`, repository
`packages/db/src/repositories/jobs.ts`, ADR-0034. `job_posting_skills`, `raw_payloads` and `matches`
are designed below and **not created**: a table built for data nobody writes is false completeness.

## Table

```sql
CREATE TABLE job_postings (
  id                uuid         PRIMARY KEY,          -- UUIDv7, app-generated

  -- Derived by persistence, never by a connector (ADR-0034). A connector sees one source and cannot
  -- make a claim about two.
  dedup_key         text         NOT NULL,
  -- Which derivation produced the key, and therefore what a match across sources would mean.
  -- `source-identity` matches nothing by construction: it is what a posting gets when no employer
  -- identity was available, and storing it is what makes "we did not merge this" different from
  -- "there was nothing to merge it with".
  dedup_basis       text         NOT NULL,

  title             text         NOT NULL,
  url               text         NOT NULL,          -- where a person applies (migration 20260823000500)
  company_id        uuid,                              -- null until resolved
  company_name_raw  text,                              -- what the source said, kept
  description       text,                              -- the posting's own prose, stored not read
  requirements_text text,                              -- the source's requirement lists, plain text

  location_raw      text,                              -- carried verbatim, never mined (ADR-0033)
  country_code      char(2),
  region            text,
  city              text,
  -- Nullable on purpose. NOT NULL DEFAULT false would record silence as "on site".
  is_remote         boolean,
  remote_scope      text,                              -- 'worldwide' | 'country' | 'region' | null

  employment_type   text,                              -- 'full-time' | 'contract' | ...
  seniority         text,                              -- 'entry' | 'mid' | 'senior' | 'staff' | null
  -- The source's own vocabulary, unmapped. Lever says "Regular Full Time (Salary)"; mapping that
  -- into `employment_type` is a decision nobody has made, and guessing it here would hide that.
  commitment_raw    text,
  department_raw    text,
  team_raw          text,

  salary_min        numeric(14,2),                     -- null when the source is silent
  salary_max        numeric(14,2),
  currency          char(3),
  salary_period     text,                              -- 'year' | 'month' | 'hour'
  salary_is_stated  boolean      NOT NULL DEFAULT false,

  posted_at         timestamptz,
  first_seen_at     timestamptz  NOT NULL,
  last_seen_at      timestamptz  NOT NULL,
  source_expires_at timestamptz,
  -- Derived at write time from the writing source's refresh window, so "is this still trustworthy?"
  -- is an indexed comparison rather than a computation per query.
  stale_after       timestamptz  NOT NULL,

  expired_at        timestamptz,
  -- `source-delisted` is the source's statement; `source-not-fetched` is our failure. Conflating
  -- them retires a posting somebody is tracking because our run broke (docs/architecture/data-flow.md).
  expiry_reason     text,

  -- Tier of the source that last wrote these fields. An update from a worse tier is refused, which
  -- is the invariant this column exists to make checkable rather than remembered.
  authority_tier    smallint     NOT NULL,
  confidence        text         NOT NULL,             -- 'high' | 'medium' | 'low'
  contested         boolean      NOT NULL DEFAULT false,
  -- Machine-readable notes about the row itself: `dedup-collision-unmerged` is set when a recomputed
  -- key would have collided with another live posting and the merge was refused.
  flags             text[]       NOT NULL DEFAULT '{}',

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT fk_job_postings__companies FOREIGN KEY (company_id)
    REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_postings__salary_range CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min),
  CONSTRAINT ck_job_postings__currency_with_salary CHECK ((salary_min IS NULL AND salary_max IS NULL) OR currency IS NOT NULL),
  -- A stated salary with no amounts is a parse failure wearing the flag's clothes.
  CONSTRAINT ck_job_postings__stated_salary_has_amount CHECK (salary_is_stated = false OR salary_min IS NOT NULL OR salary_max IS NOT NULL),
  CONSTRAINT ck_job_postings__confidence CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT ck_job_postings__authority_tier CHECK (authority_tier BETWEEN 1 AND 4),
  CONSTRAINT ck_job_postings__dedup_basis CHECK (dedup_basis IN ('employer-title-location','source-identity')),
  CONSTRAINT ck_job_postings__remote_scope CHECK (remote_scope IS NULL OR remote_scope IN ('worldwide','country','region')),
  -- A scope without a remote flag is a claim about a job nobody said was remote. `IS TRUE`, not
  -- `= true`: with `is_remote` null the comparison is null, and a null CHECK passes — which would
  -- have let exactly the silent-source case through.
  CONSTRAINT ck_job_postings__scope_needs_remote CHECK (remote_scope IS NULL OR is_remote IS TRUE),
  CONSTRAINT ck_job_postings__expiry_reason CHECK (
    (expired_at IS NULL AND expiry_reason IS NULL)
    OR (expired_at IS NOT NULL AND expiry_reason IN ('source-delisted','source-not-fetched'))
  ),
  CONSTRAINT ck_job_postings__seen_order CHECK (last_seen_at >= first_seen_at)
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

**`description` and `requirements_text`, stored and never read.** ADR-0033 forbids mining prose for a
salary, a country or a remote scope, and that does not change. They exist because skill extraction has
no other input: a posting ingested without them can never be extracted from without fetching it again,
and the raw payload is archived only where a document store is configured — today, nowhere. They are
**two columns** because merging them would lose which sentences were requirements and which were the
company describing itself, which is the distinction extraction depends on. `description` existed from
the table's creation and held nothing until the shared `JobPosting` type carried the field
(`20260823010000`).

**`url`, separate from `job_posting_sources.source_url`.** One is where a person applies; the other is
the endpoint the payload was read from. Conflating them sends somebody to an API response. The column
was missing from the original table and added in `20260823000500` — invisible until a runner wired the
path end to end, because the connector had been refusing unlinkable postings the whole time and
persistence was quietly discarding the link it kept.

**`dedup_basis` alongside `dedup_key`.** ADR-0034 gives deduplication to persistence, and the basis
records **what a match would have meant**. `employer-title-location` can match across sources;
`source-identity` is what a posting gets when no employer identity was available and matches nothing
by construction. Without the basis, "we did not merge this" and "there was nothing to merge it with"
are indistinguishable from the key alone.

**`is_remote` is nullable, and must stay that way.** `NOT NULL DEFAULT false` cannot express "the
source did not say", and silence recorded as `false` reads as *on site* — the same distinction
`salary_is_stated` exists to hold for pay. Lever's `workplaceType: "unspecified"` is the live case.
`ck_job_postings__scope_needs_remote` uses `IS TRUE` rather than `= true` for the matching reason: a
null comparison yields null, and a null CHECK passes.

**`authority_tier`.** The tier of the source that last wrote the fields. "Never update a field from a
lower-tier source" was an invariant nothing could check; this is what makes it checkable, and the
repository refuses the write rather than trusting a reviewer to notice.

**`commitment_raw`, `department_raw`, `team_raw`.** The source's own vocabulary, unmapped. Lever says
`"Regular Full Time (Salary)"`; mapping that into `employment_type` is a decision nobody has made, and
guessing it would hide that it is unmade.

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
  id                uuid        PRIMARY KEY,
  job_posting_id    uuid        NOT NULL,
  source_id         text        NOT NULL,        -- connector_sources.id, permanent
  -- The sub-namespace `external_id` belongs to: a Lever board slug, an ATS tenant, a country site.
  -- A board slug is a namespace and NOT an employer; nothing may resolve it to a company.
  source_scope      text        NOT NULL DEFAULT '',
  external_id       text        NOT NULL,        -- the source's own identifier, verbatim
  source_tier       smallint    NOT NULL,
  source_url        text        NOT NULL,
  retrieved_at      timestamptz NOT NULL,
  connector_version text        NOT NULL,
  run_id            uuid        NOT NULL,
  -- The archived payload this posting was read from (ADR-0021). It is the **board as served**, not
  -- this posting's bytes: a job board archives one document containing many postings, and claiming
  -- otherwise would overstate what re-reading the archive proves.
  document_id       uuid,
  -- Consecutive exhaustive runs of this scope that did not list `external_id`. Reset to zero the
  -- moment it reappears. Only an exhaustive listing may increment it — see `expireMissing`.
  missed_runs       integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_jps__job_postings FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_jps__connector_sources FOREIGN KEY (source_id) REFERENCES connector_sources(id) ON DELETE RESTRICT,
  CONSTRAINT fk_jps__documents FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE RESTRICT,
  -- Tier 5 is never stored as fact (.claude/context/knowledge-sources.md).
  CONSTRAINT ck_jps__tier CHECK (source_tier BETWEEN 1 AND 4),
  CONSTRAINT ck_jps__missed_runs CHECK (missed_runs >= 0)
);

CREATE UNIQUE INDEX uq_jps__source_scope_external ON job_posting_sources (source_id, source_scope, external_id);
CREATE INDEX idx_jps__job_posting ON job_posting_sources (job_posting_id);
-- What an expiry sweep reads: everything one source listed for one scope.
CREATE INDEX idx_jps__scope_sweep ON job_posting_sources (source_id, source_scope);
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
raw payload → normalize (pure) → validate → upsert by (source_id, source_scope, external_id)
                                    │              │
                                    │              └── dedup_key derived here, by persistence
                                    └── reject → quarantined_records (with reason)

live → missing from ≥2 consecutive **exhaustive** listings → expired_at, 'source-delisted'
     → we stopped fetching the source          → expired_at, 'source-not-fetched'
     → never hard-deleted
```

**Absence is evidence only when the listing was exhaustive.** A Lever board returns every published
posting, so a disappearance means something; a keyword search returning fewer results may mean a
ranking change, a quota or an outage. A non-exhaustive run expires nothing **and counts nothing
towards a later expiry**, because a count built from runs that were never evidence is not evidence.

A recomputed `dedup_key` that would collide with another live posting is **not merged**. The row keeps
its existing key, `contested` is set and `flags` gains `dedup-collision-unmerged`: matches,
applications and outcomes already point at both rows, and an automatic merge is unrecoverable.

An expired posting is retained: it is evidence about the market, and about the user's own application
history.

## Retention

Indefinite. Not personal data. An application linking a person to a posting is person data and lives
in its own table with its own retention (`../data-retention.md`).

## Invariants

- `dedup_key` is unique among live rows — that is what makes cross-source reconciliation one posting.
- **No connector derives `dedup_key`** (ADR-0034). `tests/unit/invariants/no-connector-dedup-key.test.ts`
  enforces it; a connector sees one source and cannot claim two postings are one job.
- Identity is `(source_id, source_scope, external_id)`, unique. The scope is a namespace and **never
  an employer** — nothing may resolve a board slug to a company.
- A missing source field is `null`. Never a default, never a market average. `is_remote` in
  particular is never defaulted to `false`.
- `expired_at` set requires `expiry_reason` set, and only an exhaustive listing may write
  `source-delisted`.
- Salary present requires `currency` present; `salary_is_stated` requires an amount.
- `source_tier` is 1–4, never 5.
- Never `UPDATE` a field to a value from a lower-tier source than the one that wrote it —
  `authority_tier` is what makes this checkable.

## Related

- ADR-0034 — identity, deduplication, expiry; the contract this table implements
- ADR-0033 — what a job-board source may claim in the first place
- `packages/db/src/repositories/jobs.ts` — the upsert, the key derivation and the expiry sweep
- `docs/architecture/connectors.md` — where `normalize` is specified
- `docs/architecture/data-flow.md` — the eight-stage lifecycle
- `connector-source.md`, `skill.md`, `match.md`
- `.claude/skills/database/SKILL.md`, `.claude/skills/job-aggregation/SKILL.md`
