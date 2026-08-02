-- The career a person is pursuing (docs/database/entities/user.md).
--
-- What a gap is computed against. Without it there is no "how far am I from cloud engineering",
-- only a list of skills someone happens to have.
--
-- Referenced by relationships.md and data-retention.md since before either had a definition — the
-- same gap `careers` had, closed here because M1b is the first slice that reads it.
--
-- Personal data: hard delete on erasure, wired into packages/db/src/repositories/erasure.ts in the
-- same change. A table added to the schema without a line in the erasure routine is a privacy
-- promise that quietly stopped being true.

CREATE TABLE user_targets (
  id           uuid        PRIMARY KEY,                   -- UUIDv7, generated in the application
  user_id      uuid        NOT NULL,
  career_id    uuid        NOT NULL,
  rank         smallint    NOT NULL,                      -- 1 is the primary target
  market_scope char(2),                                   -- null = global; mirrors career_skills.market_scope
  status       text        NOT NULL DEFAULT 'active',
  decided_at   timestamptz NOT NULL DEFAULT now(),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,

  -- RESTRICT, not CASCADE, like every other user-owned table: deletion order is a decision recorded
  -- in erasure.ts rather than an emergent property of the schema.
  CONSTRAINT fk_user_targets__users   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE RESTRICT,
  CONSTRAINT fk_user_targets__careers FOREIGN KEY (career_id) REFERENCES careers(id) ON DELETE RESTRICT,

  -- 'achieved' and 'abandoned' are different facts, and the difference is the whole value of the row
  -- afterwards: an achieved target is an outcome worth calibrating against, an abandoned one is
  -- evidence the plan was wrong. A boolean would lose that.
  CONSTRAINT ck_user_targets__status CHECK (status IN ('active','achieved','abandoned')),
  CONSTRAINT ck_user_targets__rank CHECK (rank >= 1)
);

-- One row per user per career, so re-targeting updates rather than accumulating duplicates.
CREATE UNIQUE INDEX uq_user_targets__user_career
  ON user_targets (user_id, career_id) WHERE deleted_at IS NULL;

-- Rank is unique only among *active* rows: abandoning a target frees its rank instead of forcing a
-- renumber of everything below it.
CREATE UNIQUE INDEX uq_user_targets__user_rank
  ON user_targets (user_id, rank) WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX idx_user_targets__user_active
  ON user_targets (user_id) WHERE deleted_at IS NULL AND status = 'active';
