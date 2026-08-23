-- Sponsorship, relocation and immigration assistance as stated by the employer (ADR-0039).
--
-- **`unknown` is the default and is not evidence of absence.** Measured on the first real board this
-- repository stored — 239 Zoox postings — only 3 mention sponsorship, visa or relocation at all, and
-- two of those three are the wrong sense of the word:
--
--     "...partnering with stakeholders across engineering and earning executive sponsorship."
--     "...often involving complex compensation, negotiation, and relocation strategies."
--
-- Stakeholder buy-in, and a recruiter's job description. The third is genuine and still does not state
-- availability: "Company visa sponsorship and relocation assistance details will be provided during
-- the interview process", paired with employment being "contingent upon obtaining valid US work
-- authorization" — an obligation on the candidate, not an offer from the employer.
--
-- So a strict reading of a real board yields zero `stated_available`, and a keyword reading yields two
-- false positives. This schema encodes the strict reading, because a false positive here tells
-- somebody a job solves their immigration problem when it does not.
--
-- **Two rules, both as CHECKs rather than as prose somebody must remember:**
--
--   * A status other than `unknown` requires its span. The `ck_jpsk__extracted_has_span` pattern from
--     ADR-0035, applied where the cost of an unverifiable claim is highest.
--   * `inferred_likely` is refused outright. It belongs to sponsor registries and aggregated
--     outcomes — employer-level sources with no table and, `company_id` being null on every posting,
--     no join key either. Reserved the way `stated-requirement` is reserved on `job_posting_skills`:
--     the column admits the value for the day a source exists, and nothing may write it before then.
--
-- **The marker pair is deliberately separate from skill extraction's** (ADR-0036's `extracted_at` /
-- `extracted_version`). Two independent deterministic transformations over the same text: one marker
-- cannot identify which version of which algorithm ran, and sharing would make an alias-scan bump
-- re-run sponsorship and a sponsorship-rule change re-run the whole skill corpus. Two nullable
-- columns is the honest cost of keeping "processed by this version of this pipeline" answerable per
-- pipeline.

ALTER TABLE job_postings ADD COLUMN visa_sponsorship            text NOT NULL DEFAULT 'unknown';
ALTER TABLE job_postings ADD COLUMN visa_sponsorship_span       text;
ALTER TABLE job_postings ADD COLUMN relocation_support          text NOT NULL DEFAULT 'unknown';
ALTER TABLE job_postings ADD COLUMN relocation_support_span     text;
ALTER TABLE job_postings ADD COLUMN immigration_assistance      text NOT NULL DEFAULT 'unknown';
ALTER TABLE job_postings ADD COLUMN immigration_assistance_span text;

-- Sponsorship extraction's own state. Both null means never run; both set with every status still
-- `unknown` means run, and this posting says nothing — the ADR-0036 distinction, kept per pipeline.
ALTER TABLE job_postings ADD COLUMN sponsorship_extracted_at      timestamptz;
ALTER TABLE job_postings ADD COLUMN sponsorship_extracted_version text;

ALTER TABLE job_postings
  ADD CONSTRAINT ck_job_postings__visa_sponsorship
  CHECK (visa_sponsorship IN ('stated_available','stated_unavailable','inferred_likely','unknown'));
ALTER TABLE job_postings
  ADD CONSTRAINT ck_job_postings__relocation_support
  CHECK (relocation_support IN ('stated_available','stated_unavailable','inferred_likely','unknown'));
ALTER TABLE job_postings
  ADD CONSTRAINT ck_job_postings__immigration_assistance
  CHECK (immigration_assistance IN ('stated_available','stated_unavailable','inferred_likely','unknown'));

ALTER TABLE job_postings
  ADD CONSTRAINT ck_job_postings__visa_sponsorship_span
  CHECK (visa_sponsorship = 'unknown' OR visa_sponsorship_span IS NOT NULL);
ALTER TABLE job_postings
  ADD CONSTRAINT ck_job_postings__relocation_support_span
  CHECK (relocation_support = 'unknown' OR relocation_support_span IS NOT NULL);
ALTER TABLE job_postings
  ADD CONSTRAINT ck_job_postings__immigration_assistance_span
  CHECK (immigration_assistance = 'unknown' OR immigration_assistance_span IS NOT NULL);

-- ADR-0039 rule 3, in schema form.
ALTER TABLE job_postings
  ADD CONSTRAINT ck_job_postings__no_inferred_sponsorship
  CHECK (
    visa_sponsorship <> 'inferred_likely'
    AND relocation_support <> 'inferred_likely'
    AND immigration_assistance <> 'inferred_likely'
  );

ALTER TABLE job_postings
  ADD CONSTRAINT ck_job_postings__sponsorship_marker_paired
  CHECK ((sponsorship_extracted_at IS NULL) = (sponsorship_extracted_version IS NULL));

-- What the sponsorship pass selects on. `IS DISTINCT FROM` covers null, so never-processed rows are
-- found by this index rather than by a second scan.
CREATE INDEX idx_job_postings__sponsorship_extraction
  ON job_postings (sponsorship_extracted_version)
  WHERE deleted_at IS NULL AND expired_at IS NULL;
