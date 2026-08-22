-- Learning resources, what they teach, and what a person says they finished (M6).
--
-- ## The property these three tables exist to hold
--
-- **Completing something is not evidence of competence.** `ai/skill-gap` credits only `evidenced`
-- skills (`_CREDIT_STATUSES`), and nothing here writes `profile_skills` at all — a completion is
-- recorded against the resource, never promoted into the profile. That separation is the milestone:
-- said out loud to the user, or they optimise for completions instead of competence
-- (`docs/features/learning-paths.md`).
--
-- `grants_evidence` marks the resources whose completion *could* promote a skill — a proctored
-- certification, an assessed lab. **Nothing acts on that flag yet.** Which verification path is
-- allowed to promote, and how, is deliberately not decided here: it is its own decision with its own
-- tradeoffs, and this migration exists to give it something to be decided against.

-- Every resource is ingested with provenance. Nothing here is invented — no course title, no URL, no
-- certification. That is the most common failure mode of a learning feature, and this table is where
-- it is prevented.
CREATE TABLE learning_resources (
  id                uuid         PRIMARY KEY,
  provider          text         NOT NULL,
  external_id       text         NOT NULL,
  title             text         NOT NULL,
  url               text         NOT NULL,

  format            text         NOT NULL,
  level             text,
  language          char(2)      NOT NULL,

  typical_duration  interval,
  duration_basis    text,
  cost_amount       numeric(10,2),
  cost_currency     char(3),
  cost_band         text         NOT NULL,

  is_certification  boolean      NOT NULL DEFAULT false,
  cert_authority    text,
  -- Whether completing this *could* promote a skill from `claimed` to `evidenced`. Most courses
  -- cannot: a completion certificate is a claim about attendance. Read by nothing yet.
  grants_evidence   boolean      NOT NULL DEFAULT false,

  source_id         text         NOT NULL,
  source_tier       smallint     NOT NULL,
  source_url        text         NOT NULL,
  retrieved_at      timestamptz  NOT NULL,

  -- A dead link surfaced in a learning path is a broken promise, so link health is data rather than
  -- something a user discovers.
  last_verified_at  timestamptz  NOT NULL,
  link_status       text         NOT NULL DEFAULT 'ok',
  retired_at        timestamptz,

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT fk_lr__sources FOREIGN KEY (source_id) REFERENCES connector_sources(id) ON DELETE RESTRICT,

  CONSTRAINT ck_lr__format CHECK (format IN ('course','documentation','book','lab','certification','video','tutorial')),
  CONSTRAINT ck_lr__level CHECK (level IS NULL OR level IN ('beginner','intermediate','advanced')),
  CONSTRAINT ck_lr__cost_band CHECK (cost_band IN ('free','low','mid','high','unknown')),
  CONSTRAINT ck_lr__link_status CHECK (link_status IN ('ok','redirected','dead')),
  -- Official provider pages only, never an aggregator's listing of a course: those go stale and
  -- misattribute. The per-domain floor is in `.claude/context/knowledge-sources.md`.
  CONSTRAINT ck_lr__tier CHECK (source_tier BETWEEN 1 AND 2),
  CONSTRAINT ck_lr__cost_currency CHECK (cost_amount IS NULL OR cost_currency IS NOT NULL),
  -- A duration must say whether it is what the provider published or what we observed. They are
  -- different facts, and the second is the one that eventually makes estimates honest.
  CONSTRAINT ck_lr__duration_basis CHECK (typical_duration IS NULL OR duration_basis IS NOT NULL),
  CONSTRAINT ck_lr__cert_authority CHECK (NOT is_certification OR cert_authority IS NOT NULL)
);

CREATE UNIQUE INDEX uq_lr__provider_external ON learning_resources (provider, external_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lr__skill_lookup ON learning_resources (language, cost_band, format) WHERE deleted_at IS NULL AND retired_at IS NULL AND link_status <> 'dead';
CREATE INDEX idx_lr__stale_verification ON learning_resources (last_verified_at) WHERE retired_at IS NULL;

-- What a resource actually teaches. `coverage` matters when building a path: a course that merely
-- *mentions* Terraform does not close a Terraform gap.
CREATE TABLE learning_resource_skills (
  id            uuid         PRIMARY KEY,
  resource_id   uuid         NOT NULL,
  skill_id      uuid         NOT NULL,
  coverage      text         NOT NULL,
  basis         text         NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_lrs__resources FOREIGN KEY (resource_id) REFERENCES learning_resources(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lrs__skills    FOREIGN KEY (skill_id)    REFERENCES skills(id)             ON DELETE RESTRICT,
  CONSTRAINT ck_lrs__coverage CHECK (coverage IN ('primary','partial','mentioned')),
  CONSTRAINT ck_lrs__basis CHECK (basis IN ('provider-stated','syllabus-extraction','curated'))
);

CREATE UNIQUE INDEX uq_lrs__resource_skill ON learning_resource_skills (resource_id, skill_id);

-- What a person says they finished.
--
-- **This table is a claim, and its shape says so.** `basis` has one value today — `self_reported` —
-- because that is all we can actually observe: the person tells us. A provider callback or a
-- verified certificate would be a different basis, added when one exists rather than reserved for
-- one that does not.
--
-- It holds no skill and touches no profile. A completion is about a *resource*; what a person can do
-- is a different claim, and joining them here would be exactly the promotion this milestone refuses.
CREATE TABLE learning_completions (
  id            uuid         PRIMARY KEY,
  user_id       uuid         NOT NULL,
  resource_id   uuid         NOT NULL,
  -- When they say they finished it, not when they told us. A plan re-estimated from observed pace
  -- needs the first; an audit needs the second, which is `created_at`.
  completed_at  timestamptz  NOT NULL,
  basis         text         NOT NULL DEFAULT 'self_reported',
  -- Whatever they offered as proof — a certificate URL. Stored, never trusted: nothing reads it, and
  -- a link is not a verification.
  evidence_url  text,
  note          text,

  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT fk_lc__users     FOREIGN KEY (user_id)     REFERENCES users(id)              ON DELETE CASCADE,
  CONSTRAINT fk_lc__resources FOREIGN KEY (resource_id) REFERENCES learning_resources(id) ON DELETE RESTRICT,
  CONSTRAINT ck_lc__basis CHECK (basis IN ('self_reported'))
  -- **No "not in the future" constraint here, and that is a limitation rather than an oversight.**
  -- PostgreSQL refuses a non-immutable function in a CHECK, so `completed_at <= now()` cannot be
  -- written as one. A completion dated in the future is a typo or a lie and would corrupt any
  -- observed-pace estimate, so the guard lives in `recordCompletion` — which means it holds for
  -- everything written through the repository and not for a hand-written INSERT.
);

-- One completion per person per resource. Finishing a course twice is one fact about them, and two
-- rows would double whatever an observed-pace estimate later reads.
CREATE UNIQUE INDEX uq_lc__user_resource ON learning_completions (user_id, resource_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lc__user_completed ON learning_completions (user_id, completed_at DESC) WHERE deleted_at IS NULL;
