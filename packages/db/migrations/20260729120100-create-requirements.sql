-- Requirements (docs/database/entities/requirement.md, ADR-0010).
--
-- Per-country requirements across immigration, recognition, credential evaluation, authentication,
-- language, and origin employment clearance. Requirements are rows, not branches: there is no
-- country conditional anywhere in services/ or ai/.
--
-- Most of this table's meaning is in its CHECK constraints. Each one is verified in
-- tests/integration/db/requirements-constraints.test.ts by attempting to violate it — a constraint
-- expression that parses but fails to reject is invisible on review.
--
-- Indexes are in this transaction rather than CONCURRENTLY for the reason given in
-- 20260729120000-create-immigration-pathways.sql: the table is created empty here, and
-- `uq_req__current` is a correctness constraint that must not have a window where it is absent.

CREATE TABLE requirements (
  id              uuid         PRIMARY KEY,               -- UUIDv7, generated in the application
  requirement_id  text         NOT NULL,                  -- 'de.eu-blue-card.salary-threshold.it'

  -- What kind of requirement this is, and who imposes it (ADR-0010).
  domain          text         NOT NULL,
  imposed_by      text         NOT NULL,
  jurisdiction    char(2)      NOT NULL,                  -- the country whose authority imposes it
  subdivision     text,                                   -- where a requirement is subnational

  -- Scope: an immigration requirement belongs to a pathway; a recognition requirement belongs to
  -- a profession. Enforced by ck_req__scope.
  pathway_id      text,
  profession      text,

  kind            text         NOT NULL,
  value           jsonb        NOT NULL,                  -- typed by kind; amounts carry currency and period
  applies_to      jsonb        NOT NULL DEFAULT '{}',     -- occupation lists, qualification levels, age bands
  domain_detail   jsonb        NOT NULL DEFAULT '{}',     -- documented per domain in the entity doc
  evaluation      text         NOT NULL,
  needs_input     text[]       NOT NULL DEFAULT '{}',     -- person facts required to evaluate it

  -- Provenance. Tier 1 only, enforced below.
  source_tier     smallint     NOT NULL,
  source_url      text         NOT NULL,
  source_document text,                                   -- the archived page in object storage
  retrieved_at    timestamptz  NOT NULL,
  authority       text         NOT NULL,                  -- answers "who do I contact?"
  authority_url   text,

  -- Temporal validity. This is what makes an answer reproducible.
  effective_from  date         NOT NULL,
  effective_to    date,                                   -- null while current
  version         text         NOT NULL,
  supersedes      uuid,

  contested       boolean      NOT NULL DEFAULT false,
  contested_note  text,
  refresh_after   date         NOT NULL,                  -- past this, confidence drops

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

-- One current version per requirement_id. A second live row would make evaluation
-- non-deterministic: the evaluator would use whichever row the query returned first.
CREATE UNIQUE INDEX uq_req__current ON requirements (requirement_id) WHERE effective_to IS NULL;
CREATE UNIQUE INDEX uq_req__id_version ON requirements (requirement_id, version);

CREATE INDEX idx_req__pathway_current ON requirements (pathway_id) WHERE effective_to IS NULL;
CREATE INDEX idx_req__profession ON requirements (profession, jurisdiction) WHERE effective_to IS NULL;
CREATE INDEX idx_req__domain ON requirements (domain, jurisdiction) WHERE effective_to IS NULL;
CREATE INDEX idx_req__asof ON requirements (requirement_id, effective_from DESC);
CREATE INDEX idx_req__stale ON requirements (refresh_after) WHERE effective_to IS NULL;
