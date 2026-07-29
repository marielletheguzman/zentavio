-- Immigration pathways (docs/database/entities/requirement.md).
--
-- First because `requirements.pathway_id` is a foreign key onto `immigration_pathways.pathway_id`,
-- and a foreign key needs its target's unique index to already exist.
--
-- Indexes are created in this same transaction rather than CONCURRENTLY, and that is a deliberate
-- departure from the review checklist in docs/database/migrations.md. CONCURRENTLY exists so that
-- building an index does not block writes on a populated table. This table is created empty in
-- this transaction: nothing can be blocked, and there is no traffic to protect. Splitting them
-- would instead open a window in which the table exists without `uq_ip__pathway_id`, which is a
-- correctness constraint and not a performance one. The rule applies to indexes added later.

CREATE TABLE immigration_pathways (
  id                  uuid        PRIMARY KEY,             -- UUIDv7, generated in the application
  pathway_id          text        NOT NULL,                -- 'de.eu-blue-card', permanent
  jurisdiction        char(2)     NOT NULL,
  name                text        NOT NULL,
  description         text,
  stages              jsonb       NOT NULL DEFAULT '[]',   -- ordered: what, who acts, requires, duration
  dependent_rights    jsonb,
  permanent_residency jsonb,                               -- conditions and the clock
  citizenship         jsonb,                               -- conditions and the clock
  quota               jsonb,
  official_sources    jsonb       NOT NULL,                -- [{url, authoritative_for}]
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- A pathway with no official source is an assertion, and this table holds only world facts.
  CONSTRAINT ck_ip__sources CHECK (jsonb_array_length(official_sources) > 0)
);

-- The foreign-key target, and the reason a pathway_id is quotable in a requirement row.
CREATE UNIQUE INDEX uq_ip__pathway_id ON immigration_pathways (pathway_id);
