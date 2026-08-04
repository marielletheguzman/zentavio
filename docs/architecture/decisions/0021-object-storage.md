# ADR-0021: Source documents live in S3-compatible object storage, behind a port

- **Status:** Proposed
- **Date:** 2026-08-04
- **Deciders:** project lead
- **Affects:** `packages/db`, `connectors/`, `services/ingestion`, `packages/config`,
  `.claude/context/tech-stack.md`, `docs/database/entities/requirement.md`, `infra/docker`

## Context

`requirements.source_document` has existed since the table was created on 2026-07-29, documented as
"the archived page in object storage". No object storage exists, so **every requirement ingested so
far carries `sourceDocument: null`** and the `de-bundesanzeiger` connector emits a validation warning
on every row saying so.

That gap is not cosmetic, and the first real ingest made it concrete. The 2026 EU Blue Card salary
minimums come from `BAnz AT 18.12.2025 B3`, cited as:

```text
https://www.bundesanzeiger.de/pub/publication/REViP4bN6jVdpGxPaiQ/content/REViP4bN6jVdpGxPaiQ/BAnz%20AT%2018.12.2025%20B3.pdf?inline=
```

**That URL is not a durable citation.** It carries an opaque token, it is not guessable from the
publication id, and nothing obliges the Bundesanzeiger to keep it resolvable. The number behind it —
50 700 EUR — is one a person plans a relocation around. `docs/architecture/immigration.md` requires
every immigration output to carry its evidence, and `principles.md` makes a claim with no verifiable
provenance a bug rather than a gap.

There is a second, sharper reason. The Bundesanzeiger publishes as a PDF whose font map does not
round-trip: extracted text arrives with spaces inside numbers, and the naive parse of the real
document yields a **€700** salary threshold. The connector defends against that today. But if the
extraction is ever wrong in a way no validator catches, **the only way to find out is to re-read the
original document** — and if it was never archived, the error is permanent and undetectable.

The constraint that makes this non-obvious: ADR-0015 chose Supabase as the managed PostgreSQL
provider **"and as nothing else"**, naming its Storage as one of the things explicitly not adopted.
So the obvious integrated answer is closed by an accepted decision, and this needs its own provider
and its own justification.

`.claude/context/tech-stack.md` names no object store, and nothing new enters the stack without an
ADR.

### What is in scope

Source documents for ingested rules, AI evidence documents, company logos, generated reports, and
HTML/JSON snapshots of official pages.

### What is deliberately out of scope

**Résumés.** The uploaded file is parsed and discarded — stated in
`20260801100200-create-user-profiles.sql`, `docs/features/resume-parsing.md`, and
`docs/architecture/data-flow.md`. That migration says storing it later "would be a privacy decision
disguised as a schema change", and this ADR is not that decision. Storing résumés means retention,
erasure, encryption, and access rules for the most sensitive object in the system, and it gets its
own ADR or it does not happen.

## Options considered

### Option A — AWS S3

**Pros.** The reference implementation; every requirement in scope is native. Versioning, lifecycle,
object lock, IAM, audit logs, EU regions. Its API is the de-facto portability standard.

**Cons.** Egress is billed per gigabyte, and this workload re-reads archived documents for
re-processing and evidence display rather than writing once and forgetting. The IAM model is the most
complex of the options for a project with one operator.

### Option B — Cloudflare R2

**Pros.** S3-compatible API, so the portability requirement is satisfied by the *protocol* rather
than by a wrapper we maintain. **Zero egress fees**, which matters because re-processing and evidence
display are reads. Versioning, lifecycle, and signed URLs are supported. Jurisdictional restriction
can pin objects to the EU, matching ADR-0015's region decision.

**Cons.** Object Lock and audit-log depth are behind AWS's. Fewer regions. A second vendor alongside
Supabase.

### Option C — Google Cloud Storage or Azure Blob Storage

**Pros.** Both are durable, versioned, and cheap enough. GCS has an S3 interoperability mode.

**Cons.** GCS's S3 mode is partial and not a safe portability guarantee; Azure's API is different
enough that the port would be doing real translation rather than passing through. Both weaken the one
property this decision most needs.

### Option D — MinIO, self-hosted, as the production store

**Pros.** No vendor. Same S3 API. Free.

**Cons.** It makes durability our problem — replication, backup, disk failure, and the operational
burden of the one system whose entire purpose is that documents survive. A single-operator project
self-hosting its own system of record for evidence is choosing the failure mode this ADR exists to
prevent.

### Option E — do nothing; keep the source URL only

**Pros.** Zero work, zero cost, zero new vendor.

**Cons.** It is the status quo, and the status quo is that a rule's evidence is a URL with an opaque
token. When it breaks, the claim becomes unverifiable and unreprocessable at the same moment, and the
documents that would have proved it are gone. Every day this is deferred adds rows that need
backfilling from pages that may have moved.

## Decision

**Option B — Cloudflare R2, EU-restricted, reached only through a `DocumentStore` port, with MinIO
as the local development implementation.**

The deciding argument is portability, and it is structural rather than aesthetic: choosing an
**S3-compatible** provider makes the *protocol* the portable interface, so the port stays thin and
"replace the provider" means changing configuration rather than writing an adapter. That same
property is what lets local development run MinIO against the identical code path — the alternative
is a filesystem stub in development and an untested real implementation in production.

Zero egress decides between the two S3-compatible candidates, because this workload's reads are not
incidental: re-processing an archived document is how a parse defect is ever found, and a per-gigabyte
charge on that is a charge on checking our own work.

**No credential and no provider name appears outside `packages/config` and the port's
implementation.** Business logic depends on `DocumentStore`, never on an SDK type.

## Consequences

**Accepted costs.**

- A second vendor alongside Supabase, with its own account, billing, and outage surface. An ingest
  run now has two external dependencies rather than one.
- R2's audit logging and Object Lock are weaker than S3's. If a regulator ever needs proof a document
  was not altered after archiving, the `sha256` column is the evidence, not the storage provider.
- Local development gains a container. `infra/docker/docker-compose.dev.yml` grows a MinIO service,
  and `pnpm` scripts that touch documents will not work without it running.
- Writes are no longer transactional with the database. A document can be stored and its row fail to
  commit, or the reverse. The ordering rule is **store the object first, then the row** — an orphaned
  object is waste, an orphaned row is a citation that resolves to nothing.

**Follow-up work.**

1. A `documents` table — `id`, `object_key`, `provider`, `bucket`, `mime_type`, `size_bytes`,
   `sha256`, `source_url`, `retrieved_at`, `version`, `created_at`. Metadata only; PostgreSQL holds
   no binary.
2. `requirements.source_document` becomes `document_id uuid` referencing it. The existing migration
   is applied and checksummed, so this is a **new** migration, not an edit.
3. A `DocumentStore` port in `packages/` with an R2/S3 implementation and a MinIO-backed local one.
4. `connectors/core` gains a way to hand the fetched bytes to ingestion — connectors persist nothing,
   so the connector returns the payload and `services/ingestion` stores it.
5. Config keys under `ZENTAVIO_STORAGE_*`, added to `.env.example`, which
   `packages/config/src/env-example.test.ts` will enforce.
6. Deterministic keys: `<category>/<jurisdiction>/<year>/<slug>.<ext>`, e.g.
   `immigration/de/2026/banz-at-18-12-2025-b3.pdf`.
7. Lifecycle: government documents and evidence never expire; cache 90 days.

**Reversal cost.** Low, and that is the point of the port. Moving to S3 is a config change plus a
bucket copy, because the API is the same. Moving to a non-S3 provider means writing one
implementation of `DocumentStore`. Removing object storage entirely would mean losing every archived
document, which is the thing that cannot be redone — the sources will have moved.

**What this does not license.** Storing a document is not permission to store any document. Résumés
remain out of scope (above), and `sensitive` person data does not become a file because files are now
possible.

## Compliance

- **Nothing outside the port names a provider.** `eslint.config.mjs` gains a `no-restricted-imports`
  pattern banning `@aws-sdk/*` outside the `DocumentStore` implementation, in the same shape as the
  existing Qdrant-outside-`vector-store` rule. Verified by attempting the violation.
- **No binary column.** `tests/integration/db/schema-drift.test.ts` reads the declared schema; a
  `bytea` column anywhere is a violation of this ADR and of `docs/database/`.
- **Every ingested requirement carries a document.** `de-bundesanzeiger`'s `validate` already emits
  `no-archived-document` as a warning for a null `sourceDocument`. When this lands that warning
  becomes an **error**, so a rule ingested without its archived source is rejected rather than stored.
- **Integrity is checked, not assumed.** The stored `sha256` is verified on read; a mismatch is a
  failure, never a warning. A document that changed after archiving is not evidence.
- **The résumé exclusion is enforced by the existing schema**: `user_profiles` has no document column,
  and adding one requires a migration that a reviewer will see.

## Related

- ADR-0015 — Supabase "and nothing else", which is why this is a separate provider
- ADR-0010 — the `requirements` table and its provenance columns
- ADR-0004 — the vector store as an index, not a system of record; same port-shaped treatment
- `docs/architecture/immigration.md` — why a rule's evidence must be retrievable
- `connectors/immigration-data/de-bundesanzeiger/README.md` — the citation that motivated this
