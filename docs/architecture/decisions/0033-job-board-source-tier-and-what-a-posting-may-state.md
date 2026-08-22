# ADR-0033: A Lever board is a tier-2 source, and a posting states only what Lever states structurally

- **Status:** Proposed
- **Date:** 2026-08-22
- **Deciders:** project lead
- **Affects:** `connectors/job-boards/lever`, `connectors/core/src/default-registry.ts`, `.claude/context/knowledge-sources.md`, `docs/database/entities/job.md`

## Context

`connectors/job-boards/lever` is the first job-board connector and **the first job data this product
has had at all**. Every job-shaped feature so far — matching, applications, outcomes — was built
against a person's own records rather than against openings. Two questions had to be answered before
a single row could be written, and neither has an obvious answer.

### The tier is genuinely ambiguous, and the ranking says both things

`.claude/context/knowledge-sources.md` lists, under **tier 1**, *"Official company career pages and
their ATS feeds"*. It lists, under **tier 2**, *"Major job boards and ATS aggregators"*.

A Lever board is describable as either. `api.lever.co/v0/postings/<board>` is the employer's own ATS
feed — the employer wrote the posting, chose its fields, and publishes it — and it is also a feed
served by an ATS vendor on its own domain in its own vocabulary. **The ranking that exists to remove
judgement is, for this source, the thing requiring judgement.**

The choice is not cosmetic. `knowledge-sources.md` maps tier 1 → `high` confidence and tier 2 →
`medium`, and `docs/database/entities/job.md` has a `confidence` column that is `NOT NULL`. Every
posting ever stored carries the consequence.

### The prose is rich, structured pay does not exist, and the two are not the same thing

A Lever posting carries several thousand words of description, lists and plain-text variants. It
carries **no structured salary of any kind**, and its `workplaceType` field says `remote` without
saying what *remote* is scoped to.

Salary and remote scope are, for the person this product serves, close to the two most decisive facts
about an opening. They are also both **recoverable from the prose about half the time** — a
description often names a range, and often says "remote (EU only)". So the pressure to parse is
permanent, will come back in every future job-board connector, and the first person to write that
parser will believe they are adding a feature.

**Getting it wrong is silent.** A parsed salary looks exactly like a published one once it is a
number in a column, and `salary_is_stated` exists precisely because
`docs/database/entities/job.md` already recognised that *"the source published no salary"* and *"the
source published a salary we failed to parse"* are different facts. A wrong remote scope is worse
than a wrong salary: somebody moves.

## Options considered

### Option A — Tier 1, because a board is the employer's own feed

**Advantages.** The employer authored the content, and the API cannot serve an unpublished posting,
so the feed is exactly what the employer chose to publish. Yields `high` confidence, which reads as
the product being confident about job data — the thing it is for.

**Disadvantages.** **It is not the employer's publication; it is Lever's rendering of it.** The
fields are Lever's vocabulary (`commitment: "Regular Full Time (Salary)"`, `workplaceType`,
`categories`), the domain is Lever's, and the availability and shape of the feed are Lever's product
decisions. Tier 1 in this repository has so far meant a statute or an official announcement archived
verbatim; extending that word to an ATS vendor's JSON weakens it everywhere else it is used, including
where immigration rules depend on it.

### Option B — Tier 2, as a platform rendering of the employer's words

**Advantages.** Honest about what the bytes are. `knowledge-sources.md` already says tier 2 is
*"usable as a primary source for job postings and market signal"* — so a job board at tier 2 loses
**nothing** operationally; the tier constrains rules and thresholds, which a job board must never be
the basis of anyway. Keeps tier 1 meaning "the authority's own publication of record".

**Disadvantages.** `confidence: 'medium'` on every posting, including ones whose employer would be
tier 1 if we fetched their own careers page. A person reading a posting cannot tell whether `medium`
means "an ATS served it" or "we are unsure it is real", and the two feel identical in a UI.

### Option C — Decide the tier per board

Tier 1 for boards belonging to companies we have verified, tier 2 otherwise.

**Advantages.** Most precise in principle.

**Disadvantages.** A per-employer verification registry that does not exist, maintained by hand, to
produce a distinction nothing currently reads. It also makes the tier a property of our bookkeeping
rather than of the source, which is the opposite of what the ranking is for.

### Option D — Do nothing: leave the tier unstated and parse what we can

**Advantages.** Ships fastest. Descriptions do contain salaries, and users want them.

**Disadvantages.** `confidence` is `NOT NULL`, so "unstated" resolves to whatever the first ingest
path happens to pass — a decision made by accident, in code, permanently, about every row. And
parsing pay from prose puts an invented number where an authoritative one is expected; nothing
downstream can tell it apart, so every score derived from it inherits it silently.

## Decision

**A Lever board is a tier-2 source, and a posting carries only what Lever states in a structured
field — never anything read out of its prose.** Concretely, three linked decisions:

1. **Tier 2.** `REGISTRATION.sourceTier` and every row's `sourceTier` are `2`, because the employer
   wrote the posting but Lever hosts, shapes and serves it.
2. **Salary is never inferred.** `salaryIsStated` is the literal `false` and the amounts are null,
   because Lever publishes no structured pay. Validation rejects a row claiming otherwise
   (`salary-invented`).
3. **Remote scope is never inferred.** `remoteScope` is literal `null`. `workplaceType` says whether a
   role is remote and nothing says whether that means worldwide, a country or a region. Validation
   rejects an invented scope (`remote-scope-invented`).

The rule behind 2 and 3, which generalises to every future job-board connector: **structured fields
are authoritative; prose is not read.** The same rule already decides `countryCode`, which comes from
the source's ISO-3166 `country` field and is never derived from the free-text location — `"Arlington,
TX"` is carried verbatim for display and never mined, because parsing it would invent a fact the
source already answers properly.

**This ADR decides nothing about persistence.** `job_postings` does not exist, the deduplication key,
retention and employer identity are undecided, and they are a separate architectural boundary.

## Consequences

**Accepted costs.**

- Every Lever posting is `confidence: 'medium'`, including postings from employers whose own careers
  page would be tier 1. A future direct-from-employer connector will produce `high` rows for the same
  opening, and reconciliation will have to prefer one — an unmade decision this makes visible rather
  than creates.
- **A posting whose description states a salary will show no salary.** This will be reported as a bug,
  repeatedly, and the answer is that the source published none. `salaryIsStated: false` is what makes
  that answer checkable rather than a claim.
- Remote roles are not distinguishable by scope, so Lever postings cannot establish that a role is
  remote-worldwide. ADR-0028's `REMOTE` destination gains no reach from this connector.
- `commitment` stays in Lever's vocabulary, unmapped to the designed `employment_type` / `seniority`
  columns. Nothing here invents that mapping.

**Follow-up work.**

- The `job_postings` slice: dedup key semantics, board slug versus employer identity, upsert and
  retention, and whether a posting stays queryable after it leaves the board. Its own decision.
- Whether an employer's own careers page, fetched directly, is tier 1 — deliberately left open, and
  reachable only when such a connector exists.
- A source that *does* publish structured pay is re-decided per source, not by relaxing this globally.
- `docs/architecture/decisions/README.md`'s index is missing 0030–0032 and this ADR; it needs a
  backfill that is not part of the Lever change.

**Reversal cost.** Cheap now, expensive later, which is the argument for deciding before ingest.
Today zero postings are stored, so re-tiering is an edit to one constant. Once postings exist,
changing the tier means rewriting stored `confidence` and re-deriving everything computed from it,
and reversing decisions 2 or 3 means backfilling fields for rows whose source bytes may no longer be
fetchable — the archived board payload is what would have to carry it.

## Compliance

- **The type system, first.** `JobPostingRecord.salaryIsStated` is the literal type `false` and
  `remoteScope` is `null`; `sourceTier` is the literal `2`. Inventing any of the three is a compile
  error before it is a validation failure.
- **`validate` second**, for data arriving from outside the type system: codes `salary-invented` and
  `remote-scope-invented` are errors, so `isIngestible` refuses the batch.
- **Tests name the rule**: `connectors/job-boards/lever/src/normalize.test.ts` — *"never states a
  salary"*, *"never states a remote scope"*, *"takes the country from the field that states it, never
  from the location text"*, and the two validation refusals.
- **The registration is asserted**: the same file checks `REGISTRATION.sourceTier === 2` and that
  `legalBasis` records why the source may be read at all.
- A reviewer seeing a description parser in a job-board connector's diff should read this ADR as the
  reason to reject it.

## Related

- ADR-0002 — the connector plugin model, and the registry as the only module naming a connector
- ADR-0021 — why the board as served is archived
- ADR-0028 — `REMOTE` as a destination, which this connector cannot yet inform
- `.claude/context/knowledge-sources.md` — the tier ranking this interprets
- `docs/database/entities/job.md` — `salary_is_stated`, `remote_scope`, `confidence`
- `connectors/job-boards/lever/README.md` — what the connector does and does not model
