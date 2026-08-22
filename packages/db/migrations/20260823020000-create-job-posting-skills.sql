-- `job_posting_skills` — what a posting asks for, and how we came to think so (ADR-0035).
--
-- The table `entities/job.md` designed and `docs/features/job-matching.md` scores against. It exists
-- now because #149 gave it an input: a posting's prose and, separately, its requirement lists.
--
-- **The constraints here are ADR-0035 in schema form.** The ADR's rules are worth nothing as prose in
-- a document nobody rereads; each one that can be a constraint is one.
--
--   * `basis` — a row read out of prose is `description-extraction`. `stated-requirement` is reserved
--     for a source that states requirements in a structured field, and no current source does. If
--     extraction were allowed to write it, the distinction the column exists for would die on the
--     first row and nothing downstream could ever separate what a source said from what we inferred.
--   * `source_span` — required for anything extracted. A requirement whose sentence cannot be shown
--     is not storable: the résumé parser's rule (M1: a verbatim span on every claim), applied to the
--     other side of the match.
--   * `is_required` — true only where the span came from a requirement list. "Our platform runs on
--     Kubernetes" and "5 years of Kubernetes" are different claims, and `ck_jpsk__required_from_list`
--     is what keeps a mention from becoming a requirement.
--   * `extractor_version` — deterministic weights mean a re-extraction reproduces the row, and the
--     version is what says which arithmetic produced it. `prompt_version` is null when no model was
--     involved, which is the whole of the alias-scan path.

CREATE TABLE job_posting_skills (
  id                uuid         PRIMARY KEY,          -- UUIDv7, app-generated
  job_posting_id    uuid         NOT NULL,
  skill_id          uuid         NOT NULL,

  -- Importance to this posting, computed by code from where the span sits and how often it recurs.
  -- Never returned by a model: a weight nobody can recompute makes `matches` irreproducible.
  weight            numeric(4,3) NOT NULL,
  basis             text         NOT NULL,
  is_required       boolean      NOT NULL DEFAULT false,
  -- Which field the span was found in. `requirements` is the only section that may mark a row
  -- required, and storing it means a later reader can check that rather than trust it.
  section           text         NOT NULL,
  -- The sentence as published, never paraphrased.
  source_span       text,

  extractor_version text         NOT NULL,
  -- Null when no model was involved — the alias-scan path, and the shape a run with no model host
  -- produces (ADR-0018's `ZENTAVIO_PARSER_ENRICHMENT=off` precedent).
  prompt_version    text,

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_jpsk__job_postings FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_jpsk__skills       FOREIGN KEY (skill_id)       REFERENCES skills(id)       ON DELETE RESTRICT,

  CONSTRAINT ck_jpsk__weight CHECK (weight >= 0 AND weight <= 1),
  CONSTRAINT ck_jpsk__basis CHECK (basis IN ('stated-requirement','description-extraction','market-frequency')),
  CONSTRAINT ck_jpsk__section CHECK (section IN ('requirements','description','structured')),
  -- ADR-0035: anything read out of prose shows the sentence it came from.
  CONSTRAINT ck_jpsk__extracted_has_span CHECK (basis <> 'description-extraction' OR source_span IS NOT NULL),
  -- ADR-0035: a mention in the company's own prose is not a requirement.
  CONSTRAINT ck_jpsk__required_from_list CHECK (is_required = false OR section IN ('requirements','structured'))
);

-- One row per skill per posting: re-extracting updates rather than accumulating duplicates.
CREATE UNIQUE INDEX uq_jpsk__posting_skill ON job_posting_skills (job_posting_id, skill_id);
CREATE INDEX idx_jpsk__skill ON job_posting_skills (skill_id);
-- What matching reads: this posting's requirements, heaviest first.
CREATE INDEX idx_jpsk__posting_weight ON job_posting_skills (job_posting_id, weight DESC);
