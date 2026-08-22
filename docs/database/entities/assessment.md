# Entity: Assessment

> **Purpose:** The instrument that may promote a skill to `evidenced`, and every attempt at it.

**A pass evidences the attempt, not the person** (ADR-0030). This person passed *this version of this
instrument* on this date. There is no proctoring and no identity check in this repository, so nothing
here asserts who sat it — which is why a promoted skill points back at the attempt, and why the
surface must say what the claim covers.

## `skill_assessments`

One row per **version**. A version is not a column on a mutable row: items change, and a pass has to
keep citing what it was actually earned against.

```sql
CREATE TABLE skill_assessments (
  id             uuid         PRIMARY KEY,
  slug           text         NOT NULL,      -- stable across versions, permanent, kebab-case
  version        integer      NOT NULL,
  skill_id       uuid         NOT NULL,      -- one skill: a pass must say which one it was about
  title          text         NOT NULL,
  description    text,
  item_count     smallint     NOT NULL,
  pass_threshold smallint     NOT NULL,      -- stated on the instrument, never per attempt
  status         text         NOT NULL DEFAULT 'draft',   -- 'draft' | 'published' | 'retired'
  published_at   timestamptz,
  retired_at     timestamptz,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_sa__skills FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE RESTRICT,
  CONSTRAINT ck_sa__slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_sa__version CHECK (version >= 1),
  CONSTRAINT ck_sa__status CHECK (status IN ('draft','published','retired')),
  CONSTRAINT ck_sa__item_count CHECK (item_count >= 1),
  CONSTRAINT ck_sa__threshold CHECK (pass_threshold >= 1 AND pass_threshold <= item_count),
  CONSTRAINT ck_sa__published_at CHECK (status = 'draft' OR published_at IS NOT NULL),
  CONSTRAINT ck_sa__retired_at CHECK (status <> 'retired' OR retired_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_sa__slug_version ON skill_assessments (slug, version);
CREATE UNIQUE INDEX uq_sa__published ON skill_assessments (slug) WHERE status = 'published';
CREATE INDEX idx_sa__skill ON skill_assessments (skill_id) WHERE status = 'published';
```

### Why these constraints

**`ck_sa__threshold`.** A threshold above the item count can never be met; a threshold of zero passes
everybody. Both are instruments that evidence nothing while looking like they do.

**`uq_sa__published` — at most one live version per instrument.** Two published versions under one
slug would let two people hold incomparable evidence under one name, and neither would be wrong.

**The three statuses are three different facts.** `draft` cannot be taken and cannot promote
anything. `published` can. `retired` accepts no new attempts while keeping every pass already earned
against it citable — retiring an instrument does not un-demonstrate what somebody demonstrated.

**Items are not here.** An instrument states how many it has and how many must be correct; the items
themselves are authoring work, because a badly written item produces a confidently wrong `evidenced`
in the direction that flatters. Until they exist an assessment can be described and cannot be taken,
and `status` is what says so.

## `assessment_attempts`

Every attempt, kept.

```sql
CREATE TABLE assessment_attempts (
  id             uuid         PRIMARY KEY,
  user_id        uuid         NOT NULL,
  assessment_id  uuid         NOT NULL,      -- the version, not the instrument
  started_at     timestamptz  NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  score          smallint,                   -- null while open, and for an abandoned attempt
  outcome        text         NOT NULL DEFAULT 'in_progress',
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_aa__users       FOREIGN KEY (user_id)       REFERENCES users(id)             ON DELETE CASCADE,
  CONSTRAINT fk_aa__assessments FOREIGN KEY (assessment_id) REFERENCES skill_assessments(id) ON DELETE RESTRICT,
  CONSTRAINT ck_aa__outcome CHECK (outcome IN ('in_progress','passed','failed','abandoned')),
  CONSTRAINT ck_aa__decided CHECK (
    (outcome IN ('passed','failed')) = (submitted_at IS NOT NULL AND score IS NOT NULL)
  ),
  CONSTRAINT ck_aa__score CHECK (score IS NULL OR score >= 0)
);

CREATE UNIQUE INDEX uq_aa__passed_once ON assessment_attempts (user_id, assessment_id) WHERE outcome = 'passed';
CREATE INDEX idx_aa__user ON assessment_attempts (user_id, started_at DESC);
```

**Append-only.** A failed attempt is a fact about what happened, and keeping only the best result
would make the record flatter than the truth — the same reason a requirement is superseded rather
than updated. Re-attempts are allowed (ADR-0030 part 3) and every one is kept.

**`uq_aa__passed_once`.** A second pass against the same version is the same evidence recorded twice,
and two rows would let one demonstration count as two. Passing a *later* version is a different row
and a different demonstration.

**A score of null is not a score of zero.** An unfinished or abandoned attempt has no score; writing
0 would record a failure that never happened.

## `assessment_items`

```sql
CREATE TABLE assessment_items (
  id             uuid         PRIMARY KEY,
  assessment_id  uuid         NOT NULL,      -- the version
  position       smallint     NOT NULL,
  stem           text         NOT NULL,
  options        jsonb        NOT NULL,      -- [{ key, text }, …]
  correct_option text         NOT NULL,
  evidences      text         NOT NULL,      -- the narrow capability this item supports
  source_url     text         NOT NULL,      -- official documentation the answer follows from
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_ai__assessments FOREIGN KEY (assessment_id) REFERENCES skill_assessments(id) ON DELETE CASCADE,
  CONSTRAINT ck_ai__position CHECK (position >= 1),
  CONSTRAINT ck_ai__options CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2),
  CONSTRAINT ck_ai__correct_is_offered CHECK (
    options @> jsonb_build_array(jsonb_build_object('key', correct_option))
  ),
  CONSTRAINT ck_ai__evidences CHECK (length(evidences) >= 20),
  CONSTRAINT ck_ai__source_url CHECK (source_url ~ '^https://')
);

CREATE UNIQUE INDEX uq_ai__assessment_position ON assessment_items (assessment_id, position);
```

**An item carries more than a question and a key**, because ADR-0030 requires the surface to say what
a pass covered. `evidences` is the sentence that appears in *"passing showed…"*; `source_url` is
where the answer comes from. Both are columns rather than review conventions — a convention is not
checkable, and an unsourced item is indistinguishable from a remembered one.

**`ck_ai__correct_is_offered` catches a silent, total failure.** An item whose key is not among its
options is answered wrongly by everybody: the pass rate drops, and nothing anywhere reports a fault.

**`does_not_evidence` lives on the instrument, not the items.** What a pass fails to show is not the
complement of what the items ask — it is a judgement about the distance between recall and
competence. `publishAssessment` refuses to publish without it, because publishing without it makes
the broader claim by omission.

## Taking one

`itemsToAnswer` returns id, position, stem and options — **never `correct_option`**. The omission is
in what the query selects rather than in a caller remembering to strip a field.

`gradeAttempt` computes the score from the stored key. **A caller never supplies a score**: that
would be a client deciding whether it passed, which no validation downstream recovers from. An
unanswered item counts as wrong rather than being skipped, or somebody could answer one item
correctly and pass an instrument of ten.

## Authoring

Instruments are **curated content**, seeded from `packages/db/seeds/assessments/` at tier 3 — the
same standing as the skill graph. `validateAssessmentSeed` refuses one before it is written when an
item names no capability, cites no documentation, or offers a key that is not among its options; and
`tests/unit/invariants/assessment-authoring.test.ts` runs the same checks against what is actually
authored, plus three more: every item cites the same authority, no two items claim the same
capability, and the threshold neither passes everybody nor nobody.

**Re-seeding rewrites a version's items in place.** That is right while a version is being written
and wrong once anybody has passed it, so a change to what the instrument *asks* is a new version
rather than an edit. Nothing enforces that — it is a judgement about whether the questions changed,
and the cost of getting it wrong is a pass citing a version that no longer asks what it asked.

## What promotes, and what it writes

`promoteFromAttempt` in `packages/db/src/repositories/learning`'s sibling
`repositories/assessments.ts` is **the only writer** of `evidence_kind = 'assessment'` and of
`profile_skills.verified_at`. A passed attempt writes:

| Column | Value |
|---|---|
| `status` | `evidenced` |
| `evidence_kind` | `assessment` |
| `verified_at` | when the promotion happened |
| `verified_attempt_id` | the attempt — so the basis can be shown |
| `self_reported` | `false`. The instrument decided this, not the person, even though they performed the act |

**Promotion upgrades an existing claim in place.** A résumé may already claim the skill; a claim and
its later evidence are one fact about a person, and the original `source_span` survives so they can
still see what the parser read.

**`verified_at` and `verified_attempt_id` travel together** —
`ck_profile_skills__attempt_verified`. That pair rule caught a real defect when it was added:
`applyCorrection` copied `verified_at` forward onto a new profile version without the attempt id,
which would have started failing the moment somebody with an assessed skill corrected an unrelated
one. It now carries both, because a version holding verification with no citable instrument is a
promotion whose basis was lost in the copy.

## Invariants

- Only a **passed** attempt promotes. A failed one, and an unfinished one, promote nothing.
- Only a **published** version may be attempted.
- The pass threshold comes from the instrument, never from the caller submitting a score.
- A decided attempt is not re-decided.
- `verified_at` never appears without `verified_attempt_id`, in any table row or any code path
  (`tests/unit/invariants/single-promotion-writer.test.ts`).
- Recording a **completion** promotes nothing, ever (`entities/learning-resource.md`).

## Related

- ADR-0030 — why an assessment is the only promoting path, and what a pass claims
- `docs/database/entities/user.md` — `profile_skills`, `evidence_kind`, `verified_at`
- `docs/features/learning-paths.md` — the promotion table this implements the first row of
