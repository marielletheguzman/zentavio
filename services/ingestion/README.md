# ingestion

> **Purpose:** Runs connectors on schedule; normalizes, dedupes, and queues job listings.

The persistence half of the plugin architecture. A connector fetches and returns data; this service
decides what to store.

**What is built:** requirement ingest, end to end — `planIngest` decides, `executePlan` applies.
Job listings, scheduling, and the queue named in the purpose line above are **not** built; nothing
runs this on a timer yet.

## Persistence lives here, never in a connector

`docs/architecture/connectors.md:140` — *"No persistence in a connector — they return data, never
write."* A connector that wrote to storage and the database would stop being a plugin and become a
pipeline wearing a plugin's interface. That is the property ADR-0002 exists to protect and **M3
exists to test**: adding Luxembourg must touch a reference file, connector coverage, ingested rules,
and a registry entry, and nothing in `services/` or `ai/`.

**No source is named in this package.** It takes a connector and iterates the registry. If adding a
country ever requires editing a file here, the plugin claim is false.

## Planning is separate from writing

`planIngest` is pure: connector output and what is already stored go in, a list of decisions comes
out, and nothing has touched the database. That is what makes supersession, idempotence, and
rejection testable without PostgreSQL — and what lets a caller show an operator what *would* happen
before it happens.

| Action | When |
|---|---|
| `insert` | no row with this `requirement_id` exists |
| `supersede` | a **live** row exists at a different version |
| `unchanged` | this exact `(requirement_id, version)` is already stored |
| `reject` | the connector's own `validate` returned an error |

A record carrying only **warnings** is stored. `no-archived-document` is a warning until ADR-0021's
enforcement phase; treating it as blocking today would mean nothing ingests at all.

## The two rules worth knowing

**A new version closes the old row; it never edits it.** A person planned against the old number,
and *"the threshold you were planning against changed on 2026-01-01"* is only sayable if the old row
still exists (`docs/architecture/immigration.md`, Versioning).

**The old row closes the day *before* the new one takes effect.** Closing it on the same date leaves
both live for a day, and `uq_req__current` rejects the insert — correctly, because two live rows make
evaluation non-deterministic. `dayBefore` uses UTC arithmetic, so a year boundary, a month boundary,
and a leap day are all the same case.

## The executor decides nothing

`executePlan` opens a transaction and does what the plan says. Every rule was settled by
`planIngest`, which is pure — a rule living in the executor is one that can only be tested against
PostgreSQL, and therefore one nobody exercises at every edge.

**One transaction for the whole plan.** A partially applied plan is the worst outcome available: a
threshold superseded with its replacement missing leaves the pathway with *no* current rule, and a
verdict computed in that window is wrong in a way that looks like an answer.

Within a supersession, **close before insert** — inserting first leaves both rows live for the
duration of the statement and trips `uq_req__current` inside the transaction.

`dryRun` returns the same report having written nothing, so an operator can see whether a
supersession is about to fire before it does.

## Annually bounded rules never supersede

Worth knowing before reading the supersede path and assuming it runs. The Bundesanzeiger
announcement is explicitly *for one calendar year*, so `normalize` sets `effective_to` to
31 December — **these rows are born closed.** Nothing is ever `effective_to IS NULL`, so
supersession does not fire for this source: each year is simply another row.

That is the honest model, and it has a consequence. `uq_req__current` is partial on
`effective_to IS NULL`, so **it enforces nothing for annually bounded rules.** What keeps exactly one
rule applicable on a given date is that the year ranges do not overlap, and no constraint checks
that. An open-ended rule from a future source would use the supersede path and be protected; these
are not. Closing that would mean a `daterange` exclusion constraint, which is a schema decision
rather than something to add quietly.

## Archival comes before storage

`archiveSource` stores the source document and records it; `planIngest` then carries the resulting
`document_id` onto every rule. **Object first, then row** (ADR-0021), and the reason is asymmetry:
an orphaned object is waste that a lifecycle sweep finds, while an orphaned row is a citation that
resolves to nothing — which looks like evidence right up until someone tries to read it.

A connector still persists nothing. It says what its source *is* via `archivable()`, returning bytes
and a content type; this service stores them.

**`isOriginal` is recorded because not every archive is the published document.** `de-aufenthg`
returns the statute's own HTML, so `isOriginal: true`. `de-bundesanzeiger` returns text extracted
from a PDF — which is what the parser reads, but weaker evidence: the extraction is exactly where
that source's known defect lives (digits split by spaces, turning 50 700 into 700), and someone
re-reading the archive cannot see a defect that happened before the archive. Counting that gap is
the point of the flag.

A failed archive is **reported, not thrown**. The caller decides what it means — a warning today, a
rejection once the enforcement phase lands.

## Employer sponsorship arrives curated, not connected

**The sponsor-registry connector cannot be built.** Of the four supported countries only New Zealand
operates an employer-accreditation regime, and INZ's accredited-employer list is a search box whose
endpoint — `/_list-collection-search` — its own `robots.txt` disallows. `docs/architecture/connectors.md`
settles what that means: *"If a source disallows automated access, the answer is that we do not
integrate it."*

Two further blockers survive even that one. The list offers **no enumeration** — it answers an NZBN
or three characters of a name, so it can verify an employer you already hold but cannot produce a
register. And INZ states that **employers may opt out of appearing**, so a miss is never evidence of
anything.

So `syncCuratedSponsorship` applies `packages/db/curated/employer-sponsorship.json` instead: the
employer's own page, read by a person, entered with the sentence they read it in.

**A curator is not trusted more than a job board is.** Every entry's span runs through the same
`extractSponsorship` the Lever pipeline uses, and the entry is refused unless the extractor
independently reaches the asserted status. One vocabulary — a second one written for curated entries
is the drift `probe2.mjs` already demonstrated when it hand-copied the benefit list into its own
regex.

**The file is currently empty.** Zoox and Zalando have both been evaluated and both refused; the
curated README records the sentences and why. That is the rules working, not a gap in them.

## Still missing

No scheduler. `de.eu-blue-card` is seeded by `pnpm seed` (`packages/db/src/immigration-pathways.ts`)
with `stages`, `permanent_residency` and `citizenship` **empty** — those need their own tier-1
sourcing, and `requirement.md` calls them "what people actually plan around". Until they exist this
pathway supports eligibility evaluation and nothing resembling planning advice.

## Related

- ADR-0002 (plugin model), ADR-0010 (requirements), ADR-0021 (archival, and why it belongs here)
- `docs/architecture/object-storage-rollout.md` — Phase 5
- `packages/db/src/repositories/requirements.ts` — the invariants enforced at write time
