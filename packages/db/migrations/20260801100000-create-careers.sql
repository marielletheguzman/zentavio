-- Career tracks (docs/database/entities/career.md).
--
-- What a person is measured against. Every readiness score, skill gap, and learning path is scoped
-- to one, and `user_profiles.current_career_id` points here — which is why this migration precedes
-- the profile ones rather than arriving with the reasoning that consumes it.
--
-- `career_edges` is deliberately NOT created here. M1a needs a track to exist; it does not traverse
-- between tracks. The edges arrive with M1b, which is the first thing that reads them. A table
-- created before its first reader is a table nobody has verified the shape of.
--
-- Provenance columns are mandatory for the same reason as `skills`: a career track is a claim about
-- how the labour market is structured, and an unsourced one poisons every gap computed against it
-- (.claude/context/knowledge-sources.md).
--
-- No `IF NOT EXISTS`, and indexes in-transaction: same reasoning as 20260729120200-create-users.sql.
-- The table is empty here, and the unique index on `slug` is a correctness constraint that must not
-- have a window where it is absent.

CREATE TABLE careers (
  id            uuid         PRIMARY KEY,                -- UUIDv7, generated in the application
  slug          text         NOT NULL,                   -- kebab-case, stable, never reused
  name          text         NOT NULL,
  family        text         NOT NULL,
  description   text,

  -- Recognition scope. NULL means not licence-gated, which is itself a claim about the world.
  profession    text,                                    -- matches requirements.profession
  licence_gated boolean      NOT NULL DEFAULT false,

  source_tier   smallint     NOT NULL,
  source_url    text,
  basis         text         NOT NULL,
  retrieved_at  timestamptz,

  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT ck_careers__family CHECK (family IN ('software-it','healthcare','engineering','education','trades','other')),
  CONSTRAINT ck_careers__basis CHECK (basis IN ('official-taxonomy','posting-derived','curated')),

  -- Bounded at 4 because tier 5 is "unsourced", and an unsourced value has no place in a fact
  -- table (.claude/context/knowledge-sources.md).
  CONSTRAINT ck_careers__tier CHECK (source_tier BETWEEN 1 AND 4),

  -- A licence-gated track must name the profession it is gated by. Without it the recognition
  -- lookup in `requirements` has nothing to scope on, and the evaluator would have to guess —
  -- which for a regulated profession means telling someone their licence transfers when nobody
  -- checked. docs/architecture/immigration.md requires `unknown` there instead.
  --
  -- The inverse is deliberately unconstrained: a track may name a profession without being
  -- licence-gated, because the same occupation is regulated in one jurisdiction and not another.
  CONSTRAINT ck_careers__licence_profession CHECK (NOT licence_gated OR profession IS NOT NULL)
);

-- `slug` is what prompts and code use, and it is permanent: a prompt supplies a closed set of slugs
-- and the model may only return ids from it (docs/prompts/conventions.md), so a renamed slug breaks
-- extraction silently rather than loudly.
CREATE UNIQUE INDEX uq_careers__slug ON careers (slug) WHERE deleted_at IS NULL;

CREATE INDEX idx_careers__family ON careers (family) WHERE deleted_at IS NULL;

-- Partial on `profession IS NOT NULL`: most tracks are not licence-gated, and indexing their NULLs
-- would be pages of nothing.
CREATE INDEX idx_careers__profession ON careers (profession) WHERE profession IS NOT NULL AND deleted_at IS NULL;
