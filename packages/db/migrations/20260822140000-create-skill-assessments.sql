-- Assessments and attempts — the only path that may promote a skill to `evidenced` (ADR-0030).
--
-- ## What a pass actually claims
--
-- **The attempt, not the person.** This person passed *this version of this instrument* on this
-- date. There is no proctoring and no identity check in this repository, so nothing here asserts who
-- sat the assessment — which is exactly why the attempt is recorded with its instrument version and
-- why `profile_skills` gains a column pointing back at it. A promotion whose basis cannot be shown
-- is the failure ADR-0030 part 2 exists to prevent.
--
-- ## What this migration does not build
--
-- **Items.** An instrument states how many items it has and how many must be correct; the items
-- themselves are authoring work with its own change, because a badly written item produces a
-- confidently wrong `evidenced` in the direction that flatters. Until they exist, an assessment can
-- be described and cannot be taken — which is the honest intermediate state, and `status` is what
-- says so.

-- One row per **version** of an instrument. A version is not a column on a mutable row: items change,
-- and a pass has to keep citing what it was actually earned against.
CREATE TABLE skill_assessments (
  id             uuid         PRIMARY KEY,
  -- Stable across versions, permanent, kebab-case. `kubernetes-fundamentals` v1 and v2 are the same
  -- instrument at two points in time.
  slug           text         NOT NULL,
  version        integer      NOT NULL,
  -- What passing this evidences. One skill: an instrument that claims to evidence three skills at
  -- once cannot say which one a pass was about.
  skill_id       uuid         NOT NULL,
  title          text         NOT NULL,
  description    text,

  -- Passing is stated on the instrument, not decided per attempt. A threshold chosen after seeing
  -- the scores is not a threshold.
  item_count     smallint     NOT NULL,
  pass_threshold smallint     NOT NULL,

  -- `draft` cannot be taken and cannot promote anything. `published` can. `retired` keeps every pass
  -- already earned against it citable while accepting no new attempts.
  status         text         NOT NULL DEFAULT 'draft',
  published_at   timestamptz,
  retired_at     timestamptz,

  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_sa__skills FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE RESTRICT,

  CONSTRAINT ck_sa__slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_sa__version CHECK (version >= 1),
  CONSTRAINT ck_sa__status CHECK (status IN ('draft','published','retired')),
  CONSTRAINT ck_sa__item_count CHECK (item_count >= 1),
  -- A threshold above the item count can never be met; a threshold of zero passes everybody. Both
  -- are instruments that evidence nothing while looking like they do.
  CONSTRAINT ck_sa__threshold CHECK (pass_threshold >= 1 AND pass_threshold <= item_count),
  -- A published instrument says when it was published, because a pass is dated against it.
  CONSTRAINT ck_sa__published_at CHECK (status = 'draft' OR published_at IS NOT NULL),
  CONSTRAINT ck_sa__retired_at CHECK (status <> 'retired' OR retired_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_sa__slug_version ON skill_assessments (slug, version);
-- **At most one live version per instrument.** Two published versions of the same slug would let two
-- people hold incomparable evidence under one name, and neither would be wrong.
CREATE UNIQUE INDEX uq_sa__published ON skill_assessments (slug) WHERE status = 'published';
CREATE INDEX idx_sa__skill ON skill_assessments (skill_id) WHERE status = 'published';

-- Every attempt, kept.
--
-- **Append-only history rather than a current-state row.** A person's failed attempt is a fact about
-- what happened, and deleting it to keep only the best result would make the record flatter than the
-- truth — the same reason a requirement is superseded rather than updated.
CREATE TABLE assessment_attempts (
  id             uuid         PRIMARY KEY,
  user_id        uuid         NOT NULL,
  -- The **version**, not the instrument. This is what makes "passed v1" survive v2 being written.
  assessment_id  uuid         NOT NULL,

  started_at     timestamptz  NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  -- Correct answers. Null while the attempt is open, and for an abandoned one — an unfinished
  -- attempt has no score, and writing 0 would record a failure that never happened.
  score          smallint,
  outcome        text         NOT NULL DEFAULT 'in_progress',

  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_aa__users       FOREIGN KEY (user_id)       REFERENCES users(id)             ON DELETE CASCADE,
  CONSTRAINT fk_aa__assessments FOREIGN KEY (assessment_id) REFERENCES skill_assessments(id) ON DELETE RESTRICT,

  CONSTRAINT ck_aa__outcome CHECK (outcome IN ('in_progress','passed','failed','abandoned')),
  -- A decided attempt has a submission time and a score; an undecided one has neither.
  CONSTRAINT ck_aa__decided CHECK (
    (outcome IN ('passed','failed')) = (submitted_at IS NOT NULL AND score IS NOT NULL)
  ),
  CONSTRAINT ck_aa__score CHECK (score IS NULL OR score >= 0)
);

-- **One pass per person per version.** Re-attempts are allowed (ADR-0030 part 3) and the history
-- keeps them all, but a second pass against the same version is the same evidence recorded twice —
-- and two rows would let one demonstration count as two.
CREATE UNIQUE INDEX uq_aa__passed_once ON assessment_attempts (user_id, assessment_id) WHERE outcome = 'passed';
CREATE INDEX idx_aa__user ON assessment_attempts (user_id, started_at DESC);

-- Which attempt promoted a skill.
--
-- **`verified_at` said *when* and nothing said *what*.** ADR-0030 requires a promoted skill to carry
-- which assessment and which version produced it, so the surface can show the basis and a reader can
-- tell a résumé-derived `evidenced` from an assessed one.
ALTER TABLE profile_skills
  ADD COLUMN verified_attempt_id uuid,
  ADD CONSTRAINT fk_profile_skills__attempts
    FOREIGN KEY (verified_attempt_id) REFERENCES assessment_attempts(id) ON DELETE RESTRICT,
  -- An attempt id without `verified_at` would be a promotion that never happened, and a
  -- `verified_at` set by anything other than an attempt is the second writer ADR-0030 forbids.
  ADD CONSTRAINT ck_profile_skills__attempt_verified
    CHECK ((verified_attempt_id IS NULL) = (verified_at IS NULL));

CREATE INDEX idx_profile_skills__attempt ON profile_skills (verified_attempt_id) WHERE verified_attempt_id IS NOT NULL;
