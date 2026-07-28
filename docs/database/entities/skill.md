# Entity: Skill

> **Purpose:** Skill entity and taxonomy links.

**World fact.** Skills and their relationships are the substrate every score stands on: transferable
skills, gaps, learning order, and career adjacency all read from here.

## `skills`

```sql
CREATE TABLE skills (
  id            uuid        PRIMARY KEY,          -- UUIDv7
  slug          text        NOT NULL,             -- kebab-case, stable, never reused: 'kubernetes'
  name          text        NOT NULL,             -- display: 'Kubernetes'
  kind          text        NOT NULL,             -- 'technology' | 'tool' | 'practice' | 'domain' | 'language' | 'soft'
  description   text,

  source_tier   smallint    NOT NULL,
  source_url    text,
  basis         text        NOT NULL,             -- 'official-taxonomy' | 'posting-derived' | 'curated'
  retrieved_at  timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT ck_skills__kind CHECK (kind IN ('technology','tool','practice','domain','language','soft')),
  CONSTRAINT ck_skills__tier CHECK (source_tier BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX uq_skills__slug ON skills (slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_skills__kind ON skills (kind) WHERE deleted_at IS NULL;
```

`slug` is the identifier prompts and code use. It is permanent: a prompt supplies a **closed set** of
slugs and the model may only return ids from it (`docs/prompts/conventions.md`), so a renamed slug
silently breaks extraction.

`kind = 'language'` covers human languages, which matter for relocation viability, not programming
languages — those are `technology`.

## `skill_aliases`

```sql
CREATE TABLE skill_aliases (
  id          uuid        PRIMARY KEY,
  skill_id    uuid        NOT NULL,
  alias       text        NOT NULL,          -- 'k8s', 'kube', 'Kubernetes (K8s)'
  normalized  text        NOT NULL,          -- casefolded, punctuation stripped
  source_tier smallint    NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_skill_aliases__skills FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX uq_skill_aliases__normalized ON skill_aliases (normalized);
```

Resolution goes through this table, never through string equality on `name`
(`docs/architecture/knowledge-engine.md`). `uq` on `normalized` means one alias resolves to exactly one
skill — an ambiguous alias is a data problem to fix, not a runtime coin flip.

## `skill_edges`

The graph. Typed, weighted, and every edge carries how it was derived.

```sql
CREATE TABLE skill_edges (
  id              uuid         PRIMARY KEY,
  from_skill_id   uuid         NOT NULL,
  to_skill_id     uuid         NOT NULL,
  edge_type       text         NOT NULL,
  weight          numeric(4,3) NOT NULL,

  basis           text         NOT NULL,    -- 'posting-cooccurrence' | 'official-curriculum' | 'outcome-derived' | 'curated'
  support         integer,                  -- observations behind the weight
  compute_version text,                     -- so it can be recomputed and compared
  source_tier     smallint     NOT NULL,
  source_url      text,

  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT fk_skill_edges__from FOREIGN KEY (from_skill_id) REFERENCES skills(id) ON DELETE RESTRICT,
  CONSTRAINT fk_skill_edges__to   FOREIGN KEY (to_skill_id)   REFERENCES skills(id) ON DELETE RESTRICT,
  CONSTRAINT ck_skill_edges__type CHECK (edge_type IN ('requires','adjacent_to','transfers_to','subsumes','tooling_of')),
  CONSTRAINT ck_skill_edges__weight CHECK (weight >= 0 AND weight <= 1),
  CONSTRAINT ck_skill_edges__no_self CHECK (from_skill_id <> to_skill_id),
  CONSTRAINT ck_skill_edges__tier CHECK (source_tier BETWEEN 1 AND 4),
  CONSTRAINT ck_skill_edges__derived_support CHECK (basis <> 'posting-cooccurrence' OR support IS NOT NULL)
);

CREATE UNIQUE INDEX uq_skill_edges__triple ON skill_edges (from_skill_id, to_skill_id, edge_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_skill_edges__from_type ON skill_edges (from_skill_id, edge_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_skill_edges__to_type   ON skill_edges (to_skill_id, edge_type)   WHERE deleted_at IS NULL;
```

### Edge types

| `edge_type` | Meaning | Direction | Read by |
|---|---|---|---|
| `requires` | prerequisite — hard to learn `from` without `to` | strict | `learning-paths` (ordering) |
| `adjacent_to` | related, partial transfer | store both directions | discovery |
| `transfers_to` | competence carries over, `weight` = how much | directed | `career-intelligence` (transferability) |
| `subsumes` | broader includes narrower | directed | gap collapsing |
| `tooling_of` | tool of a practice | directed | requirement interpretation |

**`ck_skill_edges__tier` bounded at 4 is the enforcement of "no tier-5 value in a fact table".** An
LLM asked "what skills relate to X?" produces a tier-5 answer and cannot be written here — edges come
from posting co-occurrence, official curricula, or recorded outcomes
(`docs/architecture/knowledge-engine.md`).

**`ck_skill_edges__derived_support`** means a co-occurrence edge must state how many observations back
it. A weight of 0.8 from two postings and from two thousand are different facts.

`requires` edges are kept deliberately sparse and strict. An over-eager prerequisite makes a learning
path longer than the gap requires, which makes a reachable target look unreachable.

## `career_skills`

The bridge from a career track to its requirements — what a gap is computed against.

```sql
CREATE TABLE career_skills (
  id          uuid         PRIMARY KEY,
  career_id   uuid         NOT NULL,
  skill_id    uuid         NOT NULL,
  weight      numeric(4,3) NOT NULL,     -- importance for this career
  cluster     text         NOT NULL,     -- 'core' | 'supporting' | 'differentiating' | 'peripheral'
  basis       text         NOT NULL,     -- 'posting-frequency' | 'official-curriculum' | 'curated'
  support     integer,
  market_scope char(2),                  -- null = global; set where the requirement is market-specific
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT fk_career_skills__careers FOREIGN KEY (career_id) REFERENCES careers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_career_skills__skills  FOREIGN KEY (skill_id)  REFERENCES skills(id)  ON DELETE RESTRICT,
  CONSTRAINT ck_career_skills__cluster CHECK (cluster IN ('core','supporting','differentiating','peripheral')),
  CONSTRAINT ck_career_skills__weight CHECK (weight >= 0 AND weight <= 1)
);
CREATE UNIQUE INDEX uq_career_skills__career_skill_market ON career_skills (career_id, skill_id, COALESCE(market_scope, 'ZZ'));
```

`market_scope` exists because a requirement can be real in one market and absent in another — German
language for a Berlin role, for instance. Global rows and market-specific rows coexist, and the more
specific one wins during evaluation.

**Weights live here, not in code.** A hardcoded `KUBERNETES_WEIGHT = 0.3` freezes a market fact at the
moment someone typed it (`.claude/skills/ai-matching/SKILL.md`).

## Invariants

- `slug` is permanent — prompts depend on the closed set.
- One alias resolves to one skill.
- No self-edges; one row per (`from`, `to`, `type`).
- Every edge and requirement states its `basis`; derived ones state `support`.
- `source_tier` is 1–4, never 5.
- Weights are 0..1 inclusive.
- Never `UPDATE` a weight in place without bumping `compute_version` — otherwise a changed score has no
  explanation.

## Related

- `docs/architecture/knowledge-engine.md` — the graphs and how edges are derived
- `job.md` (`job_posting_skills`), `user.md` (`profile_skills`)
- `.claude/skills/career-intelligence/references/careers/_TEMPLATE.md` — where a track's skill set is
  modeled before it is seeded
- `.claude/skills/learning-paths/SKILL.md` — the consumer of `requires`
