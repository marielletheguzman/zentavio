# storage

> **Purpose:** The `DocumentStore` port. Business logic depends on this interface; no provider SDK
> escapes its implementation (ADR-0021).

**What is built:** the port, its key derivation, and an in-memory implementation for tests. The
S3-compatible implementation and the MinIO development service are **not** built yet — they land
together, because `docker-compose.dev.yml` says a service declared before its first reader is a
service nobody verifies.

## Why the interface is this small

`put` · `get` · `exists` · `delete` · `createSignedUrl`. Every method has a caller in the archival
flow. `list`, `copy`, and the rest of the S3 surface do not — and a port that mirrors a vendor's API
has stopped being an abstraction; it just spells the vendor's name differently.

## `get` verifies rather than trusts

Reading an object checks its checksum and **throws on a mismatch**. Never a warning.

The whole reason to archive a source is that the claim derived from it can be re-checked, and a
document that changed since is not the document the claim was made from. ADR-0021 also notes that
R2's audit logging is weaker than S3's, so this checksum is the evidence a document was not altered
after archiving — not the provider's word for it.

"Absent" and "present but altered" throw **different** errors. They are different incidents.

## Immutable is not undeletable

`delete` exists for lifecycle expiry — temporary cache, superseded reports. It is not a licence to
remove evidence: a document supporting an imported requirement is never automatically deleted, and
nothing in the ingest path calls it.

## Keys are deterministic

```text
<category>/<jurisdiction>/<year>/<slug>.<extension>
immigration/de/2026/banz-at-18-12-2025-b3.pdf
```

Recomputable from the record it belongs to, because a key you cannot recompute is a key you cannot
audit — you would have to trust the stored string rather than check it. Case and punctuation are
collapsed for the reason company domains are: one document under two keys is two documents, and the
second is the one nobody knows about.

## `MemoryDocumentStore` is for tests, not for development

ADR-0021 requires development to exercise the **same S3 protocol** as production. The moment this is
used as "the local implementation", the real client stops being exercised until production — which
is how the gateway shipped with no CORS at all through M1c.

## Related

- ADR-0021, `docs/architecture/object-storage.md`, `docs/architecture/object-storage-rollout.md`
