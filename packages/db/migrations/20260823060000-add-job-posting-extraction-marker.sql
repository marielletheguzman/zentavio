-- `job_postings.extracted_at` / `extracted_version` — whether extraction has read this posting, and
-- at which version (ADR-0036).
--
-- **Why this is not already answered by `job_posting_skills.extractor_version`.** That column says
-- how an existing skill row was produced. It cannot say whether a posting was ever read, because a
-- posting that extracts zero skills writes zero rows. So a posting never extracted and a posting
-- extracted successfully that mentions nothing the graph curates are the **same row shape**: no
-- children, no marker, nothing.
--
-- A pass keyed on the child rows therefore re-selects every skill-less posting on every run, forever.
-- On the corpus that exists today — three Lever demo postings whose qualifications read "be smart",
-- matching no curated skill — that is 100% of postings on every run, and it would look like it was
-- working. Both null here means never extracted; both set with no `job_posting_skills` rows means
-- extracted and this posting asks for nothing we curate, which is a real and currently universal
-- answer.
--
-- This is the same distinction `salary_is_stated` holds for pay and nullable `is_remote` holds for
-- workplace: the schema records that we looked, separately from what we found.
--
-- **Why not `updated_at`.** `upsertPostingFromSource` bumps `updated_at` on every sighting, including
-- the `refused-lower-tier` branch that writes no fields at all. On this table it means "we saw this
-- posting again", not "its text changed". The marker is cleared only where `description` or
-- `requirements_text` actually changes value, which is the signal `updated_at` cannot give.
--
-- Nullable and no default: a backfill stamping every existing posting would claim they were all
-- extracted, which is the false-completeness this column exists to make impossible.

ALTER TABLE job_postings ADD COLUMN extracted_at      timestamptz;
ALTER TABLE job_postings ADD COLUMN extracted_version text;

-- A timestamp with no version cannot be compared against the current extractor, and a version with
-- no timestamp cannot say when it ran. Half a marker is a bug, and the schema refuses it.
ALTER TABLE job_postings
  ADD CONSTRAINT ck_job_postings__extraction_marker_paired
  CHECK ((extracted_at IS NULL) = (extracted_version IS NULL));

-- What the extraction pass selects on: live postings whose recorded version is not the current one.
-- `extracted_version IS DISTINCT FROM $1` covers null, so never-extracted rows are found by the same
-- index rather than by a second scan.
CREATE INDEX idx_job_postings__extraction
  ON job_postings (extracted_version)
  WHERE deleted_at IS NULL AND expired_at IS NULL;
