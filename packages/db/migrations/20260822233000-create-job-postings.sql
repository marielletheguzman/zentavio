-- `job_postings` and `job_posting_sources` — ADR-0034 (entities/job.md).
--
-- The Lever connector (#141) has produced normalized postings since it merged and had nowhere to put
-- them. This is that destination, and it encodes ADR-0034's contract rather than the design that
-- preceded it — two parts of which do not survive contact with a real source and are corrected here.
--
-- **Identity is a triple, not a pair.** The designed `uq (source_id, external_id)` is correct only
-- where a source's ids are unique across its whole namespace. A source numbering postings per
-- employer would collide two different jobs into one row, and the collision would look like
-- successful deduplication. `source_scope` — a Lever board slug, an ATS tenant — is the namespace,
-- empty string when the source has one, never null so the unique index needs no coalescing.
--
-- **`is_remote` cannot default to false.** "The source did not say" and "this job is on site" are
-- different facts, and Lever's `workplaceType: "unspecified"` produces the first. The column is
-- nullable for the same reason `salary_is_stated` exists beside nullable salaries.
--
-- **What is deliberately not here.** `job_posting_skills`, `raw_payloads` and `matches` are designed
-- in entities/job.md and belong to the slices that read them; a table built for data nobody writes is
-- false completeness. `applications.job_posting_id` still carries no foreign key — pointing it here
-- is a change to a live table with its own ON DELETE decision, and it is recorded as follow-up rather
-- than smuggled into a table creation.

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
  company_id        uuid,                              -- null until resolved
  company_name_raw  text,                              -- what the source said, kept
  description       text,

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

-- Which sources contributed this posting, and under which of their own identifiers.
--
-- One row per (source, scope, external id). Re-ingesting the same posting from the same source is an
-- update, not a duplicate — the unique index below is what makes that true rather than intended.
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
