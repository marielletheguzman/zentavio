# storage

> **Purpose:** The `DocumentStore` port and its S3-compatible implementation. No provider SDK
> escapes this package (ADR-0021).

**What is built:** the port, deterministic key derivation, an S3 implementation, and an in-memory
one for tests. The `documents` table, ingestion archival, and the enforcement flip are still ahead.

## The SDK ban is a build error

`eslint.config.mjs` restricts `@aws-sdk/*` everywhere except `src/s3-store.ts`, in the same shape as
the Qdrant-outside-`vector-store` rule. **Verified by attempting the violation**: an `import { S3Client }`
in `packages/db` is rejected with a message naming ADR-0021.

That is what makes "replacing R2 is configuration, not a rewrite" true rather than aspirational.

## One implementation, both environments

Production is Cloudflare R2, development is MinIO. They differ by endpoint and credentials, not by
code — which is the entire portability argument, and what stops the real client being executed for
the first time in production.

`forcePathStyle` is on unconditionally. MinIO serves `http://host:9000/<bucket>/<key>`; AWS defaults
to virtual-hosted style, which for a local endpoint resolves to a hostname that does not exist. It
is harmless on R2, and branching on the provider here would put provider-specific logic inside the
thing that exists to avoid it.

## `get` verifies rather than trusts

Reading recomputes the checksum and **throws** on mismatch. Never a warning, and deliberately not a
separate `verify()` a caller could skip — an unverified read is the failure the checksum exists to
prevent.

The checksum is taken over the bytes *we* store and recomputed on read. The provider's own integrity
header is not used: that would make the provider the witness to its own claim, and ADR-0021 notes
R2's audit logging is weaker than S3's.

"Absent" and "present but altered" throw **different** errors. Different incidents.

## Keys are deterministic

```text
<category>/<jurisdiction>/<year>/<slug>.<extension>
immigration/de/2026/banz-at-18-12-2025-b3.pdf
```

Recomputable from the record it belongs to — a key you cannot recompute is one you cannot audit.

## `ensureBucket` is not on the port

Provisioning is not something business logic does; in production the bucket is created by whoever
owns the account. It lives on `S3DocumentStore` because this is the only module allowed to hold the
SDK, and a test importing `CreateBucketCommand` would need an exemption from the very rule that
keeps the provider behind the port.

## `MemoryDocumentStore` is for tests, not development

ADR-0021 requires development to exercise the **same S3 protocol** as production. The moment this
becomes "the local implementation", the real client stops being exercised until production — which
is how the gateway shipped with no CORS at all through M1c.

## Running the integration suite

MinIO must be up (`docker compose -f infra/docker/docker-compose.dev.yml up -d minio`):

```bash
ZENTAVIO_TEST_DATABASE_URL='postgres://zentavio:zentavio_dev@localhost:5432/zentavio_test' \
ZENTAVIO_STORAGE_ENDPOINT='http://127.0.0.1:9000' \
ZENTAVIO_STORAGE_BUCKET='zentavio-documents' \
ZENTAVIO_STORAGE_ACCESS_KEY_ID='zentavio' \
ZENTAVIO_STORAGE_SECRET_ACCESS_KEY='zentavio_dev_secret' \
  corepack pnpm test:integration
```

## Related

- ADR-0021, `docs/architecture/object-storage.md`, `docs/architecture/object-storage-rollout.md`
