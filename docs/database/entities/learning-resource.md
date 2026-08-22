# Entity: Learning Resource

> **Purpose:** Course/resource entity.

**World fact.** Every resource is ingested by a connector with provenance. Nothing here is invented —
no course title, no URL, no certification. That is the single most common failure mode of a learning
feature, and this table is where it is prevented (`.claude/skills/learning-paths/SKILL.md`).

## `learning_resources`

```sql
CREATE TABLE learning_resources (
  id                uuid         PRIMARY KEY,          -- UUIDv7
  provider          text         NOT NULL,             -- 'aws' | 'coursera' | 'kubernetes.io' | ...
  external_id       text         NOT NULL,
  title             text         NOT NULL,
  url               text         NOT NULL,

  format            text         NOT NULL,             -- 'course' | 'documentation' | 'book' | 'lab' | 'certification' | 'video' | 'tutorial'
  level             text,                              -- 'beginner' | 'intermediate' | 'advanced'
  language          char(2)      NOT NULL,             -- the language it is taught in

  typical_duration  interval,                          -- as published; null when unstated
  duration_basis    text,                              -- 'published' | 'observed' | null
  cost_amount       numeric(10,2),
  cost_currency     char(3),
  cost_band         text         NOT NULL,             -- 'free' | 'low' | 'mid' | 'high' | 'unknown'

  is_certification  boolean      NOT NULL DEFAULT false,
  cert_authority    text,
  grants_evidence   boolean      NOT NULL DEFAULT false, -- can completion promote a skill to evidenced?

  -- Provenance.
  source_id         text         NOT NULL,
  source_tier       smallint     NOT NULL,
  source_url        text         NOT NULL,
  retrieved_at      timestamptz  NOT NULL,

  -- Health. A dead link is a data-quality bug, not a user's problem.
  last_verified_at  timestamptz  NOT NULL,
  link_status       text         NOT NULL DEFAULT 'ok', -- 'ok' | 'redirected' | 'dead'
  retired_at        timestamptz,

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT fk_lr__sources FOREIGN KEY (source_id) REFERENCES connector_sources(id) ON DELETE RESTRICT,

  CONSTRAINT ck_lr__format CHECK (format IN ('course','documentation','book','lab','certification','video','tutorial')),
  CONSTRAINT ck_lr__level CHECK (level IS NULL OR level IN ('beginner','intermediate','advanced')),
  CONSTRAINT ck_lr__cost_band CHECK (cost_band IN ('free','low','mid','high','unknown')),
  CONSTRAINT ck_lr__link_status CHECK (link_status IN ('ok','redirected','dead')),
  -- Tier 2 floor: official provider pages, not aggregator listings.
  CONSTRAINT ck_lr__tier CHECK (source_tier BETWEEN 1 AND 2),
  CONSTRAINT ck_lr__cost_currency CHECK (cost_amount IS NULL OR cost_currency IS NOT NULL),
  CONSTRAINT ck_lr__duration_basis CHECK (typical_duration IS NULL OR duration_basis IS NOT NULL),
  CONSTRAINT ck_lr__cert_authority CHECK (NOT is_certification OR cert_authority IS NOT NULL)
);

CREATE UNIQUE INDEX uq_lr__provider_external ON learning_resources (provider, external_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lr__skill_lookup ON learning_resources (language, cost_band, format) WHERE deleted_at IS NULL AND retired_at IS NULL AND link_status <> 'dead';
CREATE INDEX idx_lr__stale_verification ON learning_resources (last_verified_at) WHERE retired_at IS NULL;
```

### Why these constraints

**`ck_lr__tier` capped at 2.** Official provider pages only — not an aggregator's listing of a course,
which goes stale and misattributes. Per-domain floor from
`.claude/context/knowledge-sources.md`.

**`ck_lr__duration_basis`.** A duration must say whether it is what the provider published or what we
observed from outcomes. They are different facts, and the second is the one that eventually makes
estimates honest.

**`grants_evidence`.** Whether completing this can promote a skill from `claimed` to `evidenced`. Most
courses cannot: a completion certificate is a claim. A proctored certification or an assessed lab can.
Getting this wrong would let users optimize for completions instead of competence
(`.claude/skills/learning-paths/SKILL.md`).

**`link_status` and `last_verified_at`.** A dead link surfaced in a learning path is a broken promise.
Verification runs on a schedule; `idx_lr__stale_verification` finds what needs re-checking. Dead
resources are excluded from lookup by the partial index rather than deleted, so the path that referenced
one can still explain itself.

## `learning_resource_skills`

```sql
CREATE TABLE learning_resource_skills (
  id            uuid         PRIMARY KEY,
  resource_id   uuid         NOT NULL,
  skill_id      uuid         NOT NULL,
  coverage      text         NOT NULL,        -- 'primary' | 'partial' | 'mentioned'
  basis         text         NOT NULL,        -- 'provider-stated' | 'syllabus-extraction' | 'curated'
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT fk_lrs__resources FOREIGN KEY (resource_id) REFERENCES learning_resources(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lrs__skills    FOREIGN KEY (skill_id)    REFERENCES skills(id)             ON DELETE RESTRICT,
  CONSTRAINT ck_lrs__coverage CHECK (coverage IN ('primary','partial','mentioned')),
  CONSTRAINT ck_lrs__basis CHECK (basis IN ('provider-stated','syllabus-extraction','curated'))
);
CREATE UNIQUE INDEX uq_lrs__resource_skill ON learning_resource_skills (resource_id, skill_id);
```

`coverage` matters when building a path: a step wants a `primary` resource. A course that merely
*mentions* Terraform does not close a Terraform gap.

## `learning_completions`

What a person says they finished. **Built 2026-08-22, with `learning_resources` and
`learning_resource_skills`.**

```sql
CREATE TABLE learning_completions (
  id            uuid         PRIMARY KEY,
  user_id       uuid         NOT NULL,
  resource_id   uuid         NOT NULL,
  completed_at  timestamptz  NOT NULL,       -- when they say they finished, not when they told us
  basis         text         NOT NULL DEFAULT 'self_reported',
  evidence_url  text,                        -- stored, never read
  note          text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT fk_lc__users     FOREIGN KEY (user_id)     REFERENCES users(id)              ON DELETE CASCADE,
  CONSTRAINT fk_lc__resources FOREIGN KEY (resource_id) REFERENCES learning_resources(id) ON DELETE RESTRICT,
  CONSTRAINT ck_lc__basis CHECK (basis IN ('self_reported'))
);

CREATE UNIQUE INDEX uq_lc__user_resource ON learning_completions (user_id, resource_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_lc__user_completed ON learning_completions (user_id, completed_at DESC) WHERE deleted_at IS NULL;
```

**It holds no skill, and that is the whole point.** A completion is a claim about a *resource*;
`evidenced` is a claim about a person's competence, and `ai/skill-gap` credits only the second
(`_CREDIT_STATUSES`). Nothing in `repositories/learning.ts` writes `profile_skills`, and
`tests/integration/db/learning-constraints.test.ts` pins that — including for a resource whose
`grants_evidence` is true, because the flag existing is not the same as the mechanism existing.

**`basis` has one value.** `self_reported` is all we can currently observe: the person tells us. A
provider callback or a verified certificate would be a different basis, added when one exists rather
than reserved for one that does not.

**`evidence_url` is stored and never read.** Somebody may offer a certificate link; keeping it costs
nothing and discarding it would be rude. A link is not a verification, and nothing treats it as one.

**One row per person per resource.** Finishing a course twice is one fact about them, and two rows
would double whatever an observed-pace estimate later reads. Re-recording updates in place — and
because the index is partial (`WHERE deleted_at IS NULL`), the `ON CONFLICT` arbiter repeats that
predicate or PostgreSQL refuses the statement.

**No "not in the future" constraint, and that is a limitation rather than an oversight.** PostgreSQL
refuses a non-immutable function in a `CHECK`, so `completed_at <= now()` cannot be written as one.
A future-dated completion is a typo or a lie and would corrupt an observed-pace estimate, so the
guard lives in `recordCompletion` — which means it holds for everything written through the
repository, and not for a hand-written `INSERT`.

## `learning_paths` and `learning_path_steps`

Derived. Each step ties to exactly one gap item — a step with no gap item behind it is padding, and
padding makes a reachable target look unreachable.

```sql
CREATE TABLE learning_path_steps (
  id                 uuid         PRIMARY KEY,
  learning_path_id   uuid         NOT NULL,
  position           smallint     NOT NULL,        -- dependency order, from skill_edges.requires
  skill_id           uuid         NOT NULL,
  gap_item_id        uuid         NOT NULL,        -- REQUIRED: why this step exists
  resource_id        uuid,                         -- null is valid and honest
  no_resource_note   text,                         -- 'no verified resource for this skill yet'
  estimated_effort   jsonb,                        -- {low, high, unit, basis, confidence}
  elapsed_estimate   jsonb,                        -- {low, high, assumes_hours_per_week}
  verification       text         NOT NULL,        -- 'assessment' | 'artifact' | 'certification' | 'self-report'
  weight             numeric(4,3) NOT NULL,
  completed_at       timestamptz,
  created_at         timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_lps__paths     FOREIGN KEY (learning_path_id) REFERENCES learning_paths(id)      ON DELETE CASCADE,
  CONSTRAINT fk_lps__skills    FOREIGN KEY (skill_id)         REFERENCES skills(id)              ON DELETE RESTRICT,
  CONSTRAINT fk_lps__resources FOREIGN KEY (resource_id)      REFERENCES learning_resources(id)  ON DELETE RESTRICT,
  CONSTRAINT ck_lps__verification CHECK (verification IN ('assessment','artifact','certification','self-report')),
  -- Absence of a resource must be stated, not silently empty.
  CONSTRAINT ck_lps__resource_or_note CHECK (resource_id IS NOT NULL OR no_resource_note IS NOT NULL)
);
CREATE UNIQUE INDEX uq_lps__path_position ON learning_path_steps (learning_path_id, position);
```

**`ck_lps__resource_or_note`** is the honest-absence rule in schema form: a step either has a real
ingested resource or says explicitly that none is verified yet. It never renders as a blank.

`no_resource_note` rows are also the backlog for `connectors/learning-resources` — they name exactly
which coverage to add.

## Retention

Indefinite for resources; not personal data. Retired and dead-link rows are kept so a historical path
remains explicable. `learning_paths` and their steps are person data by association and are erased with
the account (`../data-retention.md`).

## Invariants

- No resource without `source_id`, `source_url`, and `retrieved_at`.
- `source_tier` is 1 or 2 — no aggregator listings.
- A duration requires a `duration_basis`.
- A certification requires a `cert_authority`.
- `grants_evidence` is true only where completion is actually assessed.
- Every step ties to a gap item.
- A step without a resource states why.
- Never invent a title, URL, provider, or certification.

## Related

- `.claude/skills/learning-paths/SKILL.md` — ordering, estimates, verification
- `docs/features/learning-paths.md`
- `skill.md` (`requires` edges drive `position`), `user.md`
- `.claude/context/knowledge-sources.md` — the tier-2 floor
