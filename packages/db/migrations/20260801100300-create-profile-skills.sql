-- What we believe a person can do, and why (docs/database/entities/user.md).
--
-- The `evidenced` / `claimed` distinction is what makes every downstream score honest. Without it,
-- anyone who pads a skills list inflates their own readiness and the number stops meaning anything
-- (docs/features/resume-parsing.md).
--
--   evidenced — used in a described role or project: "Led a Kubernetes migration across 40 services"
--   claimed   — listed only: a Skills section containing "Kubernetes"
--
-- `source_span` is the verbatim sentence the claim came from. It is what makes the profile
-- correctable: a user cannot disagree with an extraction they cannot see the basis for.

CREATE TABLE profile_skills (
  id                uuid        PRIMARY KEY,             -- UUIDv7, generated in the application
  user_profile_id   uuid        NOT NULL,
  skill_id          uuid        NOT NULL,
  status            text        NOT NULL,                -- 'evidenced' | 'claimed'
  evidence_kind     text,                                -- 'role' | 'project' | 'certification' | 'assessment' | 'artifact'
  source_span       text,                                -- the verbatim sentence it came from
  confidence        text        NOT NULL,                -- 'high' | 'medium' | 'low'

  -- A user correction is self-reported and outweighs an inference. Corrections are the
  -- highest-quality signal available about a profile, and they also mark where extraction is weak.
  self_reported     boolean     NOT NULL DEFAULT false,

  -- Set only by in-platform verification — an assessment or a checked artifact. Never by the
  -- parser, and never by the user saying so.
  verified_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- CASCADE here, unlike user_profiles: a profile_skills row has no meaning without its profile
  -- version, so it is part of that version rather than a record in its own right.
  CONSTRAINT fk_profile_skills__profiles FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- RESTRICT: a skill that some profile references must not vanish from the registry underneath it.
  CONSTRAINT fk_profile_skills__skills   FOREIGN KEY (skill_id)        REFERENCES skills(id)        ON DELETE RESTRICT,

  CONSTRAINT ck_profile_skills__status CHECK (status IN ('evidenced','claimed')),
  CONSTRAINT ck_profile_skills__confidence CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT ck_profile_skills__evidence_kind CHECK (
    evidence_kind IS NULL OR evidence_kind IN ('role','project','certification','assessment','artifact')
  ),

  -- The rule in schema form: an evidenced skill must say what evidences it. A row claiming
  -- `evidenced` with no `evidence_kind` cannot be written, so the distinction cannot decay into a
  -- label the parser sets optimistically.
  CONSTRAINT ck_profile_skills__evidence CHECK (status = 'claimed' OR evidence_kind IS NOT NULL),

  -- Verification is in-platform only, and in-platform verification produces evidence. A verified
  -- row that is merely `claimed` would mean the platform checked something it never recorded.
  CONSTRAINT ck_profile_skills__verified_is_evidenced CHECK (verified_at IS NULL OR status = 'evidenced')
);

-- One row per skill per profile version. A résumé mentioning Kubernetes four times is one claim
-- with the strongest evidence, not four rows that quadruple its weight.
CREATE UNIQUE INDEX uq_profile_skills__profile_skill ON profile_skills (user_profile_id, skill_id);

-- "Which profiles have this skill" is the gap engine's read pattern.
CREATE INDEX idx_profile_skills__skill ON profile_skills (skill_id);
