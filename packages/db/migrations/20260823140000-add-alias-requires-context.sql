-- `skill_aliases.requires_context` — an alias that is also an ordinary English word.
--
-- **Found by the first live board fetch, not by review.** Running the alias scan over 383 real Lever
-- postings produced 55 skill rows, and **17 of them were `Go`** — of which 14 were ordinary English:
--
--     "Ultimately, when we go to raise our next round…"
--     "Learn Lever's go-to-market messaging…"          ← stored as a *required* skill, weight 0.65
--     "Design features and see them go live"
--     "Go getter"
--
-- The scan already matches whole tokens, so `going` never matched. It cannot help here: normalization
-- strips punctuation, so `go-to-market` becomes the tokens `go to market` and `go` is a whole token
-- inside it. The three-posting fixture could not surface this — its qualifications read "be smart".
--
-- **The fix belongs in the vocabulary, not the scanner.** Whether a string is safe to match bare is a
-- property of that string, and the alias table is where the vocabulary lives. A scanner-side blocklist
-- of phrases (`go to market`, `go live`, `go getter`, …) would be curation wearing code's clothing and
-- would never be finished.
--
-- An alias marked here produces a row **only when another, unambiguous skill matched in the same
-- sentence** — the corroboration rule in `services/ingestion/src/skill-extraction.ts`. Measured against
-- the same 383 postings, that keeps every correct `Go` ("APIs in Python, Ruby or Go", "Node.js or
-- Golang backend services", "Ruby, Python, Go, C++") and drops all fourteen wrong ones.
--
-- Defaults to `false`: an alias is unambiguous unless somebody curating the graph says otherwise. The
-- flag is set from `packages/db/seeds/`, which is the source of truth for curation — this migration
-- adds the column and nothing else, so no judgement about a particular word is frozen into schema
-- history where it cannot be revised.

ALTER TABLE skill_aliases ADD COLUMN requires_context boolean NOT NULL DEFAULT false;

-- What the scan reads: the whole vocabulary, with its ambiguity, in one query.
CREATE INDEX idx_skill_aliases__requires_context ON skill_aliases (requires_context);
