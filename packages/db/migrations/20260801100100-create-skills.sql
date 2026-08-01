-- Skills and their aliases (docs/database/entities/skill.md).
--
-- The closed set the résumé parser resolves phrases against. `skill_aliases` is created in the same
-- migration as `skills` because resolution is the whole point of the table: a skills registry with
-- no alias table forces string equality on `name`, which is exactly what
-- docs/architecture/knowledge-engine.md forbids.
--
-- `skill_edges` and `career_skills` are NOT created here. They are the graph — what requires what,
-- and what a track needs — and M1b is the first thing that reads them. M1a only needs to know that
-- 'k8s' means Kubernetes.

CREATE TABLE skills (
  id            uuid         PRIMARY KEY,                -- UUIDv7, generated in the application
  slug          text         NOT NULL,                   -- kebab-case, stable, never reused: 'kubernetes'
  name          text         NOT NULL,                   -- display: 'Kubernetes'
  kind          text         NOT NULL,
  description   text,

  source_tier   smallint     NOT NULL,
  source_url    text,
  basis         text         NOT NULL,
  retrieved_at  timestamptz,

  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  -- `language` is human languages, which decide relocation viability — not programming languages,
  -- which are `technology`. Conflating them would let "speaks German" and "writes Go" weigh the
  -- same in a gap.
  CONSTRAINT ck_skills__kind CHECK (kind IN ('technology','tool','practice','domain','language','soft')),
  CONSTRAINT ck_skills__basis CHECK (basis IN ('official-taxonomy','posting-derived','curated')),
  CONSTRAINT ck_skills__tier CHECK (source_tier BETWEEN 1 AND 4)
);

-- Permanent identifier. A prompt supplies these as a closed set and the model may only return ids
-- from it (docs/prompts/conventions.md); renaming one breaks extraction without failing.
CREATE UNIQUE INDEX uq_skills__slug ON skills (slug) WHERE deleted_at IS NULL;

CREATE INDEX idx_skills__kind ON skills (kind) WHERE deleted_at IS NULL;

-- Alias resolution. 'k8s', 'kube', and 'Kubernetes (K8s)' are one skill.
CREATE TABLE skill_aliases (
  id           uuid        PRIMARY KEY,                  -- UUIDv7, generated in the application
  skill_id     uuid        NOT NULL,
  alias        text        NOT NULL,                     -- as written, for display and debugging
  normalized   text        NOT NULL,                     -- casefolded, punctuation stripped
  source_tier  smallint    NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_skill_aliases__skills FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE RESTRICT,
  CONSTRAINT ck_skill_aliases__tier CHECK (source_tier BETWEEN 1 AND 4)
);

-- One alias resolves to exactly one skill. An ambiguous alias is a data problem to fix, not a
-- runtime coin flip — without this constraint, "python" resolving to two rows means the parser
-- picks whichever the planner returned first, and the same résumé produces different profiles.
--
-- Not partial on a soft-delete column because this table has none: an alias is either current or
-- removed. Its `ON DELETE RESTRICT` to `skills` is what keeps it from outliving its skill.
CREATE UNIQUE INDEX uq_skill_aliases__normalized ON skill_aliases (normalized);

CREATE INDEX idx_skill_aliases__skill ON skill_aliases (skill_id);
