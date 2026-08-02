-- The skill graph and the career skill set (docs/database/entities/skill.md).
--
-- Deliberately NOT created with `skills` in M1a. A table created before its first reader is one
-- whose shape nobody has verified, and M1b is the first thing that reads these: the gap is
-- `career_skills` minus what the profile has, ordered by `skill_edges.requires`.
--
-- `career_edges` is still not created here, for the same reason. It is career-to-career
-- transferability, which M1b does not read — a gap is computed against one target track.

CREATE TABLE skill_edges (
  id              uuid         PRIMARY KEY,               -- UUIDv7, generated in the application
  from_skill_id   uuid         NOT NULL,
  to_skill_id     uuid         NOT NULL,
  edge_type       text         NOT NULL,
  weight          numeric(4,3) NOT NULL,

  basis           text         NOT NULL,
  support         integer,                                -- observations behind the weight
  compute_version text,                                   -- so a derived edge can be recomputed and compared
  source_tier     smallint     NOT NULL,
  source_url      text,

  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT fk_skill_edges__from FOREIGN KEY (from_skill_id) REFERENCES skills(id) ON DELETE RESTRICT,
  CONSTRAINT fk_skill_edges__to   FOREIGN KEY (to_skill_id)   REFERENCES skills(id) ON DELETE RESTRICT,
  CONSTRAINT ck_skill_edges__type CHECK (edge_type IN ('requires','adjacent_to','transfers_to','subsumes','tooling_of')),
  CONSTRAINT ck_skill_edges__weight CHECK (weight >= 0 AND weight <= 1),

  -- An edge from a skill to itself would make any dependency ordering cyclic on arrival.
  CONSTRAINT ck_skill_edges__no_self CHECK (from_skill_id <> to_skill_id),

  -- Bounded at 4 because tier 5 is a model's opinion, and this is a fact table. An LLM asked
  -- "what skills relate to X?" produces a tier-5 answer and must not be able to write it here
  -- (docs/architecture/knowledge-engine.md).
  CONSTRAINT ck_skill_edges__tier CHECK (source_tier BETWEEN 1 AND 4),

  CONSTRAINT ck_skill_edges__basis CHECK (basis IN ('posting-cooccurrence','official-curriculum','outcome-derived','curated')),

  -- A weight of 0.8 from two postings and from two thousand are different facts, so a derived edge
  -- must say how many observations back it.
  CONSTRAINT ck_skill_edges__derived_support CHECK (basis <> 'posting-cooccurrence' OR support IS NOT NULL)
);

-- One edge per (from, to, type): the same pair may be both `requires` and `tooling_of`, but not
-- `requires` twice with different weights, which would make the gap depend on row order.
CREATE UNIQUE INDEX uq_skill_edges__triple ON skill_edges (from_skill_id, to_skill_id, edge_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_skill_edges__from_type ON skill_edges (from_skill_id, edge_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_skill_edges__to_type   ON skill_edges (to_skill_id, edge_type)   WHERE deleted_at IS NULL;

-- What a track requires — the set a gap is computed against.
CREATE TABLE career_skills (
  id           uuid         PRIMARY KEY,                  -- UUIDv7, generated in the application
  career_id    uuid         NOT NULL,
  skill_id     uuid         NOT NULL,
  weight       numeric(4,3) NOT NULL,                     -- importance for this career
  cluster      text         NOT NULL,
  basis        text         NOT NULL,
  support      integer,
  market_scope char(2),                                   -- null = global; set where the requirement is market-specific

  source_tier  smallint     NOT NULL,
  source_url   text,

  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  deleted_at   timestamptz,

  CONSTRAINT fk_career_skills__careers FOREIGN KEY (career_id) REFERENCES careers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_career_skills__skills  FOREIGN KEY (skill_id)  REFERENCES skills(id)  ON DELETE RESTRICT,
  CONSTRAINT ck_career_skills__cluster CHECK (cluster IN ('core','supporting','differentiating','peripheral')),
  CONSTRAINT ck_career_skills__weight CHECK (weight >= 0 AND weight <= 1),
  CONSTRAINT ck_career_skills__basis CHECK (basis IN ('posting-frequency','official-curriculum','curated')),
  CONSTRAINT ck_career_skills__tier CHECK (source_tier BETWEEN 1 AND 4),
  CONSTRAINT ck_career_skills__derived_support CHECK (basis <> 'posting-frequency' OR support IS NOT NULL)
);

-- COALESCE rather than a plain unique: NULL market_scope means global, and two global rows for the
-- same skill would otherwise both be permitted because NULL is distinct from NULL. 'ZZ' is a
-- user-assigned ISO 3166-1 code, so it can never collide with a real market.
CREATE UNIQUE INDEX uq_career_skills__career_skill_market
  ON career_skills (career_id, skill_id, COALESCE(market_scope, 'ZZ')) WHERE deleted_at IS NULL;
CREATE INDEX idx_career_skills__career ON career_skills (career_id) WHERE deleted_at IS NULL;
