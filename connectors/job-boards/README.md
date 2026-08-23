# job-boards

> **Purpose:** Job-listing source plugins (one folder per site).

**What is built:** `lever`, the first job data this product has had at all. Everything else here is
still a placeholder.

| Source | Covers | State |
|---|---|---|
| [`lever/`](lever/README.md) | published postings from Lever ATS boards somebody configured | **built** |
| [`greenhouse/`](greenhouse/README.md) | Greenhouse ATS | placeholder |
| [`indeed/`](indeed/README.md) | Indeed | placeholder |
| [`linkedin/`](linkedin/README.md) | LinkedIn | placeholder |
| [`remoteok/`](remoteok/README.md) | RemoteOK | placeholder |
| [`country-boards/`](country-boards/README.md) | region-specific boards, for coverage outside the ATS platforms | placeholder |

## Tier 2, and what that costs

Immigration sources are tier 1 — a government stating its own rule. A job board is not. The employer
wrote the posting, but the platform hosts and renders it, so what a connector here reads is the
**platform's rendering of the employer's words**. Every source in this directory carries
`sourceTier: 2` and the confidence that follows from it (`.claude/context/knowledge-sources.md`).

The practical consequence is ADR-0033: a posting may state only what its source states. Salary,
remote scope and country are the three things a job board most invites you to infer, and inferring
any of them puts a guess underneath every score derived from it. `lever` refuses all three and
validation rejects a row claiming otherwise — `salary-invented`, `remote-scope-invented`. A new
source here inherits that refusal rather than re-deciding it.

Prose is stored and **never mined**. `description` and `requirementsText` exist so skill extraction
has an input at all (ADR-0035); no fact is read out of them.

## Configured boards, not discovery

`lever` reads a board because somebody put its slug in configuration. Nothing here enumerates a
platform's customers or guesses organisation slugs. That keeps coverage curated and honest about
what it is — this is not a global search index, and the ATS APIs do not offer one.

## Where a posting goes

Through `packages/db/src/repositories/jobs.ts` into `job_postings` and `job_posting_sources`
(ADR-0034). Identity is `(source_id, source_scope, external_id)` and the scope is a namespace,
**never an employer**. A source that supplies no employer must store `dedup_basis =
'source-identity'`, which matches nothing across sources by construction; that is the honest state
and it is recorded rather than papered over.

## Registration is the part that gets forgotten

A connector is not wired by existing. `connectors/core/src/default-registry.ts` is the only module
permitted to name a source, `default-deps.ts` beside it constructs the real dependencies, and
`tests/unit/invariants/connector-registration.test.ts` fails if a built connector is missing from
`createRegistry`. That invariant caught `de-bayingg` composed into no registry at all, with no
symptom, because nothing consumed the registry at runtime yet.

Composition lives in `connectors/core` rather than `services/ingestion` because `eslint.config.mjs`
refused the latter: a service that constructs `httpLeverDeps` knows which sources exist, and adding
a second board would then mean editing a service — exactly what ADR-0002 exists to prevent.

## Two limits worth stating plainly

**Nothing here has ever hit the network.** `fetchImpl` is injected everywhere, including in the
composition root, and no run has called `api.lever.co`. Keep it a parameter — it is what makes the
failure paths testable: a throwing page, a throwing `normalize`, an endless cursor, a 429 against a
403.

**The corpus is three postings from Lever's demo board**
(`tests/fixtures/connectors/lever/leverdemo.json`), whose qualifications read like "be smart". No
curated skill appears in them, so extraction over the current corpus yields nothing and matching
reports `unknown`. That is the schema working, not a gap — but extraction quality stays unvalidated
until a live board is fetched.

## Related

- ADR-0002 (plugin model), ADR-0033 (tier and what a posting may state), ADR-0034 (posting identity
  and lifecycle), ADR-0035 (what an extracted requirement may claim)
- `docs/database/entities/job.md` — the shape `normalize` targets
- `.claude/skills/connectors/SKILL.md`, `docs/development/connector-guide.md` — the contract and how
  to add a source
