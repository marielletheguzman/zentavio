# Object Storage

> **Purpose:** The requirements every archived source document must satisfy, and the boundary the
> storage layer sits behind. ADR-0021 selects the implementation; this document is what it must
> satisfy.

- **Status:** Reviewed
- **Owner:** project lead
- **Last verified:** 2026-08-04

## Summary

Zentavio ingests documents that are the **evidence** behind immigration, employment, and regulatory
claims. Those documents are the system of record; PostgreSQL holds only metadata and a foreign key
to them. Business logic reaches storage through a `DocumentStore` port and never through a provider
SDK, so a provider change is configuration rather than a rewrite. Development and production speak
the same S3-compatible protocol, so there is no production-only code path. Once ADR-0021 is
implemented, **a requirement whose source cannot be archived is rejected rather than stored** — the
opposite of today, where it is stored with a warning.

## Why this is not optional

The first real ingest made the gap concrete. The 2026 EU Blue Card salary minimums cite:

```text
https://www.bundesanzeiger.de/pub/publication/REViP4bN6jVdpGxPaiQ/…/BAnz%20AT%2018.12.2025%20B3.pdf?inline=
```

That URL carries an opaque token, is not derivable from the publication id, and nothing obliges the
Bundesanzeiger to keep it resolving. The figure behind it — 50 700 EUR — is one a person plans a
relocation around.

Sharper: that PDF's font map does not round-trip, and the naive parse of it yields a **€700** salary
threshold (`connectors/immigration-data/de-bundesanzeiger/README.md`). The connector defends against
that today. But if an extraction is ever wrong in a way no validator catches, **re-reading the
original document is the only way to find out** — and an error in a document nobody archived is
permanent and undetectable.

## Design principles

### 1. PostgreSQL stores metadata only

No binary column, ever. Tables hold the object identifier, provider, bucket, MIME type, size,
checksum, retrieval timestamp, and source URL.

### 2. Object storage is the system of record

The archived document is the authoritative evidence: PDF, HTML snapshot, JSON snapshot, CSV, ZIP,
OCR output, generated evidence package.

### 3. Every imported rule references an archived document

```text
requirements.document_id ──► documents.id ──► documents.object_key
```

Normalized rather than an object path on the business table, which gives deduplication, shared
references, lifecycle management, and one place to audit provenance.

### 4. Archived documents are immutable

Never modified. When a source changes: archive the new version, preserve the previous one, record
both retrieval timestamps.

> **Immutable is not undeletable.** The `DocumentStore` port carries `delete` for lifecycle
> expiry — temporary cache, superseded reports. It is **not** a licence to delete evidence: a
> document supporting an imported requirement is never automatically removed, and the lifecycle
> table below is what says which is which.

### 5. Provenance is mandatory

Original URL, retrieval timestamp, archive checksum, storage key. All four, on every document.

## Required metadata

| Field | Description |
|---|---|
| `id` | UUID |
| `object_key` | storage object identifier |
| `provider` | storage provider |
| `bucket` | bucket or container |
| `mime_type` | MIME type |
| `size_bytes` | file size |
| `sha256` | integrity checksum, verified on read |
| `source_url` | original URL |
| `retrieved_at` | when it was downloaded |
| `archived_at` | when it was stored — **distinct from `retrieved_at`**, because a fetch that succeeds and an archive that succeeds are two events, and a gap between them is exactly the failure this table has to make visible |
| `version` | object version |

## Object naming

Deterministic keys: `<category>/<jurisdiction>/<year>/<slug>.<extension>`

```text
immigration/de/2026/banz-at-18-12-2025-b3.pdf
immigration/ca/2026/express-entry.pdf
connectors/eu/2026/eures-search-response.json
```

Layout is implementation-defined but must stay deterministic — a key that cannot be recomputed from
the record is a key that cannot be audited.

## The port

Business logic depends on this interface and never on a provider SDK.

```ts
interface DocumentStore {
  put(document: UploadRequest): Promise<DocumentRef>;
  get(id: DocumentId): Promise<Readable>;
  exists(id: DocumentId): Promise<boolean>;
  delete(id: DocumentId): Promise<void>;
  createSignedUrl(id: DocumentId, expiresIn: Duration): Promise<string>;
}
```

```text
Production                     Development
Application                    Application
    │                              │
DocumentStore port             DocumentStore port
    │                              │
S3-compatible API              S3-compatible API
    │                              │
Cloudflare R2                  MinIO
```

Same protocol both sides, so there is no behaviour that only appears in production.

## Security

Encryption at rest and in transit · least-privilege access · signed URLs for client downloads ·
audit logging · object versioning · lifecycle policies. **No public buckets.**

## Lifecycle

| Category | Retention |
|---|---|
| Government archives | permanent |
| Connector evidence | permanent |
| Reports | configurable |
| Temporary cache | expires automatically |

Evidence supporting an imported requirement is never automatically deleted.

## Ingestion behaviour, before and after ADR-0021

```text
today                          target
source unavailable             source unavailable
      ↓                              ↓
   warning                     archive failed
      ↓                              ↓
requirement stored             requirement REJECTED
```

`de-bundesanzeiger`'s `validate` already emits `no-archived-document` as a warning on every row.
That warning becomes an error, which guarantees every imported requirement has verifiable
provenance — and which will fail the ingest path until storage actually works. That is the intended
order: no silent window in which rules land without evidence.

## Non-goals

**Résumé uploads, user profile files, and personal documents are out of scope.** Uploaded résumés
are parsed for structured information and the original file is discarded
(`20260801100200-create-user-profiles.sql`, `docs/features/resume-parsing.md`,
`docs/architecture/data-flow.md`). Persisting them would require its own privacy and product
decision — retention, erasure, encryption, access — and is deliberately excluded here.

## Implementation note

The current schema stores a **textual** `requirements.source_document`. Moving to a normalized
`documents` table needs a **new** migration: the existing one is applied and checksummed
(`packages/db/src/migrations/runner.ts`), so it cannot be edited.

## Success criteria

- Every imported requirement references an archived document.
- Archived documents are immutable.
- PostgreSQL stores metadata only.
- Business tables reference documents by foreign key.
- Provenance is mandatory and auditable.
- Development and production share the same storage protocol.
- A provider can be replaced with minimal application change.
- A missing archived document fails ingestion rather than producing incomplete data.

## Related

- **ADR-0021** — selects the provider, region, IAM model, lifecycle and encryption configuration
- ADR-0015 — Supabase "and nothing else", which is why storage is a separate provider
- ADR-0010 — the `requirements` table and its provenance columns
- `connectors/immigration-data/de-bundesanzeiger/README.md` — the citation that motivated this
