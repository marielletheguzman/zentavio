-- The items an assessment is made of, and the claim a pass is allowed to support (ADR-0030).
--
-- ## Why an item carries more than a question and an answer
--
-- ADR-0030 says a pass evidences *the attempt*, and that the surface must say what the claim covers.
-- A stem and a key cannot support that sentence: to say what passing evidenced, each item has to
-- state **what it demonstrates**, and to be defensible it has to say **where its answer comes from**.
-- Both are columns rather than review conventions, because a convention is not checkable and an
-- unsourced item is indistinguishable from a remembered one.
--
-- ## The negative half cannot be derived
--
-- What a pass does *not* evidence is not the complement of the items — it is a judgement about the
-- distance between recall and competence, and it belongs to the instrument. `does_not_evidence` is
-- required before an instrument may be published, because publishing without it is exactly the
-- broader claim ADR-0030 refuses.

ALTER TABLE skill_assessments
  ADD COLUMN does_not_evidence text;

COMMENT ON COLUMN skill_assessments.does_not_evidence IS
  'What passing this deliberately does not show. Required to publish (enforced in publishAssessment).';

CREATE TABLE assessment_items (
  id             uuid         PRIMARY KEY,
  -- The **version**. Items belong to the version they were written for, which is what lets a pass
  -- keep citing what it was earned against after the instrument is rewritten.
  assessment_id  uuid         NOT NULL,
  position       smallint     NOT NULL,

  stem           text         NOT NULL,
  -- `[{ "key": "a", "text": "…" }, …]`. Kept as one document because an option has no life of its
  -- own: it is never queried, never referenced, and only ever read with its item.
  options        jsonb        NOT NULL,
  correct_option text         NOT NULL,

  -- **The narrow capability this item supports.** One sentence, in the same words the surface will
  -- use. Without it a pass can only say "passed", which is the claim ADR-0030 exists to bound.
  evidences      text         NOT NULL,
  -- Where the correct answer follows from. Official documentation, not a tutorial: an item whose
  -- answer cannot be traced is an opinion with a scoring rule attached.
  source_url     text         NOT NULL,

  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_ai__assessments FOREIGN KEY (assessment_id) REFERENCES skill_assessments(id) ON DELETE CASCADE,

  CONSTRAINT ck_ai__position CHECK (position >= 1),
  -- At least two options, or the item is not a question.
  CONSTRAINT ck_ai__options CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2),
  -- The key must be one of the options offered. An item whose answer is not on the list cannot be
  -- answered correctly by anybody, and every attempt at it fails silently.
  CONSTRAINT ck_ai__correct_is_offered CHECK (
    options @> jsonb_build_array(jsonb_build_object('key', correct_option))
  ),
  -- A one-word `evidences` is the column being filled in rather than used.
  CONSTRAINT ck_ai__evidences CHECK (length(evidences) >= 20),
  CONSTRAINT ck_ai__source_url CHECK (source_url ~ '^https://')
);

CREATE UNIQUE INDEX uq_ai__assessment_position ON assessment_items (assessment_id, position);

-- `ON DELETE CASCADE` from the instrument, and it is the only cascade here: a version's items have
-- no meaning without the version. Attempts are **not** cascaded — a passed attempt survives its
-- instrument being deleted, because somebody's evidence is not ours to discard for tidiness.
