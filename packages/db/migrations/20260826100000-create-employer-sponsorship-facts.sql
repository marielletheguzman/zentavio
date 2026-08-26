-- `employer_sponsorship_facts` — what is known about an employer's migration support.
--
-- Specified in full by `docs/database/entities/employer-sponsorship.md` before this migration
-- existed, and deferred twice on purpose: ADR-0039 said *"its key does not exist"* and ADR-0040 said
-- *"this gives it a key; what may be stored against that key is a later slice's work."* This is that
-- slice, and it builds the table only — `employer_migration_scores` stays unbuilt, because a derived
-- composite needs its factor list and its scorer version decided first, which is the shape of
-- question ADR-0022 and ADR-0037 both answered with an ADR rather than a migration.
--
-- **One row per (company, jurisdiction, claim), versioned rather than updated.** A sponsor licence
-- lapses, a policy changes, and the old fact stays true of the date it described. Superseding keeps
-- the history that an UPDATE would destroy — the pattern `requirements` established for rules.
--
-- **Support is per country, so `jurisdiction` is part of the key.** An employer that sponsors in the
-- UK may sponsor nowhere else, and a single "sponsors: yes" attribute on `companies` would be a
-- claim about the world that no source ever made.
--
-- ## Why every status column drags provenance with it
--
-- An unsourced sponsorship claim is the most damaging fabrication available in this repository:
-- somebody reads it, applies, and moves their expectations about where they will live. So
-- `ck_esf__stated_needs_url` requires a stated claim to point at where it was stated, and
-- `ck_esf__inferred_needs_support` requires an inference to carry its sample size and window —
-- "probably sponsors" from one observed outcome and from forty are different facts, and a column
-- that cannot tell them apart will be read as the stronger one.
--
-- ## `inferred_likely` is confined to the two sources ADR-0039 reserved it for
--
-- ADR-0039 rule 3: *"`inferred_likely` may not be written from prose at all. It is reserved for
-- registry membership or aggregated outcomes."* `ck_job_postings__no_inferred_sponsorship` enforces
-- that on the posting side by refusing the value outright, because a posting has only prose.
--
-- This table is the place the value was reserved *for*, so refusing it here would be wrong. What is
-- refused instead is inferring it from the prose sources: `ck_esf__inferred_source_kind` allows
-- `inferred_likely` only with `official_register` or `observed_outcome`. Without it the reservation
-- would survive on `job_postings` and evaporate here, one table away, which is how a rule that
-- everybody agrees with stops being true.
--
-- ## `source_kind` is a closed set of four, and the absent fifth is the point
--
-- **No `third_party_listing`.** Aggregator "we think they sponsor" pages are not a source
-- (`docs/features/migration-friendly-jobs.md`).
--
-- **And no column, in any form, for the nationality of an employer's staff.** Inferring hiring
-- history from individuals' names, photos or profiles is discriminatory processing of data about
-- people who are not users (`docs/architecture/privacy.md`). The legitimate substitute is
-- `source_kind = 'observed_outcome'` — sponsorship we recorded ourselves, aggregated.
--
-- The indexes are in this transaction rather than CONCURRENTLY for the reason
-- 20260729120000-create-immigration-pathways.sql gives: the table is created empty here, and
-- `uq_esf__current` is a correctness constraint — it is what makes "one live fact per claim" true —
-- so a window in which it is absent is a window in which two live facts contradict each other.

CREATE TABLE employer_sponsorship_facts (
  id             uuid         PRIMARY KEY,          -- UUIDv7, generated in the application

  company_id     uuid         NOT NULL,
  -- Support is per country. ISO-3166-1 alpha-2, as `requirements` and `immigration_pathways` store it.
  jurisdiction   char(2)      NOT NULL,

  -- What is asserted. A closed vocabulary: a seventh claim is a schema change and a conversation,
  -- not a string somebody writes at a call site.
  claim          text         NOT NULL,
  -- The four-valued state. `unknown` is a value and is never the same as `stated_unavailable` —
  -- "nobody said" and "they said no" send a person to different places.
  status         text         NOT NULL,
  detail         jsonb        NOT NULL DEFAULT '{}',

  -- Provenance. The tier decides whether this may be stated at all.
  -- Null when the fact was curated by hand rather than ingested; the FK holds when it is set.
  source_id      text,
  source_tier    smallint     NOT NULL,
  source_url     text,
  -- How we know, not who told us: see the note above on the four values and the absent fifth.
  source_kind    text         NOT NULL,
  retrieved_at   timestamptz  NOT NULL,

  -- An inference from aggregated outcomes has to disclose how much it aggregated.
  support_count  integer,
  support_window interval,

  effective_from date         NOT NULL,
  effective_to   date,
  supersedes     uuid,
  -- A sponsor licence can lapse. A stale claim presented as current is how somebody wastes an
  -- application, so staleness is stored rather than inferred from `updated_at`.
  refresh_after  date         NOT NULL,

  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_esf__companies FOREIGN KEY (company_id)
    REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_esf__connector_sources FOREIGN KEY (source_id)
    REFERENCES connector_sources(id) ON DELETE RESTRICT,
  CONSTRAINT fk_esf__supersedes FOREIGN KEY (supersedes)
    REFERENCES employer_sponsorship_facts(id) ON DELETE RESTRICT,

  CONSTRAINT ck_esf__claim CHECK (claim IN (
    'visa_sponsorship','work_permit_sponsorship','relocation_support',
    'immigration_assistance','dependent_support','sponsor_licence_held'
  )),
  CONSTRAINT ck_esf__status CHECK (status IN (
    'stated_available','stated_unavailable','inferred_likely','unknown'
  )),
  CONSTRAINT ck_esf__source_kind CHECK (source_kind IN (
    'official_register','employer_statement','posting_text','observed_outcome'
  )),
  CONSTRAINT ck_esf__tier CHECK (source_tier BETWEEN 1 AND 4),

  -- A stated claim must point at where it was stated, and at something openable — a bare host is a
  -- domain wearing a source's clothing.
  CONSTRAINT ck_esf__stated_needs_url CHECK (
    status NOT IN ('stated_available','stated_unavailable') OR source_url IS NOT NULL
  ),
  CONSTRAINT ck_esf__source_url CHECK (source_url IS NULL OR source_url ~ '^https?://'),

  -- An inference must carry its sample size and window.
  CONSTRAINT ck_esf__inferred_needs_support CHECK (
    status <> 'inferred_likely' OR (support_count IS NOT NULL AND support_window IS NOT NULL)
  ),
  -- ADR-0039 rule 3, in the table the value was reserved for: an inference may come from a register
  -- or from aggregated outcomes, never from prose.
  CONSTRAINT ck_esf__inferred_source_kind CHECK (
    status <> 'inferred_likely' OR source_kind IN ('official_register','observed_outcome')
  ),
  -- A sample of nothing is not a sample.
  CONSTRAINT ck_esf__support_count CHECK (support_count IS NULL OR support_count > 0),

  CONSTRAINT ck_esf__validity CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- A fact may not supersede itself: the chain has to go somewhere.
  CONSTRAINT ck_esf__supersedes_self CHECK (supersedes IS NULL OR supersedes <> id)
);

-- One live fact per (company, jurisdiction, claim). Without this, two contradictory live rows exist
-- and a reader gets whichever the query returned first — the failure `uq_jbe__source_scope` prevents
-- one level up, for the same reason.
CREATE UNIQUE INDEX uq_esf__current ON employer_sponsorship_facts (company_id, jurisdiction, claim)
  WHERE effective_to IS NULL;

-- "What is known about this employer" — the direction the jobs surface reads.
CREATE INDEX idx_esf__company ON employer_sponsorship_facts (company_id) WHERE effective_to IS NULL;

-- "What has gone stale" — the direction a refresh pass reads.
CREATE INDEX idx_esf__stale ON employer_sponsorship_facts (refresh_after) WHERE effective_to IS NULL;
