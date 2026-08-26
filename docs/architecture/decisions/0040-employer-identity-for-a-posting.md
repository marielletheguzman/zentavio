# ADR-0040: A posting's employer comes from a curated, sourced board-to-employer binding resolved at ingest, and a board slug is never an alias

- **Status:** Proposed
- **Date:** 2026-08-25
- **Deciders:** project lead
- **Affects:** `packages/db` (`companies`, `company_aliases`, `job_board_employers`, `job_postings`), `services/ingestion`, `connectors/core`, `connectors/job-boards/lever`, `docs/database/entities/company.md`, `docs/database/entities/job.md`

## Context

`docs/roadmap/backlog.md` names the jobs discovery surface as the consumer of everything #141–#165
built, and ADR-0039 deferred one prerequisite explicitly:

> **`employer_sponsorship_facts` is not built by this decision.** Its key does not exist. Employer
> resolution is its prerequisite and belongs to its own slice.

This is that slice. **The algorithm is not the gap.** `docs/database/entities/company.md` already
specifies resolution end to end — exact `primary_domain`, then `company_aliases.normalized`, then a
new company at the tier its source justifies, and **never fuzzy** — `companies` and `company_aliases`
exist with their constraints, and `normalizeCompanyAlias` is implemented and tested in
`packages/db/src/seed.ts`.

**The gap is the input.** `company_id` and `company_name_raw` are null on all 239 stored Zoox
postings, and that is a decision rather than an omission. `connectors/job-boards/lever/src/parse.ts`:

```ts
// A board slug is a namespace, never an employer.
sourceScope: context.board,
…
// Lever names no employer. Deriving one from the board slug is the invention this refuses.
companyNameRaw: null,
```

ADR-0034 recorded why, and recorded it as general: *"a per-employer feed is precisely the case where
the employer is context rather than content"*. The payload confirms it — no field in a Lever posting
names a company; the slug appears only in the `hostedUrl` path.

So resolution over the stored corpus resolves nothing, and will keep resolving nothing however well
it is written. **What is undecided is where employer identity enters at all**, and the honest answers
disagree about which layer is allowed to assert it.

### Why this cannot be answered by pointing at an existing table

`connector_sources.id` is the connector's own `meta.id` — `lever` — one row per connector, not per
board. The board lives on the posting as `source_scope`, and on nothing else. **There is no per-board
row in this database to hang an employer on**, which is why every option below either invents a place
or abuses one.

### What the wrong answer costs here

An employer identity is the join key for `employer_sponsorship_facts`, for `outcomes`, and for
`applications`. `company.md` already states the asymmetry: *"An unresolved company is a visible gap; a
wrongly merged one is not."* A posting attributed to the wrong employer moves somebody's outcome data
onto a company they never applied to, and — once ADR-0039's registry half exists — tells them an
employer sponsors when a different one does.

## Options considered

### Option A — A curated board-to-employer binding, in its own table, with provenance

`(source_id, source_scope)` binds to a `company_id`, carrying `source_tier`, `source_url` and
`retrieved_at`: a stated, checkable claim that *this board is operated by this employer*. Ingest reads
it and writes `company_id`; the connector is untouched and still emits `companyNameRaw: null`.

**Advantages.** The assertion is made by a person against a source, once per board, and is visible as
data with its own provenance — the shape ADR-0025 established for `requirement_sources`. No inference
enters the connector, so `normalize` stays pure and ADR-0034's rule holds unchanged. A wrong binding
is one row to correct, and `retrieved_at` says how old the check is. It also gives the acquisition
case a home: a board that changes hands is a new binding row, and `companies.merged_into` already
carries the rest.

**Disadvantages.** Manual, one row per board, and it does not scale to a thousand boards without a
connector to feed it. A binding is a claim that silently decays — a board sold to another employer
keeps serving postings under the old slug — and nothing detects that automatically. It adds a table
for what looks like configuration.

### Option B — Treat the board slug as a company alias

Write `zoox` into `company_aliases` and let existing resolution find it.

**Advantages.** No new table. Resolution is already implemented against that key.

**Disadvantages.** **`uq_company_aliases__normalized` is global**, so a board slug competes in the same
namespace as real names. A board called `apple` operated by a small employer would resolve every one
of its postings to Apple, and the row would look exactly like a correct one. It also erases the
distinction ADR-0034 drew — the slug stops being a namespace the moment it is stored as a name — and
`company.md` says that table holds *"externally observed names"*, which a slug is not. The failure is
the wrong-merge failure the whole entity is built to prevent.

### Option C — A company-data connector confirms the binding by fetching

Fetch the employer's own site and confirm it links to the board.

**Advantages.** Real evidence with a genuine `retrieved_at`, tier 2 on its merits, and it scales.
Decay is detectable: re-fetch and the link is gone.

**Disadvantages.** `connectors/company-data/` is empty; this is a whole connector, a legal-basis
record per host, and a fetch strategy for finding a site from a slug — which is itself an inference
unless a human states the domain first. **It presupposes Option A's mapping rather than replacing
it**: something must say which domain to check. Correct as the second step, not the first.

### Option D — Read the employer out of the posting prose

The description usually names the company.

**Disadvantages.** ADR-0033 forbids exactly this, and ADR-0035 and ADR-0039 each carved a narrow,
span-carrying exception only after measuring the corpus — a measurement this option has not had, and
must have before it could be reconsidered. What is known is that a name in a description is not a
claim about who is hiring: prose names partners, customers, tooling vendors and, for an agency
listing, an employer that is not the poster. That is the `Go` failure with an employer's name
attached, and unlike a wrong skill row the mis-attribution is unrecoverable once outcomes point at
it.

### Option E — Do nothing; `company_id` stays null

**Advantages.** No wrong binding can be written. The jobs surface can render title, country and Skill
Fit today without an employer column.

**Disadvantages.** `employer_sponsorship_facts` stays impossible, so ADR-0039's registry half — and
with it `inferred_likely`, and the migration-friendly filter's dominant source — has no path forward
at all. `applications.company_id` and `outcomes.company_id` stay null forever, which quietly retires
the outcome data ADR-0019 designed early precisely so it could not be retired.

## Decision

**Option A.** A posting's employer comes from a curated `job_board_employers` binding on
`(source_id, source_scope)`, resolved at ingest, and no board slug is ever written as a company alias.

Five rules follow, and they are what the schema and the tests must enforce:

1. **The binding is a sourced claim, not configuration.** `source_url`, `source_tier` and
   `retrieved_at` are `NOT NULL`, and tier 4 is refused: a binding is at worst the employer's own site
   (tier 2). Which boards are *read* remains configuration (`ZENTAVIO_LEVER_BOARDS`) and this decision
   does not move it.
2. **A board slug never enters `company_aliases`.** The slug is a namespace, per ADR-0034. Names come
   from what a source calls the employer; a slug is what a vendor calls a tenant.
3. **No binding means `company_id` stays null.** An unbound board's postings are stored, extracted and
   scored exactly as today. A visible gap, never an invented employer.
4. **`company_name_raw` stays null on these rows, and that is correct.** The source never named the
   employer. The evidence for this resolution is the binding row, not a string on the posting — so
   `job.md`'s "the raw string is the evidence" holds for sources that name one and does not apply here.
5. **Resolution runs at ingest with no extraction marker.** The employer is board-level and constant
   for a run, so `upsertPostingFromSource` writes `company_id` directly. There is nothing to converge
   on, unlike ADR-0036's per-posting text pass, and a third marker pair would claim otherwise.

**`employer_sponsorship_facts` is still not built by this decision.** This gives it a key; what may be
stored against that key is ADR-0039's question and a later slice's work.

## Consequences

**Accepted costs.** Employer coverage is exactly as good as the curation behind it — one board today,
and any board added without a binding renders with no employer while looking identical to one that has
none available. The binding decays silently on acquisition and nothing detects it; `retrieved_at`
makes the staleness readable but nobody is watching it. And a table is added for a single row, which
will look like over-engineering until the second board arrives — the `source_scope` empty-string cost
ADR-0034 accepted, in a different shape.

**Follow-up work.**

1. `job_board_employers` — migration, entity doc, constraints (`fk` to both `connector_sources` and
   `companies`, tier 1–3, unique on `(source_id, source_scope)`).
2. A `companies` repository — resolution in `company.md`'s stated order, plus creation from a curated
   binding. None exists today; `packages/db/src/repositories/` has seventeen files and no company.
3. `upsertPostingFromSource` writes `company_id` from the binding, with a test that an unbound board
   stores null rather than failing.
4. The Zoox binding as the first row — **after fetching the employer's own site to confirm it links to
   the board**, per the rule the live Lever fetch set: a claim about what a source states requires a
   fetch, not a fixture. **Attempted 2026-08-25 and not satisfied.** `https://zoox.com/careers` and
   `https://www.zoox.com/careers` were both fetched: each is a navigation page naming *Zoox, Inc.* in
   its copyright line and carrying **no link or script reference to `lever.co` at all**;
   `https://jobs.lever.co/zoox` returns **403** to a plain fetch. So the employer does not state the
   binding anywhere reachable, and the only evidence available is Lever's own namespace — the vendor
   saying whose tenant it is, which is what rule 1 declines to accept on its own. **No binding row was
   written**, and the backfill in item 5 is blocked behind it. Resolving this needs either a reachable
   employer-side statement or a deliberate decision about what tier Lever's own canonical URL is worth
   — which is a change to rule 1 and belongs to this ADR, not to an implementation.
5. A backfill for the 239 stored postings, which are ingested and cannot be re-fetched cheaply.
6. `services/ingestion/src/sponsorship-extraction.ts:139` hardcodes `'zoox'` in `EMPLOYER_SUBJECT` — a
   corpus-specific token in a general extractor. Once a posting resolves to an employer, that subject
   becomes the resolved employer's aliases. **Not in this slice**, but this is why the token exists and
   it should not be extended in the meantime.

**Reversal cost.** Low. The binding table is additive, `company_id` is already nullable with an FK, and
nothing else reads it yet. It rises once outcomes and applications point at resolved companies, because
a wrong binding then has to be unwound through rows that reference it — which is the argument for the
provenance columns being `NOT NULL` from the first row rather than added later.

## Compliance

- A binding without `source_url`, `source_tier` or `retrieved_at` is refused by `NOT NULL`; tier 4 is
  refused by CHECK. Tested by direct `INSERT`, not through the repository — ADR-0039's rule, for the
  same reason: a rule living only in a pure function is bypassed by the next writer's `UPDATE`.
- **Rule 2 is checked as provenance, not as string equality.** The obvious test — no `company_aliases`
  row whose `normalized` equals a configured board slug — **was drafted, implemented, and found to be
  unsatisfiable**: a board slug usually *is* the employer's name, and `normalizeCompanyAlias('Zoox, Inc.')`
  and `normalizeCompanyAlias('zoox')` are both `zoox`. It failed against its own fixture, on the first
  correct binding. What is invariant is that an alias comes from a curated name and that nothing
  handling a scope writes one, so that is what is asserted:
  `tests/unit/invariants/no-board-slug-alias.test.ts` (aliases written from one module only, never
  from `bindBoardToCompany`, never from a scope, slug or board) and the behavioural half in
  `tests/integration/db/board-employer-binding.test.ts` (binding a board leaves the alias table
  byte-identical, and the slug resolves to nobody).
- A posting from a board with no binding stores `company_id IS NULL` and still extracts and scores;
  asserted, so the gap cannot regress into an error path.
- Nothing reads `source_scope`, a title, a URL host or posting prose as an employer name. `parse.ts`
  still emits `companyNameRaw: null`, and the connector's purity test still holds.
- No fuzzy matching enters resolution, per `company.md`'s invariant.

## Related

- ADR-0034 — a board slug is a namespace and the connector cannot know the employer; the rule this works within
- ADR-0033 — what a job-board source may state, which Option D would reopen
- ADR-0039 — the sponsorship claim whose employer-level half this unblocks
- ADR-0025 — provenance as its own relation, the precedent for the binding's columns
- ADR-0020 — `knowledge-engine/` curates, `packages/db` stores
- `docs/database/entities/company.md` — the resolution order this implements, not replaces
- `docs/features/migration-friendly-jobs.md` — *"Employers sponsor. Governments grant."*
