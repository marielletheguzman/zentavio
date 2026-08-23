-- `matches` — one person against one posting, with the evidence and versions that produced it.
--
-- The table `docs/database/entities/match.md` designed and refused to create until something wrote
-- to it. ADR-0037 is what unblocked it: not new code, but a decision about what the first number is
-- allowed to claim.
--
-- **This table holds more than one kind of score, and `scorer_version` says which.** Today exactly
-- one exists: `skill-fit-v1`, weighted coverage of what a posting asks for. **No Job Match Score is
-- computed or stored** — work authorization is a declared hard constraint and is unevaluatable for
-- every stored posting, because `job_postings.country_code` is null by ADR-0033's design. A number
-- that omits a constraint nobody consulted is not the Job Match Score under another name.
--
-- **The two constraints that make this table honest, both from `match.md`:**
--
--   * `ck_matches__score_iff_scored` — a row is either scored with a number or `unknown` with none.
--     There is no third state where a missing computation is recorded as `0.0`: a zero score and an
--     uncomputable score mean opposite things to a person, and conflating them is how a platform
--     starts lying quietly. This constraint is **not** weakened to admit partial scoring; ADR-0037
--     exists precisely so it does not have to be.
--   * `ck_matches__evidence_present` — a row cannot exist without at least one evidence entry.
--     Principle 2 in schema form. An `unknown` row still carries evidence: what *was* determined,
--     with `missing` explaining what stopped it.

CREATE TABLE matches (
  id                uuid         PRIMARY KEY,          -- UUIDv7, app-generated
  user_id           uuid         NOT NULL,
  job_posting_id    uuid         NOT NULL,

  -- 0..1, full precision. Null when `status` is not 'scored' — never 0.0 standing in for "unknown".
  score             numeric(5,4),
  status            text         NOT NULL,
  confidence        text         NOT NULL,

  -- The contributing factors with their actual weights, positives and negatives alike. A hidden
  -- penalty is an unexplainable score, and people act on gaps more than on strengths.
  evidence          jsonb        NOT NULL,
  -- What we would need in order to do better. A product surface, not an apology.
  missing           jsonb        NOT NULL DEFAULT '[]',
  -- Hard constraints, named rather than applied as a silent multiplier. Empty today: the only hard
  -- constraint the feature defines is work authorization, and it is not evaluated (ADR-0037).
  constraints       jsonb        NOT NULL DEFAULT '[]',

  -- Which arithmetic produced the number. Read this before reading `score`.
  scorer_version    text         NOT NULL,
  -- Null when no model was involved — the whole of the `skill-fit-v1` path.
  prompt_version    text,
  -- Which state of the world this was computed against, and when we said it.
  knowledge_as_of   timestamptz  NOT NULL,
  computed_at       timestamptz  NOT NULL,

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  -- RESTRICT, not CASCADE: a match points at rows an application or an outcome may also point at.
  -- Erasure is an explicit path (`user.md`), not a side effect of deleting something else.
  CONSTRAINT fk_matches__users        FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE RESTRICT,
  CONSTRAINT fk_matches__job_postings FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE RESTRICT,

  CONSTRAINT ck_matches__status      CHECK (status IN ('scored','unknown')),
  CONSTRAINT ck_matches__confidence  CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT ck_matches__score_range CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  CONSTRAINT ck_matches__score_iff_scored CHECK ((status = 'scored') = (score IS NOT NULL)),
  CONSTRAINT ck_matches__evidence_present CHECK (jsonb_array_length(evidence) > 0)
);

-- One live match per person per posting. Recomputation replaces the live row rather than
-- accumulating a history nobody reads.
CREATE UNIQUE INDEX uq_matches__user_job ON matches (user_id, job_posting_id) WHERE deleted_at IS NULL;
-- What a ranked list reads. NULLS LAST so `unknown` rows sort below scored ones without a CASE.
CREATE INDEX idx_matches__user_score ON matches (user_id, score DESC NULLS LAST) WHERE deleted_at IS NULL;
-- Finding matches computed against a state of the world that has since moved.
CREATE INDEX idx_matches__stale ON matches (knowledge_as_of) WHERE deleted_at IS NULL;
