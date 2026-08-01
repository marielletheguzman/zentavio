# Entity: Career

> **Purpose:** Career track entity and transition edges.

**World fact.** A career track is what a person is measured *against* — every readiness score, skill
gap, and learning path is scoped to one. `user_profiles.current_career_id`, `career_skills.career_id`,
and both career columns on `outcomes` point here.

This table was referenced by three entity documents before it was defined by any of them. It is
written now because M1a cannot insert a profile without it.

## `careers`

```sql
CREATE TABLE careers (
  id            uuid        PRIMARY KEY,          -- UUIDv7
  slug          text        NOT NULL,             -- kebab-case, stable, never reused: 'cloud-platform-engineer'
  name          text        NOT NULL,             -- display: 'Cloud / Platform Engineer'
  family        text        NOT NULL,             -- coarse grouping: 'software-it' | 'healthcare' | 'engineering' | 'education' | 'trades' | 'other'
  description   text,

  -- Recognition scope. NULL means the track is not licence-gated, which is a claim about the
  -- world and therefore needs provenance like any other.
  profession    text,                             -- matches requirements.profession, e.g. 'registered-nurse'
  licence_gated boolean     NOT NULL DEFAULT false,

  source_tier   smallint    NOT NULL,
  source_url    text,
  basis         text        NOT NULL,             -- 'official-taxonomy' | 'posting-derived' | 'curated'
  retrieved_at  timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT ck_careers__family CHECK (family IN ('software-it','healthcare','engineering','education','trades','other')),
  CONSTRAINT ck_careers__basis CHECK (basis IN ('official-taxonomy','posting-derived','curated')),
  CONSTRAINT ck_careers__tier CHECK (source_tier BETWEEN 1 AND 4),
  CONSTRAINT ck_careers__licence_profession CHECK (NOT licence_gated OR profession IS NOT NULL)
);

CREATE UNIQUE INDEX uq_careers__slug ON careers (slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_careers__family ON careers (family) WHERE deleted_at IS NULL;
CREATE INDEX idx_careers__profession ON careers (profession) WHERE profession IS NOT NULL AND deleted_at IS NULL;
```

**`ck_careers__licence_profession` is the rule in schema form: a licence-gated track must name the
profession it is gated by.** Otherwise the recognition lookup in `requirements` has nothing to scope
on, and the evaluator would have to guess — which for a regulated profession means telling someone
their licence transfers when nobody checked. `docs/architecture/immigration.md` requires `unknown`
there instead, and this constraint is what makes `unknown` reachable rather than accidental.

The inverse is deliberately *not* constrained: a track may name a `profession` without being
licence-gated, because the same occupation can be regulated in one jurisdiction and not another.
`licence_gated` is the coarse "does this need recognition at all" flag; the per-jurisdiction truth
lives in `requirements`, dated and sourced.

**`slug` is permanent**, for the same reason as `skills.slug`: prompts supply a closed set of slugs
and the model may only return ids from it (`docs/prompts/conventions.md`). A renamed slug silently
breaks extraction rather than failing loudly.

`family` is coarse on purpose. It exists to group tracks in a UI and to scope "what else could I do?"
queries — not to encode a taxonomy nobody sourced. Fine-grained adjacency is `career_edges`, which
carries evidence.

**Provenance is required (`source_tier`, `basis`), same as `skills`.** A career track is a claim about
how the labour market is structured, and an unsourced one poisons every gap computed against it
(`.claude/context/knowledge-sources.md`).

## `career_edges`

How tracks relate: what a person can move to, and what people actually moved to.

```sql
CREATE TABLE career_edges (
  id              uuid        PRIMARY KEY,        -- UUIDv7
  from_career_id  uuid        NOT NULL,
  to_career_id    uuid        NOT NULL,
  edge_type       text        NOT NULL,           -- 'transition_path' | 'adjacent_to'
  weight          numeric(4,3) NOT NULL,          -- 0..1
  support         integer,                        -- observed transitions behind a derived edge

  source_tier     smallint    NOT NULL,
  source_url      text,
  basis           text        NOT NULL,           -- 'observed-outcomes' | 'official-taxonomy' | 'curated'
  retrieved_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT fk_career_edges__from FOREIGN KEY (from_career_id) REFERENCES careers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_career_edges__to   FOREIGN KEY (to_career_id)   REFERENCES careers(id) ON DELETE RESTRICT,
  CONSTRAINT ck_career_edges__type CHECK (edge_type IN ('transition_path','adjacent_to')),
  CONSTRAINT ck_career_edges__weight CHECK (weight >= 0 AND weight <= 1),
  CONSTRAINT ck_career_edges__no_self CHECK (from_career_id <> to_career_id),
  CONSTRAINT ck_career_edges__tier CHECK (source_tier BETWEEN 1 AND 4),
  CONSTRAINT ck_career_edges__observed_support CHECK (basis <> 'observed-outcomes' OR support IS NOT NULL)
);

CREATE UNIQUE INDEX uq_career_edges__triple ON career_edges (from_career_id, to_career_id, edge_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_career_edges__from_type ON career_edges (from_career_id, edge_type) WHERE deleted_at IS NULL;
```

**`ck_career_edges__observed_support`** mirrors `ck_skill_edges__derived_support`: an edge claiming it
was observed must say how many observations back it. "People move from IT support to platform
engineering" derived from three outcomes is a rumour; the column is what stops it being presented as a
pattern. `outcomes.md` names `career_edges.transition_path` as the consumer of observed transitions.

Direction matters. `from → to` is the direction of the move, so the reverse is a separate row with its
own evidence — transitions are rarely symmetric, and treating them as such would suggest routes nobody
takes.

## Invariants

- Every career carries `source_tier` and `basis`. No unsourced track.
- A licence-gated career names its `profession`, enforced by CHECK.
- `slug` is unique among live rows and never reused.
- An edge is never self-referential, and an observed edge states its support.
- No inference from `family`: two tracks sharing a family is not evidence of transferability. That
  claim needs an edge with provenance.

## Not defined here

- **`career_skills`** — the track's skill set, in `skill.md`, because it is the join that makes a
  skill required by a career.
- **`user_targets`** — the track a user is pursuing. Referenced by `relationships.md` and
  `data-retention.md` and **not yet defined anywhere**, the same gap this document closes for
  `careers`. It belongs in `user.md` and is needed by M1b, not M1a.

## Related

- `skill.md` — `career_skills`, the skill set per track
- `outcome.md` — where observed transitions come from
- `user.md` — `user_profiles.current_career_id`
- `requirement.md` — recognition scoped by `profession`
- `.claude/skills/career-intelligence/references/careers/_TEMPLATE.md` — the authored model per track
