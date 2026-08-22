-- `job_postings.url` — where a person applies.
--
-- **This was missing, and the omission was invisible until a runner wired the path end to end.** The
-- Lever connector refuses to produce a posting with neither a hosted URL nor an apply URL, on the
-- grounds that "a job we cannot link to is a job somebody cannot apply for" — and then persistence
-- dropped the link on the floor. `job_posting_sources.source_url` is the API endpoint the payload was
-- read from, which is provenance, not somewhere a person can go.
--
-- `NOT NULL` with no default and no backfill, because the table is empty everywhere: it was created
-- hours ago (`20260822233000`) and nothing has ever ingested into it outside a test database that is
-- dropped and rebuilt per run. A default here would be a placeholder URL, which is worse than the
-- missing column — it would look like an answer.

ALTER TABLE job_postings ADD COLUMN url text NOT NULL;

-- Two live postings may legitimately share an apply URL — one employer, one form, several roles — so
-- this is not unique. It is indexed because "is this posting already known by its link?" is the
-- question a person's saved job asks.
CREATE INDEX idx_job_postings__url ON job_postings (url) WHERE deleted_at IS NULL;
