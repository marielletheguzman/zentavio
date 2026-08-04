-- The facts a requirement needs about a person (docs/database/entities/person-fact.md, ADR-0010).
--
-- `requirements.needs_input` names what a rule must know — `expected_gross_annual_salary_eur` for
-- the EU Blue Card salary threshold — and produces `needsFromUser` in an eligibility response.
-- That field is the most actionable thing this product returns, because it converts an
-- `undetermined` verdict into a definite one with a single input. Until this table existed there
-- was nowhere to put the answer, so the promise could be made and never kept.
--
-- Two tables, deliberately.
--
-- `person_fact_kinds` is a **closed catalogue**, the same shape as `skills`: a fact kind is a row,
-- so the evaluator stays generic and the UI learns how to ask without hardcoding it. The
-- alternative was a CHECK constraint listing the keys, which holds the closed set but has nowhere
-- to put the value type, the unit, or the question to ask — that metadata would then live in the
-- web app, duplicated and free to drift.
--
-- The invariant this pair exists to protect: **a key named in `needs_input` must be suppliable.**
-- A rule asking for a fact the catalogue does not define produces a `needsFromUser` nobody can
-- answer, and the verdict stays `undetermined` forever with no way for the user to move it.
-- `tests/integration/db/person-facts-constraints.test.ts` asserts that across every ingested rule.

CREATE TABLE person_fact_kinds (
  -- Matches a `requirements.needs_input` element exactly. Snake_case, stable, never renamed:
  -- renaming one silently orphans every stored answer and every rule that asks for it.
  key           text         PRIMARY KEY,

  -- How `person_facts.value` is shaped for this kind, so the evaluator can compare without
  -- guessing. A threshold comparison against a string is a bug that only shows up in production
  -- with real data.
  value_type    text         NOT NULL,

  -- 'EUR/year', 'CEFR', 'years'. Null where the type is self-describing (boolean, date).
  unit          text,

  -- What to ask the person, in their words rather than the schema's. `needsFromUser` renders this,
  -- never the key: "expected_gross_annual_salary_eur" is not a question.
  prompt        text         NOT NULL,

  -- Why the platform is asking. Shown alongside the prompt, because a product that asks for salary
  -- without saying which rule needs it reads as data collection.
  rationale     text         NOT NULL,

  -- Drives retention and logging treatment. Salary and nationality are answers people are entitled
  -- to be careful with (docs/architecture/privacy.md).
  sensitive     boolean      NOT NULL DEFAULT false,

  -- Permitted values, for value_type = 'enum'. Empty otherwise.
  allowed_values text[]      NOT NULL DEFAULT '{}',

  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT ck_pfk__value_type CHECK (value_type IN (
    'monetary','integer','decimal','boolean','string','enum','date'
  )),
  -- An enum with no permitted values cannot be answered; a non-enum with them is a modelling
  -- mistake that would be read as a constraint nobody enforces.
  CONSTRAINT ck_pfk__enum_values CHECK (
    (value_type = 'enum' AND cardinality(allowed_values) > 0)
    OR (value_type <> 'enum' AND cardinality(allowed_values) = 0)
  ),
  -- A monetary or measured value without a unit is not comparable to a threshold.
  CONSTRAINT ck_pfk__unit_required CHECK (
    value_type NOT IN ('monetary','integer','decimal') OR unit IS NOT NULL
  ),
  CONSTRAINT ck_pfk__key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$')
);

-- What a person actually answered.
--
-- **Versioned, never updated in place** — the same rule `user_profiles` follows and for the same
-- reason: an eligibility verdict computed against a salary of 52 000 must remain reproducible after
-- the person corrects it to 48 000. An in-place edit makes every prior verdict unexplainable while
-- its recorded version number is unchanged, which is worse than having no history at all.
CREATE TABLE person_facts (
  id            uuid         PRIMARY KEY,                -- UUIDv7, generated in the application
  user_id       uuid         NOT NULL,
  kind_key      text         NOT NULL,
  version       integer      NOT NULL,
  is_current    boolean      NOT NULL DEFAULT true,

  -- Typed by `person_fact_kinds.value_type`. Monetary values carry currency and period, like
  -- `requirements.value`, so the two are comparable without a conversion nobody wrote down.
  value         jsonb        NOT NULL,

  -- How we know. `self_reported` is the honest default and must never be presented as verified —
  -- a stated salary is an intention, and a verdict that treats it as a fact is overconfident.
  basis         text         NOT NULL DEFAULT 'self_reported',
  -- What verified it: a signed offer, a certificate. Never the document itself.
  basis_detail  text,
  verified_at   timestamptz,

  -- When the person stated it, which is not when the row was written if it was imported.
  stated_at     timestamptz  NOT NULL DEFAULT now(),

  -- Facts expire. An expected salary from two years ago is not evidence about today, and a
  -- language certificate may have a validity period of its own. Null means no known expiry.
  valid_until   date,

  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  -- RESTRICT, not CASCADE, like every other user-owned table: erasure clears person data in a known
  -- order recorded in erasure.ts, rather than as an emergent property of the schema.
  CONSTRAINT fk_person_facts__users FOREIGN KEY (user_id)  REFERENCES users(id)              ON DELETE RESTRICT,
  CONSTRAINT fk_person_facts__kinds FOREIGN KEY (kind_key) REFERENCES person_fact_kinds(key) ON DELETE RESTRICT,

  CONSTRAINT ck_person_facts__version CHECK (version >= 1),
  CONSTRAINT ck_person_facts__basis CHECK (basis IN ('self_reported','derived','verified')),
  -- `verified` without a timestamp is a claim about evidence with no evidence. The reverse is
  -- allowed: a fact can carry a verification date and later be superseded by a self-reported one.
  CONSTRAINT ck_person_facts__verified CHECK (basis <> 'verified' OR verified_at IS NOT NULL)
);

-- Exactly one live answer per person per fact. Partial on both `is_current` and `deleted_at`, so an
-- older version and a soft-deleted one do not collide with the current row. Without this, two rows
-- can claim to be current and the evaluator picks whichever the query returns first — which is the
-- same non-determinism `uq_req__current` exists to prevent on the rule side.
CREATE UNIQUE INDEX uq_person_facts__current
  ON person_facts (user_id, kind_key) WHERE is_current AND deleted_at IS NULL;

-- Version numbers are dense per (user, kind) and never reused, including after a soft delete — so
-- this is deliberately NOT partial. Reusing a version would make "the salary as it stood at v2"
-- ambiguous, and that phrase is what an explained verdict is built from.
CREATE UNIQUE INDEX uq_person_facts__version ON person_facts (user_id, kind_key, version);

-- The evaluator's read: every current fact for one person, in one index scan.
CREATE INDEX idx_person_facts__current ON person_facts (user_id) WHERE is_current AND deleted_at IS NULL;

-- Finding facts that have gone stale, so the UI can say so rather than answering from them.
CREATE INDEX idx_person_facts__expiry ON person_facts (valid_until) WHERE is_current AND deleted_at IS NULL;
