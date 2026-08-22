# ADR-0035: A skill read out of a posting's prose is a mention with a span, never a stated requirement

- **Status:** Accepted
- **Accepted:** 2026-08-23
- **Date:** 2026-08-23
- **Deciders:** project lead
- **Affects:** `ai/` (a new extraction capability), `packages/db` (`job_posting_skills`), `services/matching`, `docs/prompts/`, `docs/database/entities/job.md`, `docs/features/job-matching.md`

## Context

`docs/features/job-matching.md` builds the Job Match Score from `profile_skills × job_posting_skills`.
`profile_skills` exists and is populated. `job_posting_skills` is designed and unbuilt, and the input
it needs has existed for exactly one merge: #149 stored a posting's `description` and its
`requirements_text` for the first time.

So matching is blocked on a question that is not about code: **what may a skill read out of prose
claim about the job?**

### Why this is not obvious

`.claude/context/ai-principles.md` rule 10 is unambiguous: *"The AI never fabricates a job
requirement. Requirements come from the posting or from market intelligence — not from what such a
role 'usually' needs."* Extraction reads the posting, so it satisfies the letter of the rule. It is
the **strength** of the resulting claim that the rule does not settle, and the two failure directions
are asymmetric.

**Overclaiming is invisible and expensive.** A row saying a posting *requires* Kubernetes, when the
sentence was *"our platform runs on Kubernetes"*, produces a skill gap the person does not have and a
learning path they do not need. It looks identical to a real requirement once it is a row with a
weight, and the person cannot check it — they never see the sentence.

**Underclaiming is visible and cheap.** Extracting nothing leaves matching at `status: 'unknown'`,
which the schema already supports and the feature doc already specifies. The product looks
incomplete, which it is.

**And there is a third failure specific to this repository.** `job_posting_skills.basis` already
declares three values — `stated-requirement`, `description-extraction`, `market-frequency`. If
extraction writes `stated-requirement`, the distinction the column exists for is gone on the first
row, and nothing downstream can ever separate what a source stated from what we inferred.

### What the corpus actually is today

Three postings from Lever's own demo board, whose qualifications read *"be smart"* and *"be very
smart"*. **No board has ever been fetched live.** An eval suite built on this corpus measures nothing
about real postings, and that is a constraint on when this can be considered validated, not a reason
to defer the decision.

## Options considered

### Option A — The model extracts requirements, with weights

A prompt returns skills and importance; code stores them.

**Advantages.** Simplest pipeline, highest recall, closest to what a reader would call "the skills for
this job".

**Disadvantages.** **A model-produced weight cannot be recomputed**, so `matches` loses reproducibility
— the same posting scored twice may differ, and `scorer_version` stops meaning anything (ADR-0034's
`match.md` requires byte-identical re-derivation). It also puts judgment where the repository has
already measured that judgment belongs in code: ADR-0018 decided *"code owns resolution and
classification; the model supplies recall"* for résumé skills, on evidence, and a posting is the same
problem viewed from the other side.

### Option B — The model proposes spans; code resolves, classifies and weights

The model returns **verbatim spans** it believes name a skill. Code resolves each span against the
skill graph's alias registry, decides whether the span sits in a requirement list or in prose, and
computes the weight deterministically. Anything the registry cannot resolve is dropped.

**Advantages.** Reuses ADR-0018's division, which was chosen on measurement rather than taste. Every
row carries the sentence it came from, so a person can check it and a reviewer can audit it. Weights
are recomputable, so `matches` stays reproducible. An unresolvable span is a knowledge-graph gap, which
is a fact worth having, rather than an invented skill.

**Disadvantages.** Recall is bounded by the alias registry: a real skill nobody has curated is
silently absent. Two moving parts to version rather than one. Slower to build than Option A.

### Option C — Deterministic alias matching, no model at all

Scan the prose for known skill aliases directly.

**Advantages.** No prompt, no eval suite, no model host, fully reproducible, cheapest by a wide margin.
Honest by construction — it can only find skills we already curate.

**Disadvantages.** Misses ordinary phrasing (*"experience with container orchestration"*), and
mis-fires on prose mentions the same way Option A does unless section awareness is added anyway. It is
**not wrong**, and it is what should run when no model is configured — which is why it survives as the
degraded path rather than as the whole answer.

### Option D — Do nothing: matching reports `unknown` indefinitely

**Advantages.** Costs nothing and lies about nothing. `matches` already supports `status: 'unknown'`
with `missing` populated, and the feature doc specifies that path.

**Disadvantages.** The product's central question — *which of these jobs is worth my time?* — goes
permanently unanswered, and a career platform that cannot compare a person to an opening is not
deferring a feature, it is missing its purpose.

## Decision

**Option B**, with Option C as its degraded path, and four rules on what a row may claim. Accepted
2026-08-23 by the project lead. Acceptance binds the implementation to these rules; it authorises no
code by itself.

### 1 — Basis is `description-extraction`, and `stated-requirement` is reserved

A row produced by reading prose carries `basis: 'description-extraction'`, **always**.
`stated-requirement` is reserved for a source that states requirements in a structured field. Lever
has none, so today no row may carry it, and the first source that does will not need a schema change
to say so.

### 2 — Every row carries the verbatim span it came from

`source_span` is **required** for an extracted row, holds the sentence as published, and is never
paraphrased. This is the résumé parser's rule (M1: a verbatim source span on every claim) applied to
the other side of the match. A requirement whose sentence cannot be shown is not storable.

### 3 — `is_required` may only come from a requirement list

A skill found in `requirements_text` may be marked required. A skill found in `description` may not —
it is a mention, stored with `is_required: false`. *"Our platform runs on Kubernetes"* and *"5 years of
Kubernetes"* are different claims, and #149 kept them in separate columns precisely so this rule can
be enforced structurally rather than guessed at.

### 4 — Weights are computed by code, never returned by a model

From the section a span sits in, whether the skill is repeated, and the requirement count of the
posting. Deterministic, so the same posting yields the same weights and `matches` stays reproducible.

### The division, and the degraded path

The model **only** proposes spans. Code resolves each span to a skill id through the alias registry,
drops what it cannot resolve, applies rules 3 and 4, and writes the row. With no model configured, the
alias scan (Option C) runs alone and every row is marked as such — the same shape as
`ZENTAVIO_PARSER_ENRICHMENT=off`, where the parser produces a complete deterministic profile and says
enrichment did not run (ADR-0018).

## Consequences

**Accepted costs.**

- **Recall is bounded by the skill graph.** A skill nobody curated is invisible however plainly the
  posting states it, and the person sees a gap that is ours, not theirs. The unresolvable spans are
  worth counting — they are the curation backlog, in priority order.
- **Prose mentions never mark a requirement**, so a posting that states its real requirements only in
  narrative form is under-extracted. That is the direction we accept being wrong in.
- **Two versioned artefacts** — prompt version and extractor version — both recorded on every row, and
  both must move before a re-extraction means anything.
- **Matching stays `unknown` for any posting with no resolvable skills**, and that will be common
  early. Better than a score built on nothing.

**Follow-up work.**

- `job_posting_skills` migration, with `source_span` NOT NULL for extracted rows.
- The extraction capability under `ai/`, its prompt under `docs/prompts/`, and an eval suite.
- **A real corpus.** The only postings that exist are three from a demo board written by Lever to
  demonstrate Lever. An eval built on them measures the harness, not the extraction — so evals gate
  the *scorer*, and validation of extraction quality waits on live boards being fetched.
- `docs/features/job-matching.md` to state that `stated-requirement` is currently unreachable.

**Reversal cost.** Low for the pipeline, high for the data. Re-extraction is a re-run; but rows written
under a looser rule cannot be tightened afterwards — nothing records which `stated-requirement` rows
would have been mentions. That asymmetry is why the strict rule ships first and is relaxed only with
evidence, never the other way round.

## Compliance

- **Schema.** `basis` CHECK already constrains the three values; extracted rows additionally require
  `source_span`, enforced by constraint rather than convention.
- **A test asserts no row carries `stated-requirement`** while no source supplies structured
  requirements — it fails the day one does, which is the day someone should read this ADR again.
- **A test asserts `is_required` is false for every row whose span came from `description`**, using a
  posting whose prose mentions a skill the requirement list omits.
- **Reproducibility.** Extracting the same posting twice yields identical rows, weights included —
  asserted exactly, never as a range, since a range would hide the non-determinism it exists to catch.
- **The model returns spans only.** A test feeds a stub returning weights and skill ids and asserts
  they are ignored: the contract is enforced against the code, not against the prompt's good behaviour.

## Related

- ADR-0018 — code owns resolution and classification; the model supplies recall
- ADR-0033 — what a job-board source may claim, and why prose is not read for facts
- ADR-0034 — identity and lifecycle of the postings this reads
- ADR-0030 — the precedent for refusing a weaker signal the label of a stronger one
- `.claude/context/ai-principles.md` — rule 10, and the confidence rules
- `docs/database/entities/job.md` — `job_posting_skills`, `basis`, `source_span`
- `docs/features/job-matching.md` — where these rows become a score
