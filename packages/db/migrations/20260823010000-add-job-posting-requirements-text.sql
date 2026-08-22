-- `job_postings.requirements_text` — the source's own requirement lists, as plain text.
--
-- `description` has existed since `20260822233000` and has never held a value: the shared
-- `JobPosting` type carried no such field, so the column was reachable and unreached. Both are
-- populated from this migration onward.
--
-- **Two columns, not one.** `description` is the posting's prose; this is where a posting states what
-- it wants — Lever's "Qualifications" and "Duties" lists. Merging them would lose which sentences
-- were requirements and which were the company describing itself, which is exactly the distinction
-- skill extraction depends on.
--
-- **Stored, never read for facts.** ADR-0033 forbids mining prose for a salary, a country or a remote
-- scope, and that does not change here. This exists so extraction has an input at all: a posting
-- ingested without it can never be extracted from without fetching it again, and the raw payload is
-- archived only where a document store is configured — which today is nowhere.
--
-- Nullable, because a posting may genuinely state no requirements, and an empty string would make
-- "said nothing" indistinguishable from "we stored nothing".

ALTER TABLE job_postings ADD COLUMN requirements_text text;
