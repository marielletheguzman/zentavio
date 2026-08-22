# ADR-0034: A posting's identity is the source's, deduplication belongs to persistence, and absence expires nothing unless the source lists exhaustively

- **Status:** Accepted
- **Accepted:** 2026-08-22
- **Date:** 2026-08-22
- **Deciders:** project lead
- **Affects:** `packages/db` (`job_postings`, `job_posting_sources`), `services/ingestion`, `connectors/core`, `docs/database/entities/job.md`, `docs/development/connector-guide.md`, `docs/architecture/connectors.md`

## Context

`connectors/job-boards/lever` normalizes postings and **nothing stores them**. `job_postings` is
designed in `docs/database/entities/job.md` — columns, indexes, invariants, a lifecycle diagram — and
no migration creates it. This decision settles what persistence *promises* before a migration is
written, because the promises are what the columns encode.

**This ADR designs; it does not build.** No schema, no migration, no repository API is authorised by
it beyond the shapes needed to state the decisions. Accepting it makes the contract binding on the
migration slice, not a licence to start one.

### What Lever exposed, and why it is not a Lever problem

ADR-0033 decided what a job-board source may claim. Applying it produced a record with **no employer
identity**: a Lever board is a slug (`leverdemo`), the postings carry no company name field, and
ADR-0033 forbids mining the description for one. The connector therefore cannot supply `company`.

`docs/development/connector-guide.md` **Step 5** requires every connector to derive a stable
deduplication key:

```text
sha256(norm(company) + '|' + norm(title) + '|' + norm(location) + '|' + coarse(postedAt))
```

**A connector that cannot know the company cannot compute that key**, and the only ways out are to
invent an employer, to hash a board slug as though it were one, or to move the key. The first two are
the failure ADR-0033 exists to prevent. **This is a general property of ATS feeds, not a quirk of
Lever** — a per-employer feed is precisely the case where the employer is context rather than content.

### The second thing the design does not survive contact with

`job.md` gives `job_posting_sources` a unique index on `(source_id, external_id)`. That is correct
when a source's identifiers are unique across its whole namespace, and **wrong when they are unique
only within a board**. Lever's posting ids are UUIDs and would survive; a source numbering postings
`1, 2, 3` per employer would silently collide two different jobs into one row, and the collision
would look like successful deduplication.

### And a third: `is_remote boolean NOT NULL DEFAULT false`

The designed column cannot express *"the source did not say"*. `salary_is_stated` exists in the same
table precisely because that distinction was recognised for pay — *"the source published no salary"*
and *"the source published one we failed to parse"* are different facts. Remote status has the same
two-state problem and no equivalent. Lever's own `workplaceType: "unspecified"` currently normalizes
to `isRemote: false`, which reads as *"this job is on-site"* and means *"nobody said"*.

## Options considered

### Option A — Keep identity and deduplication in the connector, as the guide specifies

Each connector derives `dedup_key` and hands over a fully-identified record; persistence writes it.

**Advantages.** Already documented and already the rule. Persistence stays thin. A connector knows its
source's quirks better than a generic reconciler does.

**Disadvantages.** **It cannot be honoured by a source that does not publish an employer**, and the
three ways to honour it anyway are all inventions. It also puts a *cross-source* concern inside a
component that sees exactly one source: deduplication is a claim that two postings from two feeds are
the same job, and no connector is in a position to make it. Every connector would additionally have
to reproduce identical hashing, or the key stops being comparable — the same argument that put retry
and rate limiting in `connectors/core`.

### Option B — Source identity in the connector, deduplication in persistence

A connector states only what it can know: which source, which board, which external id. Persistence
owns the derived `dedup_key`, and records **what basis it had** for deriving it.

**Advantages.** Every connector can satisfy its half, including one with no employer field. The
cross-source claim is made where cross-source data actually exists. A posting that cannot be safely
merged stays its own row instead of being merged on a guess — and the row says which of the two
happened, so a reader can tell a confident merge from an unmergeable one.

**Disadvantages.** Persistence grows a real responsibility, and the "one folder plus one registry
line" story now needs a sentence about what the folder does *not* do. Two postings genuinely identical
across sources will sometimes stay two rows, which looks like a defect until you read the basis
column.

### Option C — Defer: store postings with no deduplication at all

One row per source posting, no key, no merging, ever.

**Advantages.** Simplest, and correct for the current state of the world — one connector, one source,
no cross-source duplicates possible today.

**Disadvantages.** The second connector makes every popular job appear two or three times, and by then
the table has rows that no retroactive key can safely merge, because the evidence needed to merge them
(what the sources said at the time) was never recorded. **Deduplication is cheap to design now and
expensive to add later**, which is the same reason ADR-0019 put outcome recording at M2.

### Option D — Do nothing: leave `job_postings` uncreated

**Advantages.** No wrong decision gets encoded. The connector is already useful as a tested source
adapter, and nothing today reads job data.

**Disadvantages.** The Lever connector produces records that go nowhere, which is a feature that does
not exist. And the guide's Step 5 conflict stays live: the next connector author reads a rule that
cannot be followed and either follows it wrongly or quietly ignores it — and an ignored rule is worse
than a wrong one, because nobody knows which rules are real.

## Decision

**Option B**, as seven linked decisions.

### 1 — Identity is the source's, and it is a triple

A posting's **source identity** is `(source_id, source_scope, external_id)`:

- `source_id` — the connector's `meta.id`, permanent, already a foreign key to `connector_sources`.
- `source_scope` — the sub-namespace the id belongs to: a Lever board slug, an ATS tenant, a country
  site. **Empty string when the source has one global namespace**, never null, so the uniqueness
  constraint needs no coalescing.
- `external_id` — the source's own identifier, verbatim.

`job_posting_sources`' unique index becomes `(source_id, source_scope, external_id)`. **A board slug
is a namespace, not an employer**, and it is stored as one — nothing may resolve `source_scope` to a
company.

**Employer identity stays nullable and separate.** `company_id` resolves later, `company_name_raw`
holds what a source said when it said anything, and a source that provides neither produces a posting
with no employer rather than a posting with a guessed one.

### 2 — `dedup_key` is persistence-owned, and carries its basis

The connector does **not** compute it. Persistence derives it at write time, and stores alongside it a
`dedup_basis` naming which derivation was used:

- `employer-title-location` — an employer identity was available; the key can match across sources.
- `source-identity` — no employer was available; the key is derived from the source identity triple
  and **therefore matches nothing else, by construction**.

A posting that cannot be safely deduplicated **remains its own row**. It is never merged on a guess,
and `dedup_basis` is what makes "we did not merge this" visible rather than indistinguishable from "we
found nothing to merge it with". This is the explainability principle applied to a merge: a merge is a
claim, and a claim carries its evidence.

### 3 — Upsert is by source identity; the key is derived, not immutable

Re-ingesting the same source identity **updates that posting** — it never inserts a second row. Title,
location, URL and dates may change; the source identity may not. `dedup_key` is **recomputed** when the
fields it derives from change, because a stale key is a wrong merge waiting to happen.

**A recomputation that collides with another live posting is not an automatic merge.** It is recorded
for reconciliation and left as two rows. Merging two rows is destructive — matches, applications and
outcomes already point at them — and no automated rule should do it silently. `contested` already
exists for the "two sources disagree" case and is the natural home for it.

### 4 — Absence expires nothing unless the source lists exhaustively

A posting disappearing from a feed means *"this job is gone"* **only if the feed was supposed to list
every live posting**. A Lever board is exhaustive by construction — the API returns every `published`
posting. A keyword search endpoint is not, and a run that returned fewer results than last time may
mean a ranking change, a quota, or an outage.

So a connector **declares** whether a listing is exhaustive for the scope it just read, and only an
exhaustive listing may expire anything. `expiry_reason` keeps the two apart:
`source-delisted` (the source stopped listing it) versus `source-not-fetched` (we stopped looking).
**Our failure must never expire somebody's tracked posting**, and absence-with-no-exhaustive-listing
is our failure by default.

Expiry requires the posting to be absent from more than one qualifying run, so a single truncated
response cannot retire a board's worth of jobs. **Nothing is ever hard-deleted**: `job.md` already
says retention is indefinite, and an expired posting is evidence about the market and about a
person's own application history.

### 5 — The archive is per fetch, not per posting

ADR-0021 archives what a source served. For a job board that is **one board payload per fetch**,
containing many postings. `job_posting_sources` therefore references the run and the archived
document; it must never claim to hold the bytes of a single posting, because it does not.

This is weaker per-posting evidence than a requirement's archived statute, and it is recorded as
weaker rather than dressed up: re-reading the archive shows the board as served, from which one
posting can be located.

### 6 — Structured fields are authoritative, and unknown is not false

ADR-0033's rule generalises to every job-board source: **structured fields are authoritative; prose is
not read.** Persistence adds two rules of its own.

**`NOT NULL DEFAULT false` is banned for any field a source may be silent about.** `is_remote` as
designed cannot say *"nobody stated it"*, and Lever's `workplaceType: "unspecified"` currently becomes
`false`, which reads as *on-site*. It gains the `salary_is_stated` treatment — either nullable, or a
stated-flag beside it — and the migration slice picks which.

**A field is never updated from a source of a lower tier than the one that wrote it** — already an
invariant in `job.md`, restated here because upsert is where it will be violated.

### 7 — The migration comes last, and this ADR does not authorise it

Columns, indexes, constraints, the repository API and the ingest path are a separate slice that starts
from these decisions. What it must carry forward: the identity triple, `dedup_basis`, the exhaustive
listing flag, `expiry_reason`'s two values, and the ban on defaulting a silent field.

## Consequences

**Accepted costs.**

- **Duplicates will be visible** once a second job source exists. Two feeds carrying the same job with
  no shared employer identity produce two rows, and a person will see the same opening twice. That is
  the honest failure of the two available failures — merging them on a title-and-location match
  produces one row asserting a false equivalence, and a wrong merge is unrecoverable once matches and
  applications point at it.
- **Persistence gains real logic**, so "a connector is a plugin" now needs the sentence that a
  connector identifies and never deduplicates. `connector-guide.md` Step 5 becomes wrong and must be
  rewritten, not annotated.
- **Postings whose source is not exhaustive will accumulate**, staying live long past their real
  death, because nothing licenses expiring them. A stale-but-honest listing beats retiring a job
  somebody is tracking because our fetch failed.
- **`source_scope` will be an empty string for most sources**, which is an odd-looking column until
  the second ATS arrives.

**Follow-up work.**

- Rewrite `connector-guide.md` Step 5 to separate **source identity** (the connector's job) from
  **persistence identity** (deduplication). Step 8's expected diff also names `connectors/core/registry.ts`,
  a path that does not exist — it is `src/default-registry.ts`.
- Update `docs/database/entities/job.md`: the `(source_id, external_id)` index, `dedup_basis`, the
  `is_remote` default, and the expiry rule.
- Decide where the exhaustive-listing declaration lives — `ConnectorMeta`, or a per-run result — when
  the ingest path is built.
- The `job_postings` migration slice, which this ADR does not authorise.

**Reversal cost.** Low while the table does not exist, and this is the last moment that is true.
After ingest starts, changing the identity triple means rewriting every `job_posting_sources` row and
recomputing every key; changing the expiry rule means deciding retroactively whether absences that
were never recorded meant anything. The evidence needed to redo a merge decision is only available at
write time, which is why the basis is stored rather than inferred later.

## Compliance

Each of these is a test the migration slice must ship with, and a reviewer should refuse the slice
without them:

- **Identity.** Two postings with the same `external_id` under different `source_scope` values are two
  rows. Re-ingesting one source identity twice is an update, asserted by row count.
- **Deduplication.** No connector under `connectors/*/*` computes a `dedup_key` — greppable, and the
  natural place is the connector-registration invariant's neighbour in `tests/unit/invariants/`.
  Every stored posting has a `dedup_basis`, and a posting written with no employer identity has
  `source-identity` and shares its key with nothing.
- **Expiry.** A non-exhaustive run that returns nothing expires nothing. An exhaustive run missing a
  posting across the required number of runs sets both `expired_at` and `expiry_reason`, and never
  deletes.
- **Silence.** A source that states no remote status produces a row that does not read as on-site —
  asserted against Lever's real `workplaceType: "unspecified"` fixture posting, which is already
  committed.
- **Tier.** An update from a lower-tier source than the one that wrote a field is refused.

## Related

- ADR-0033 — what a job-board source may claim, which this one does not reopen
- ADR-0021 — the archive this references at fetch granularity
- ADR-0025 — `requirement_sources`, the precedent for provenance as its own relation
- ADR-0019 — why data whose evidence cannot be backfilled is designed early
- `docs/database/entities/job.md` — the design this amends
- `connectors/job-boards/lever/README.md` — the field-by-field gap this closes
