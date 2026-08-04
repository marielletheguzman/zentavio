-- Applications and outcomes (docs/database/entities/application.md, outcome.md, ADR-0019).
--
-- ADR-0019 decided that outcome recording begins at M2 rather than M1, because a prediction is only
-- checkable against a result if the prediction was recorded when it was made. **Calibration data
-- cannot be backfilled** — every evaluation served before this table exists is a prediction whose
-- accuracy nobody will ever be able to measure.
--
-- Both tables land together: an outcome's `application_id` is the thing it happened to, and
-- outcomes without applications would record results with no subject.
--
-- ## Three deliberate deferrals, each recorded rather than silent
--
-- `applications.job_posting_id` and `applications.match_id` are nullable and carry **no foreign key
-- constraint**, because `job_postings` and `matches` belong to M4. The columns exist now so the
-- data has somewhere to go; the constraints are added when their tables do. `application.md`
-- records this. A migration that invented those tables early would be worse — they would be
-- designed against no reader.
--
-- `application_events` is **not created here.** It records (status, occurred_at, source) per stage
-- transition, which is the same timeline `outcomes.kind` already covers for the application
-- lifecycle. Writing both would mean every transition stored twice with no constraint keeping them
-- consistent, and ADR-0019 makes `outcomes` the canonical record. It lands when the UI shows a
-- person their own application history, which is not M2.

CREATE TABLE applications (
  id                uuid         PRIMARY KEY,          -- UUIDv7
  user_id           uuid         NOT NULL,

  -- No foreign keys: `job_postings` and `matches` are M4. See the header.
  job_posting_id    uuid,                              -- null when applied outside Zentavio
  match_id          uuid,
  company_id        uuid,                              -- resolved where known
  external_role     text,                              -- free-form title when there is no posting row

  status            text         NOT NULL,             -- current stage; history is in `outcomes` for now
  applied_at        timestamptz,                       -- what `outcomes.elapsed_days` measures from
  closed_at         timestamptz,

  -- What we said at the time, so the outcome can calibrate it.
  predicted_score   numeric(5,4),
  scorer_version    text,

  -- Migration context, since it is the point of the product for these users.
  required_sponsorship        boolean NOT NULL DEFAULT false,
  sponsorship_status_at_apply text,
  country_code      char(2),

  source            text         NOT NULL,             -- 'zentavio' | 'user-recorded' | 'imported'
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  -- RESTRICT, not CASCADE, like every other user-owned table: erasure clears person data in a
  -- known order recorded in erasure.ts, not as an emergent property of the schema.
  CONSTRAINT fk_applications__users     FOREIGN KEY (user_id)    REFERENCES users(id)     ON DELETE RESTRICT,
  CONSTRAINT fk_applications__companies FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,

  CONSTRAINT ck_applications__status CHECK (status IN (
    'saved','applied','screening','interviewing','offered','accepted','rejected','withdrawn','expired'
  )),
  CONSTRAINT ck_applications__source CHECK (source IN ('zentavio','user-recorded','imported')),
  -- A posting row or a typed-in role: one of the two must identify what was applied to. An
  -- application to nothing in particular cannot be calibrated against anything.
  CONSTRAINT ck_applications__identifies_role CHECK (job_posting_id IS NOT NULL OR external_role IS NOT NULL),
  -- A score with no scorer is uncalibratable: nothing records which code produced it.
  CONSTRAINT ck_applications__predicted CHECK (predicted_score IS NULL OR scorer_version IS NOT NULL)
);

CREATE INDEX idx_applications__user_status ON applications (user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_applications__open ON applications (user_id, applied_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_applications__company ON applications (company_id) WHERE deleted_at IS NULL;

-- What actually happened, and what we had predicted when it did.
--
-- **The only table that survives erasure by detachment.** `user_id` is nulled and the row is kept,
-- because the contribution is no longer personal and destroying it would destroy the calibration
-- the platform's honesty depends on (docs/database/data-retention.md).
CREATE TABLE outcomes (
  id                uuid         PRIMARY KEY,          -- UUIDv7

  -- Nulled on erasure. Everything below survives as an anonymous contribution.
  user_id           uuid,
  application_id    uuid,

  kind              text         NOT NULL,
  occurred_at       timestamptz  NOT NULL,
  occurred_month    date         NOT NULL,             -- month-truncated; what aggregation reads

  -- The pattern: what was attempted, from where, in which market.
  career_id         uuid,
  target_career_id  uuid,
  company_id        uuid,
  country_code      char(2),
  seniority         text,
  was_relocation    boolean      NOT NULL DEFAULT false,
  was_career_change boolean      NOT NULL DEFAULT false,

  -- What we predicted at the time. This is the whole reason the table exists: the loop only closes
  -- if we recorded what we *said* before we learned what happened.
  predicted_score   numeric(5,4),
  predicted_kind    text,                              -- 'job_match' | 'readiness' | 'viability'
  scorer_version    text,
  knowledge_as_of   timestamptz,

  -- Bounded, non-identifying context.
  elapsed_days      integer,                           -- from applications.applied_at to this outcome
  skill_snapshot    jsonb        NOT NULL DEFAULT '[]', -- [{skillId, status}] — ids only, no text
  source            text         NOT NULL,
  confidence        text         NOT NULL,

  anonymized_at     timestamptz,                       -- set when user_id is detached
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_outcomes__users        FOREIGN KEY (user_id)          REFERENCES users(id)        ON DELETE RESTRICT,
  CONSTRAINT fk_outcomes__applications FOREIGN KEY (application_id)   REFERENCES applications(id) ON DELETE RESTRICT,
  CONSTRAINT fk_outcomes__career       FOREIGN KEY (career_id)        REFERENCES careers(id)      ON DELETE RESTRICT,
  CONSTRAINT fk_outcomes__target       FOREIGN KEY (target_career_id) REFERENCES careers(id)      ON DELETE RESTRICT,
  CONSTRAINT fk_outcomes__company      FOREIGN KEY (company_id)       REFERENCES companies(id)    ON DELETE RESTRICT,

  CONSTRAINT ck_outcomes__kind CHECK (kind IN (
    'applied','screened','interviewed','offered','rejected','withdrawn',
    'accepted','started','relocated','course_completed','assessment_passed'
  )),
  CONSTRAINT ck_outcomes__source CHECK (source IN ('user-reported','inferred','platform-observed')),
  CONSTRAINT ck_outcomes__confidence CHECK (confidence IN ('high','medium','low')),
  -- Detachment is a state, not a guess: anonymized means no subject, and a subject means not
  -- anonymized. A row claiming both, or neither, is a privacy claim nobody can verify.
  CONSTRAINT ck_outcomes__anonymized CHECK ((anonymized_at IS NULL) = (user_id IS NOT NULL)),
  -- An uncalibratable prediction is not worth recording: without the scorer version, nothing says
  -- which code produced the number.
  CONSTRAINT ck_outcomes__predicted CHECK (predicted_score IS NULL OR scorer_version IS NOT NULL),
  -- The month must be the truncated form of the instant, or aggregation reads a different period
  -- than the row describes.
  CONSTRAINT ck_outcomes__month CHECK (occurred_month = date_trunc('month', occurred_at)::date)
);

CREATE INDEX idx_outcomes__user ON outcomes (user_id, occurred_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_outcomes__pattern ON outcomes (target_career_id, country_code, kind, occurred_month);
CREATE INDEX idx_outcomes__transition ON outcomes (career_id, target_career_id, kind) WHERE was_career_change;
CREATE INDEX idx_outcomes__calibration ON outcomes (scorer_version, kind) WHERE predicted_score IS NOT NULL;
