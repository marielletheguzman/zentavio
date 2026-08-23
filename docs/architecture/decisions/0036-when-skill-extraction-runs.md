# ADR-0036: Extraction is its own pass over postings that record whether they were extracted, never a step inside the ingest transaction

- **Status:** Accepted
- **Accepted:** 2026-08-23
- **Date:** 2026-08-23
- **Deciders:** project lead
- **Affects:** `packages/db` (`job_postings`, `packages/db/src/repositories/posting-skills.ts`), `services/ingestion` (`skill-extraction.ts`, `posting-executor.ts`, `scheduled-run.ts`), `docs/database/entities/job.md`

## Context

ADR-0035 settled **what** an extracted skill may claim, and #152 built it: `job_posting_skills`, the
deterministic alias scan, and the constraints that hold the ADR's rules in schema form.

Nothing calls it. `extractSkills` and `rowsFor` are pure functions with a test suite and no caller,
and `replacePostingSkills` has no writer. The remaining question is **when extraction runs**, and it
is not a scheduling detail — the obvious answers are both wrong for a reason the schema currently
hides.

### The constraint that makes this non-obvious

**A posting's extraction state is not recorded anywhere.** `extractor_version` lives on
`job_posting_skills` rows, and a posting that extracts zero skills writes zero rows. So a posting
never extracted and a posting extracted successfully that mentions no curated skill are **the same
row shape**: no children, no marker, nothing.

That is the failure this repository keeps finding and naming, one layer further out:

| Where | The silence | What was done about it |
|---|---|---|
| `job_postings.is_remote` | null ≠ false — a silent source is not an on-site job | nullable, and `IS TRUE` in the CHECK |
| `job_postings.salary_is_stated` | "published none" ≠ "we failed to parse one" | its own generated column |
| `PostingExecutionReport.sweepRefusedBecause` | a silent decline ≠ a sweep that found nothing | never null when no sweep ran |
| `connectors/core` `unwired()` | an unwired source ≠ a source that answered with nothing | throws with the source named |
| **extraction** | **never extracted ≠ extracted, nothing matched** | **nothing yet — this ADR** |

The practical consequence is immediate and measurable. A sweep that selects postings with no
`job_posting_skills` row at the current `EXTRACTOR_VERSION` re-extracts every skill-less posting on
every pass, forever. On the corpus that exists today — three postings from Lever's demo board whose
qualifications read *"be smart"*, matching no curated skill — that is **100% of postings, on every
run**. The sweep would never converge, and it would look like it was working.

### Why `updated_at` cannot stand in for it

The tempting query is *"postings whose `updated_at` is later than their skills' `created_at`"*. It
does not hold: `upsertPostingFromSource` bumps `updated_at` to `now()` on every sighting, including
the `refused-lower-tier` branch that writes no fields at all
(`packages/db/src/repositories/jobs.ts:282`, and again at `:332`). `updated_at` on this table means
*we saw this posting again*, not *its text changed*. A re-extraction keyed on it fires on every run
of every board and reproduces byte-identical rows, because the scan is deterministic.

### Why extraction does not belong inside the ingest transaction

`posting-executor.ts` opens with *"The executor **decides nothing**"*, and its transaction exists for
one reason stated in the same comment: a board either updates and sweeps, or does neither. Extraction
inside that boundary changes three things:

- The executor starts deciding — which postings to extract, against which vocabulary.
- The transaction grows to hold the whole `skill_aliases` index and a scan over every posting's prose,
  so a graph query failure now rolls back a board's ingest. Fetching a board and reading the skill
  graph become one atomic unit, which they are not.
- A `refused-lower-tier` posting, whose fields were **not** written, would be extracted against text
  this run did not supply.

There is also a boundary question. Extraction reads `skill_aliases`, which is the skill graph; ingest
reads a connector. Coupling them means a board cannot be ingested while the graph is being reseeded.

## Options considered

### Option A — Extract inside `executePostingPlan`'s transaction

**Pros.** Exactly one pass; a posting is never briefly stored-but-unextracted; no new column.

**Cons.** Every objection above. Additionally: re-extraction after `EXTRACTOR_VERSION` changes is
impossible without re-fetching every board, which turns a code change into network traffic against
sources whose `robots.txt` we honour with a crawl delay.

### Option B — Extract after the transaction, inside `runJobBoards`

**Pros.** Keeps the executor pure; still one entry point.

**Cons.** Solves none of the version-drift problem — a posting extracted at `alias-scan@1.0.0` stays
at it until its board is ingested again, and a board that stops changing never re-extracts. Also
introduces a real half-state: postings committed, extraction failed, and nothing recording that.

### Option C — A sweep only, keyed on `job_posting_skills.extractor_version`

**Pros.** Handles version drift, which is the case Options A and B cannot. Decoupled from ingest.

**Cons.** **This is the option that does not work**, for the reason in Context: with no marker on the
posting, "no rows at the current version" cannot distinguish never-extracted from extracted-and-empty,
so the sweep never converges and its backlog is permanently the size of the skill-less corpus. Making
it converge requires exactly the column Option D adds — at which point it is Option D minus the ingest
half.

### Option D — A marker on the posting, and extraction as its own pass

Add to `job_postings`:

```sql
extracted_at      timestamptz NULL,  -- when extraction last completed for this posting
extracted_version text        NULL,  -- the EXTRACTOR_VERSION that completed it
```

Both null means never extracted. Both set with zero `job_posting_skills` rows means **extracted, and
this posting asks for nothing we curate** — which is a real and common answer, and currently the
answer for the entire corpus.

- Extraction becomes `extractDuePostings(db, deps)` in `services/ingestion`, selecting postings where
  `extracted_version IS DISTINCT FROM $current` (which covers null), live and not expired.
- A run stamps the marker **whether or not it wrote rows**. A posting that matches nothing is done,
  not retried.
- `upsertPostingFromSource` clears the marker — `extracted_at = NULL, extracted_version = NULL` — only
  when it actually writes a new `description` or `requirements_text`. Not on a sighting, not on
  `refused-lower-tier`. That is the "text changed" signal `updated_at` cannot give.
- The clearing happens inside the ingest transaction (it is a field write like any other); the
  extraction itself does not.

**Pros.** Version drift and text change are both handled, by one mechanism. The sweep converges. The
"extracted, found nothing" state becomes storable and therefore reportable — a run can say *"18
postings extracted, 18 matched nothing"*, which is the sentence that would have told us the corpus is
the problem. Ingest and the skill graph stay decoupled.

**Cons.** A migration and two columns on a wide table. A window where a posting is stored and
unextracted, which matching must read as `unknown` rather than "no requirements" — that distinction
is exactly what the marker makes available, but `services/matching` has to honour it. Two callers to
trigger instead of one.

### Option E — Do nothing

`job_posting_skills` stays empty and matching stays blocked. Honest, and it is where we are.

**Cons.** #152 shipped a table, a scan and a test suite with no writer. Leaving it is how a repository
accumulates code that looks finished.

## Decision

**Option D.** Extraction runs as its own pass over postings whose recorded `extracted_version` is not
the current one, and a posting records that it was extracted even when it yields no skills; ingest's
only involvement is clearing that marker when it actually rewrites a posting's prose.

## Consequences

**Accepted costs.** Two nullable columns on `job_postings` and a migration. A posting is briefly
stored-but-unextracted, and `services/matching` must render that as `unknown` rather than "asks for
nothing" — a distinction it cannot currently make, and one this ADR is what makes possible. The
marker records that extraction *completed*, not that it was *correct*; a bad `EXTRACTOR_VERSION` bump
is still the only way to force a redo.

**Follow-up work.**
1. Migration adding `extracted_at` and `extracted_version`, with the column comments carrying the
   never-extracted / extracted-empty distinction.
2. `extractDuePostings` in `services/ingestion`, with the alias index loaded once per run
   (`aliasIndex` already does this deliberately).
3. `upsertPostingFromSource` clears the marker on a prose write only — with a test asserting a
   sighting and a `refused-lower-tier` write both leave it alone, since that is the whole point.
4. An integration test for the convergent case: extract a posting matching nothing, run again, assert
   it is **not** re-selected.
5. `docs/database/entities/job.md` and `docs/features/job-matching.md` updated in the same change
   (principle 5).

**What this ADR deliberately does not decide.** *Who calls `extractDuePostings`.* That is the same
open question as `runDueJobBoards`, and it has the same answer: a trigger is a deployment decision and
nothing is deployed (ADR-0015, ADR-0021). Both stay functions with no daemon. Writing a scheduler now
would produce an undeployable component that looks finished.

**Reversal cost.** Low. The columns are additive and nullable; dropping them and moving the call into
`runJobBoards` is Option B, a migration and one call site. The signal that would say to reverse: if
postings turn out to be extracted exactly once and never re-extracted in practice — no version bumps,
no prose rewrites — the marker is carrying no information and the pass is ceremony.

## Compliance

- `ck_jp__extraction_marker_paired CHECK ((extracted_at IS NULL) = (extracted_version IS NULL))` — a
  half-set marker is a bug, and the schema refuses it rather than trusting review.
- An integration test asserting a second `extractDuePostings` run does not re-select a posting that
  matched nothing. This is the one that fails if Option C is reintroduced by accident.
- An integration test asserting a sighting and a `refused-lower-tier` write both leave `extracted_at`
  set.
- The existing jurisdiction-free AST test and `eslint.config.mjs` boundary rules are unaffected:
  extraction stays in `services/ingestion`, and it names no connector.

## Related

- ADR-0035 — what an extracted requirement may claim; this decides when the claim is made
- ADR-0034 — posting identity and lifecycle, including why absence expires nothing
- ADR-0018 — the division between what a model proposes and what code computes
- ADR-0015, ADR-0021 — why no trigger is written here
- `docs/database/entities/job.md`, `docs/features/job-matching.md`
