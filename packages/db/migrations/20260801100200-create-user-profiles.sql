-- Parsed résumé results, versioned (docs/database/entities/user.md).
--
-- **No résumé document column, deliberately.** The uploaded file is parsed and then discarded
-- (docs/architecture/data-flow.md, docs/features/resume-parsing.md). The parsed profile is the
-- asset; the file is a liability. Adding a column for it later would be a privacy decision
-- disguised as a schema change.
--
-- Versioned rather than updated in place, so a score computed last month can be reproduced against
-- the profile as it stood. A readiness number whose inputs have silently moved is not reproducible,
-- and every score in this system is supposed to be explainable on demand.

CREATE TABLE user_profiles (
  id                uuid          PRIMARY KEY,           -- UUIDv7, generated in the application
  user_id           uuid          NOT NULL,
  version           integer       NOT NULL,
  is_current        boolean       NOT NULL DEFAULT true,

  headline          text,

  -- Stored because sources state it, and deliberately NOT used to determine seniority: years are a
  -- proxy for skills measured directly (.claude/context/career-philosophy.md).
  years_experience  numeric(4,1),

  current_career_id uuid,                                -- resolved track, nullable until resolved
  seniority         text,
  languages         jsonb         NOT NULL DEFAULT '[]', -- [{code, cefr, basis}]

  parsed_from       text,                                -- 'resume-upload' | 'manual' | 'import'
  parser_version    text,
  parsed_at         timestamptz,

  -- Drives confidence downstream. A sparse profile must produce a low-confidence answer rather
  -- than a confident one computed from very little.
  completeness      numeric(4,3),

  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  -- RESTRICT, not CASCADE: erasure is an explicit operation that clears person data in a known
  -- order (docs/database/data-retention.md), not a side effect of deleting an account row.
  CONSTRAINT fk_user_profiles__users   FOREIGN KEY (user_id)           REFERENCES users(id)   ON DELETE RESTRICT,
  CONSTRAINT fk_user_profiles__careers FOREIGN KEY (current_career_id) REFERENCES careers(id) ON DELETE RESTRICT,

  CONSTRAINT ck_user_profiles__completeness CHECK (completeness IS NULL OR (completeness >= 0 AND completeness <= 1)),
  CONSTRAINT ck_user_profiles__version CHECK (version >= 1),
  CONSTRAINT ck_user_profiles__parsed_from CHECK (parsed_from IS NULL OR parsed_from IN ('resume-upload','manual','import'))
);

-- Exactly one live profile per user. Partial on both `is_current` and `deleted_at`, so an older
-- version and a soft-deleted one do not collide with the current row. Without this, two rows can
-- claim to be current and every downstream read picks arbitrarily.
CREATE UNIQUE INDEX uq_user_profiles__current ON user_profiles (user_id) WHERE is_current AND deleted_at IS NULL;

-- Version numbers are dense per user and never reused, including after a soft delete — so this is
-- deliberately NOT partial. Reusing a version would make "the profile as it stood at v3" ambiguous.
CREATE UNIQUE INDEX uq_user_profiles__version ON user_profiles (user_id, version);
