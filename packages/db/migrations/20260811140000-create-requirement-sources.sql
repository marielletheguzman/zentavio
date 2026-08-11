-- Every instrument a requirement was derived from (ADR-0025).
--
-- ## Why this table exists
--
-- Until Luxembourg, every requirement had exactly one source, and the schema said so:
-- `requirements.source_url` is a single column and `document_id` is a single foreign key to the
-- archived original ADR-0021 made mandatory. That assumption was invisible because nothing
-- violated it.
--
-- Luxembourg's EU Blue Card salary threshold is a **product of two instruments** and no official
-- act states the result — a règlement grand-ducal gives a multiplier, an annual règlement
-- ministériel gives the average salary it applies to. A row derived from both can satisfy
-- `document_id IS NOT NULL` while being **half-evidenced**: one instrument archived, the other
-- named nowhere retrievable. It would pass enforcement and be unrecomputable, which is precisely
-- the state ADR-0021 exists to prevent.
--
-- ## What this table is not
--
-- **Not a replacement for `requirements.document_id`.** That column keeps meaning *the primary
-- instrument* — for Luxembourg's threshold, the RGD that states the formula — so every existing
-- rule keeps working and needs no backfill. This table is additive: a rule with one source may
-- have no rows here at all.
--
-- **Not an expression language.** ADR-0025's non-goals are explicit: one operation, for one rule
-- shape. The operand *values* and the formula live in `requirements.domain_detail.derivedFrom`,
-- where they can be read without a join and re-multiplied without re-fetching. What lives here is
-- the thing `domain_detail` cannot hold: a foreign key to an archived document, so each operand's
-- evidence is as retrievable as any other rule's.

CREATE TABLE requirement_sources (
  id             uuid         PRIMARY KEY,              -- UUIDv7, generated in the application

  -- The derived requirement. CASCADE, unlike every other foreign key here: these rows have no
  -- meaning without the requirement, and a requirement is never deleted in normal operation —
  -- superseded rows are kept. RESTRICT would only ever fire during a repair.
  requirement_id uuid         NOT NULL,

  -- The archived original for this instrument. NOT NULL is the whole point of the table: an
  -- operand with no retrievable evidence is the failure being prevented.
  document_id    uuid         NOT NULL,

  -- What this instrument contributed to the computation. `primary` is the instrument that states
  -- the rule itself; the others are its operands.
  role           text         NOT NULL,

  -- The instrument's own identity and dates, denormalised from the document deliberately: a
  -- document is bytes at a URL, while these say *which legal act* those bytes are and when it was
  -- read. An ELI where the jurisdiction publishes one.
  instrument_id  text         NOT NULL,                 -- 'eli/etat/leg/rgd/2008/09/26/n3'
  source_url     text         NOT NULL,
  retrieved_at   timestamptz  NOT NULL,

  created_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_reqsrc__requirements FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE,
  CONSTRAINT fk_reqsrc__documents    FOREIGN KEY (document_id)    REFERENCES documents(id)    ON DELETE RESTRICT,

  -- A closed set, like every other vocabulary in this schema. `formula` states the arithmetic,
  -- `operand` supplies a figure it consumes, `primary` is the instrument imposing the requirement.
  CONSTRAINT ck_reqsrc__role CHECK (role IN ('primary', 'formula', 'operand')),

  -- The same instrument must not be recorded twice in the same role for one requirement — that
  -- would double-count an operand and make the recorded derivation ambiguous.
  CONSTRAINT uq_reqsrc__instrument UNIQUE (requirement_id, instrument_id, role)
);

-- "Show me every instrument behind this requirement" — the audit query the table exists for.
CREATE INDEX idx_reqsrc__requirement ON requirement_sources (requirement_id);

-- "Which requirements depend on this instrument?" — what a changed règlement has to be able to
-- answer, because a rule is stale as soon as its soonest-changing input is.
CREATE INDEX idx_reqsrc__instrument ON requirement_sources (instrument_id);
