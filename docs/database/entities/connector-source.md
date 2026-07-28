# Entity: Connector Source

> **Purpose:** Source metadata and ingestion state.

One row per registered connector. This table is what lets `services/ingestion` iterate the registry
without knowing a single source's name (ADR-0002), and it holds the observed reliability that decides
tie-breaks during reconciliation.

## `connector_sources`

```sql
CREATE TABLE connector_sources (
  id                text         PRIMARY KEY,          -- 'greenhouse' — kebab-case, PERMANENT, never reused
  kind              text         NOT NULL,             -- 'job-board' | 'salary' | 'company' | 'immigration' | 'learning' | 'market'
  display_name      text         NOT NULL,
  connector_version text         NOT NULL,             -- semver of current behavior

  source_tier       smallint     NOT NULL,
  regions           char(2)[]    NOT NULL DEFAULT '{}', -- empty = global
  terms_url         text         NOT NULL,
  legal_basis       text         NOT NULL,             -- why we are permitted to fetch this

  -- Operational configuration (limits, not credentials).
  rate_limit        jsonb        NOT NULL,             -- {requests, per, burst}
  refresh_window    interval     NOT NULL,             -- how long a fact from here stays current
  schedule          text         NOT NULL,             -- cron expression; per-source cadence

  -- Observed state.
  is_enabled        boolean      NOT NULL DEFAULT true,
  reliability       numeric(4,3) NOT NULL DEFAULT 0.500,
  breaker_state     text         NOT NULL DEFAULT 'closed',  -- 'closed' | 'open' | 'half-open'
  breaker_opened_at timestamptz,
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  last_failure_kind text,
  consecutive_failures integer   NOT NULL DEFAULT 0,
  cursor            jsonb,                             -- resumable position

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT ck_cs__id_format CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_cs__kind CHECK (kind IN ('job-board','salary','company','immigration','learning','market')),
  CONSTRAINT ck_cs__tier CHECK (source_tier BETWEEN 1 AND 4),
  CONSTRAINT ck_cs__reliability CHECK (reliability >= 0 AND reliability <= 1),
  CONSTRAINT ck_cs__breaker CHECK (breaker_state IN ('closed','open','half-open')),
  CONSTRAINT ck_cs__breaker_time CHECK (breaker_state = 'closed' OR breaker_opened_at IS NOT NULL)
);

CREATE INDEX idx_cs__enabled_kind ON connector_sources (kind) WHERE is_enabled AND deleted_at IS NULL;
CREATE INDEX idx_cs__breaker ON connector_sources (breaker_state) WHERE breaker_state <> 'closed';
```

### Why `id` is `text` and not `uuid`

It is the connector's own `meta.id`, and it appears in `job_posting_sources.source_id`, in run reports,
in config keys (`connectors.<id>.*`), and in fixture directory names. A surrogate key would mean every
one of those needed a join to be readable. The tradeoff is that the id is permanent — the `CHECK` pins
the format, and renaming one is a breaking data change, not a rename.

**No credentials in this table.** Rate limits and schedules are configuration; secrets come from
`packages/config` backed by the platform secret store (`docs/architecture/security.md`).

### `reliability` is observed, never declared

```text
reliability = f(validation pass rate, uptime, freshness accuracy, outcome feedback)
```

Recomputed per run window. The tier bounds the ceiling; observation sets the value — so a tier-2 source
failing validation 30% of the time is treated as worse than its tier, and a source whose postings
repeatedly turn out dead loses reliability through the outcome loop
(`entities/outcome.md`).

It feeds reconciliation tie-breaks: equal tier, more recent, then more reliable.

### `refresh_window` drives staleness

Copied onto facts at write time as `stale_after`, so "is this still trustworthy?" is an indexed
comparison rather than a per-query computation. Immigration sources get legislative-scale windows,
salary sources annual, job boards daily.

## `ingestion_runs`

```sql
CREATE TABLE ingestion_runs (
  id              uuid         PRIMARY KEY,
  started_at      timestamptz  NOT NULL,
  finished_at     timestamptz,
  status          text         NOT NULL,          -- 'running' | 'completed' | 'failed'
  trigger         text         NOT NULL,          -- 'schedule' | 'manual' | 'backfill'
  report          jsonb        NOT NULL DEFAULT '{}',  -- per-source counts, rejects, breakers, timings
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_ir_runs__status CHECK (status IN ('running','completed','failed'))
);
CREATE INDEX idx_ingestion_runs__started ON ingestion_runs (started_at DESC);
```

Every persisted fact links to a `run_id`, so "why did this posting change on Tuesday?" is answerable.

**A run with a dead source is `completed`, not `failed`** — a partial success with a named gap. One
broken source must never fail the run (`.claude/skills/job-aggregation/SKILL.md`).

## `quarantined_records`

```sql
CREATE TABLE quarantined_records (
  id            uuid         PRIMARY KEY,
  source_id     text         NOT NULL,
  run_id        uuid         NOT NULL,
  external_id   text,
  raw           jsonb        NOT NULL,        -- exactly what arrived
  reasons       text[]       NOT NULL,        -- why validate() rejected it
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT fk_qr__sources FOREIGN KEY (source_id) REFERENCES connector_sources(id) ON DELETE RESTRICT,
  CONSTRAINT fk_qr__runs    FOREIGN KEY (run_id)    REFERENCES ingestion_runs(id)    ON DELETE RESTRICT,
  CONSTRAINT ck_qr__reasons CHECK (array_length(reasons, 1) > 0)
);
CREATE INDEX idx_qr__source_created ON quarantined_records (source_id, created_at DESC);
```

**Quarantine is not `/dev/null`.** A rejected record is stored with its reasons, because a source whose
reject rate spikes has changed format — and this table is where that becomes visible before the data
quietly degrades. Rejected records are never "fixed" by inventing a value.

Retention: 6 months (`data-retention.md`) — long enough to spot a pattern, not forever.

## `raw_payloads`

```sql
CREATE TABLE raw_payloads (
  id            uuid         PRIMARY KEY,
  source_id     text         NOT NULL,
  external_id   text         NOT NULL,
  run_id        uuid         NOT NULL,
  payload       jsonb        NOT NULL,
  payload_hash  text         NOT NULL,
  fetched_at    timestamptz  NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT fk_rp__sources FOREIGN KEY (source_id) REFERENCES connector_sources(id) ON DELETE RESTRICT
);
CREATE INDEX idx_rp__source_external ON raw_payloads (source_id, external_id, fetched_at DESC);
CREATE UNIQUE INDEX uq_rp__hash ON raw_payloads (source_id, external_id, payload_hash);
```

Kept **indefinitely**. Storage is cheap; re-fetching history is impossible. Every reconciliation rule
change wants to be re-run over the archive, and `uq_rp__hash` means an unchanged payload is not stored
twice.

Safe to retain indefinitely: this is what a *source* published about a *job*, not about a user.

## Invariants

- `id` is permanent — it is a foreign key, a config key, and a fixture path.
- `source_tier` is 1–4; a tier-5 source does not exist.
- `reliability` is written by the observer, never by hand.
- `breaker_state <> 'closed'` requires `breaker_opened_at`.
- Every quarantined record has at least one reason.
- Every fact links to the `run_id` that produced it.
- No credentials in this table.

## Related

- `docs/architecture/connectors.md` — the contract these rows describe
- `.claude/skills/connectors/SKILL.md`, `.claude/skills/job-aggregation/SKILL.md`
- `entities/job.md` (`job_posting_sources`), `data-retention.md`
- ADR-0002
