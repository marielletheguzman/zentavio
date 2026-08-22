-- `connector_sources` — one row per registered connector (entities/connector-source.md).
--
-- **Built now because `learning_resources` cannot be built without it.** Its documented
-- `fk_lr__sources` points here, and shipping the learning tables with that constraint dropped would
-- put a weaker rule in the database than the entity file states — the class of drift
-- `documentation is part of the change` exists to prevent.
--
-- **The immigration connectors do not use it yet, and that is deliberate.** They carry provenance on
-- the requirement row itself (`source_url`, `source_tier`, `retrieved_at`) and predate this table.
-- Backfilling them is a separate change with its own reasoning; adding rows here now would claim an
-- integration that does not exist.
--
-- No credentials here. Rate limits and schedules are configuration; secrets come from
-- `packages/config` (docs/architecture/security.md).

CREATE TABLE connector_sources (
  -- The connector's own `meta.id`, not a surrogate. It appears in run reports, config keys and
  -- fixture directory names, so a uuid would mean a join to make any of them readable. The cost is
  -- that the id is permanent: renaming one is a breaking data change, and the CHECK pins the shape.
  id                text         PRIMARY KEY,
  kind              text         NOT NULL,
  display_name      text         NOT NULL,
  connector_version text         NOT NULL,

  source_tier       smallint     NOT NULL,
  regions           char(2)[]    NOT NULL DEFAULT '{}',
  terms_url         text         NOT NULL,
  -- Why we are permitted to fetch this at all. Written down because "we checked" is not a record,
  -- and the connectors skill refuses a source whose basis nobody stated.
  legal_basis       text         NOT NULL,

  rate_limit        jsonb        NOT NULL,
  -- Copied onto facts at write time as their staleness horizon, so "is this still trustworthy?" is
  -- an indexed comparison rather than a computation per query.
  refresh_window    interval     NOT NULL,
  schedule          text         NOT NULL,

  is_enabled        boolean      NOT NULL DEFAULT true,
  -- Observed, never declared. The tier bounds the ceiling; observation sets the value, so a tier-2
  -- source failing validation a third of the time is treated as worse than its tier.
  reliability       numeric(4,3) NOT NULL DEFAULT 0.500,
  breaker_state     text         NOT NULL DEFAULT 'closed',
  breaker_opened_at timestamptz,
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  last_failure_kind text,
  consecutive_failures integer   NOT NULL DEFAULT 0,
  cursor            jsonb,

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT ck_cs__id_format CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_cs__kind CHECK (kind IN ('job-board','salary','company','immigration','learning','market')),
  CONSTRAINT ck_cs__tier CHECK (source_tier BETWEEN 1 AND 4),
  CONSTRAINT ck_cs__reliability CHECK (reliability >= 0 AND reliability <= 1),
  CONSTRAINT ck_cs__breaker CHECK (breaker_state IN ('closed','open','half-open')),
  -- An open breaker with no opening time cannot be closed on a timer, so it stays open forever and
  -- the source silently disappears from every run.
  CONSTRAINT ck_cs__breaker_time CHECK (breaker_state = 'closed' OR breaker_opened_at IS NOT NULL)
);

CREATE INDEX idx_cs__enabled_kind ON connector_sources (kind) WHERE is_enabled AND deleted_at IS NULL;
CREATE INDEX idx_cs__breaker ON connector_sources (breaker_state) WHERE breaker_state <> 'closed';
