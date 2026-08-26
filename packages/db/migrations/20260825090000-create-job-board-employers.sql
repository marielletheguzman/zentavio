-- `job_board_employers` — which employer operates a given board (ADR-0040).
--
-- **The algorithm was never the gap.** `docs/database/entities/company.md` already specifies
-- resolution — exact `primary_domain`, then `company_aliases.normalized`, then a new company at the
-- tier its source justifies, never fuzzy — and `companies`, `company_aliases` and
-- `normalizeCompanyAlias` all exist. What did not exist is an *input*: `company_id` and
-- `company_name_raw` are null on all 239 stored postings because a Lever posting names no employer
-- and the connector refuses to invent one from the board slug (ADR-0034, and the comment in
-- `connectors/job-boards/lever/src/parse.ts`).
--
-- A binding is therefore a **claim somebody made against a source**: this board is operated by this
-- employer, checked here, on this date. That is why the provenance columns are NOT NULL from the
-- first row rather than added when they are missed — a binding without them is indistinguishable
-- from a guess, and by then rows in `applications` and `outcomes` point at the company it produced.
--
-- **`(source_id, source_scope)`, not a board slug on its own.** A slug is unique inside one ATS and
-- means nothing across two: `zoox` on Lever and `zoox` on some future Greenhouse tenant are not the
-- same assertion. `source_scope` is the same value `job_postings` stores, empty string for a source
-- with one global namespace (ADR-0034) — never null, so the unique index needs no coalescing.
--
-- **Tier 4 is refused.** A binding is at worst the employer's own site saying where it posts jobs,
-- which is tier 2; tier 1 would be a company register. Tier 4 is aggregated or anecdotal, and an
-- employer identity is exactly the field where "somebody said so on a forum" must not be storable.
--
-- **A board that changes hands is a new row.** The old binding is soft-deleted, keeping the evidence
-- for every posting resolved under it — the same reason `companies` keeps a merged row and points it
-- forward instead of rewriting references. The unique index is partial on `deleted_at IS NULL` so
-- exactly one binding is live per board.
--
-- **What this table is not.** It does not decide which boards are read — that stays configuration
-- (`ZENTAVIO_LEVER_BOARDS`) — and it holds nothing *about* the employer. Sponsorship licences,
-- migration scores and interview process each belong to their own table; this row is a join and its
-- evidence.
--
-- The indexes are in this transaction rather than CONCURRENTLY for the reason
-- 20260729120000-create-immigration-pathways.sql gives: the table is created empty here, and
-- `uq_jbe__source_scope` is a correctness constraint — it is what makes "one live employer per
-- board" true — so a window in which it is absent is a window in which two live bindings disagree.

CREATE TABLE job_board_employers (
  id           uuid        PRIMARY KEY,             -- UUIDv7, generated in the application

  -- The connector's own `meta.id`, matching `job_postings.source_id`.
  source_id    text        NOT NULL,
  -- The board, tenant or country site the ids belong to. Empty string, never null, when the source
  -- has one global namespace — the rule ADR-0034 set for `job_postings.source_scope`.
  source_scope text        NOT NULL,
  company_id   uuid        NOT NULL,

  -- Why we believe the binding. All three NOT NULL: a binding is a sourced claim, not configuration.
  source_tier  smallint    NOT NULL,
  source_url   text        NOT NULL,
  -- When the claim was last checked. A binding decays silently — a board sold to another employer
  -- keeps serving postings under the old slug — and this column is what makes that readable.
  retrieved_at timestamptz NOT NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,

  CONSTRAINT fk_jbe__connector_sources FOREIGN KEY (source_id)
    REFERENCES connector_sources(id) ON DELETE RESTRICT,
  CONSTRAINT fk_jbe__companies FOREIGN KEY (company_id)
    REFERENCES companies(id) ON DELETE RESTRICT,

  -- ADR-0040 rule 1. Tier 4 is refused rather than merely discouraged.
  CONSTRAINT ck_jbe__tier CHECK (source_tier BETWEEN 1 AND 3),
  -- A URL, so the claim can be re-checked by opening it. Rejects a bare host, which would be a
  -- domain wearing a source's clothing.
  CONSTRAINT ck_jbe__source_url CHECK (source_url ~ '^https?://'),
  -- Empty string is the documented "one global namespace" value. Anything else is a real scope, and
  -- leading or trailing whitespace makes two spellings of one board.
  CONSTRAINT ck_jbe__source_scope CHECK (source_scope = '' OR source_scope = btrim(source_scope))
);

-- One live employer per board. Without this, two bindings disagree and ingest resolves whichever row
-- the query returned first — the wrong-merge failure `companies` exists to prevent, one level up.
CREATE UNIQUE INDEX uq_jbe__source_scope
  ON job_board_employers (source_id, source_scope) WHERE deleted_at IS NULL;

-- "Which boards belong to this employer" — the direction the backfill and the jobs surface read.
CREATE INDEX idx_jbe__company ON job_board_employers (company_id) WHERE deleted_at IS NULL;
