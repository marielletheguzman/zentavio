# Curated

> **Purpose:** Dated world facts a person entered deliberately, with the source they read and the
> verbatim sentence they read it in.

**Not seeds.** `packages/db/seeds/` holds reference data — a closed skill set the parser resolves
against — and its own README says that data is *"expected to be replaced by real ingestion"*. Nothing
here is replaceable that way. These are facts about real organisations, carrying provenance, and they
are the real data rather than a stand-in for it.

**Not a fixture, either.** A fixture is an example of what a source returns. Every entry here is a
claim somebody makes about a real employer, and somebody reading it may apply for a job and move
countries on the strength of it.

## Why a file, rather than a script or an admin form

A sponsorship claim deserves a review gate, and a diff is one. An entry added here is read by a second
person before it reaches a database, its URL can be opened during that review, and its verbatim `span`
can be compared against the page it was taken from. A CLI invocation leaves none of that behind.

It is also re-checkable: `retrievedAt` says when somebody last looked, and a claim nobody has
re-opened since is visible as such rather than merely old.

## `employer-sponsorship.json`

Applied by `syncCuratedSponsorship` in `services/ingestion`, which writes through
`recordSponsorshipFact` — so every entry is versioned and supersedes rather than overwrites
(`docs/database/entities/employer-sponsorship.md`).

| Field | Meaning |
|---|---|
| `companySlug` | resolved against `companies.slug`; the company must already exist |
| `jurisdiction` | ISO-3166-1 alpha-2. Support is per country, and it is part of the key |
| `claim` | one of the six in `ck_esf__claim` |
| `status` | what the curator asserts, checked against the span — see below |
| `sourceUrl` | the employer's own page. Not an aggregator, not a job board |
| `span` | **the verbatim sentence**, copied from that page |
| `retrievedAt` | when the page was read |
| `effectiveFrom` / `refreshAfter` | ISO dates |

### The curator's claim is checked, not trusted

`status` is not taken at face value. The span is run through **the same `extractSponsorship` the
posting pipeline uses** (ADR-0039), and the entry is refused unless the extractor independently
reaches the same status. One vocabulary, one set of rules, whether a sentence arrives from a Lever
board or from a person's judgement.

That is deliberate. The failure this prevents is a curator reading *"we support relocation"* on a
careers page and recording `visa_sponsorship: stated_available` — a claim the sentence does not make,
now indistinguishable in the database from one it does.

### Source kind is always `employer_statement`

By construction: these come from the employer's own site. A register would be `official_register` and
would arrive through a connector; aggregated outcomes would be `observed_outcome` and would be
computed. **A third-party listing is not a source** (`docs/features/migration-friendly-jobs.md`).

## The file is empty, and that is a finding rather than a gap

Two employers have been evaluated against these rules and **both were refused**:

**Zoox** — checked 2026-08-25 for ADR-0040's board binding. `zoox.com/careers` and
`www.zoox.com/careers` name *Zoox, Inc.* in the copyright line and carry no `lever.co` reference at
all; `jobs.lever.co/zoox` returns 403. Of its 239 postings, three mention sponsorship or relocation
and two are the wrong sense entirely.

**Zalando** — checked 2026-08-26. `jobs.zalando.com/robots.txt` is `Allow: /` with two onboarding
paths disallowed, so it is readable. The one relevant sentence on `jobs.zalando.com/en/how-we-hire`
is:

> "If you're asked to relocate, our People Services team will be there to help guide you with visa
> assistance, accommodation support, and settling in."

**That is conditional on Zalando asking you to relocate** — support for someone already being moved,
not an offer to sponsor an external applicant who needs a visa. It is ADR-0039 rule 2 in a new
costume: a statement about the circumstances under which help appears is not a statement that the
benefit is available to the reader. It yields `unknown`, and it is a permanent refusal case in
`services/ingestion/src/curated-sponsorship.test.ts`.

**Both refusals are the rules working.** The pressure to record something rather than nothing is
exactly what ADR-0039 predicted — *"the pressure to loosen rule 1 will be real and recurring"* — and
an employer that states it plainly is what this file is waiting for, not a weaker rule.
