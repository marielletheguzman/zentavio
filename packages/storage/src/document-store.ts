/**
 * The `DocumentStore` port (ADR-0021).
 *
 * **Business logic depends on this interface and never on a provider SDK.** That is the whole
 * portability argument: choosing an S3-compatible provider makes the *protocol* the portable
 * interface, so replacing Cloudflare R2 is configuration rather than a rewrite, and local
 * development runs the identical code path against MinIO.
 *
 * ## Why the interface is this small
 *
 * Every method here has a caller in the archival flow. `list`, `copy`, and the rest of the S3
 * surface do not, and a port that mirrors a vendor's API is a port that has stopped being an
 * abstraction — it just spells the vendor's name differently.
 *
 * ## Immutable is not undeletable
 *
 * `delete` exists for lifecycle expiry — temporary cache, superseded reports
 * (`docs/architecture/object-storage.md`). It is **not** a licence to remove evidence: a document
 * supporting an imported requirement is never automatically deleted, and nothing in the ingest
 * path calls it.
 */

import type { Readable } from 'node:stream';

/** Where an object lives. Deterministic, so a key can be recomputed from the record it belongs to. */
export type ObjectKey = string;

export interface UploadRequest {
  readonly key: ObjectKey;
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface DocumentRef {
  readonly key: ObjectKey;
  readonly provider: string;
  readonly bucket: string;
  readonly sizeBytes: number;
  /**
   * Computed over the bytes that were stored, not over what the caller intended to store.
   *
   * This is the integrity guarantee, and it is why `get` verifies rather than trusts: R2's audit
   * logging is weaker than S3's (ADR-0021), so the checksum is the evidence a document was not
   * altered after archiving.
   */
  readonly sha256: string;
}

export class IntegrityError extends Error {
  constructor(key: ObjectKey, expected: string, actual: string) {
    super(
      `${key} does not match its recorded checksum: expected ${expected}, read ${actual}. ` +
        'A document that changed after archiving is not evidence.',
    );
    this.name = 'IntegrityError';
  }
}

export class ObjectNotFoundError extends Error {
  constructor(key: ObjectKey) {
    super(`No object at ${key}.`);
    this.name = 'ObjectNotFoundError';
  }
}

export interface DocumentStore {
  /** Store bytes and return what was actually written, checksum included. */
  put(document: UploadRequest): Promise<DocumentRef>;

  /**
   * Read an object back, **verifying its checksum**.
   *
   * A mismatch throws. It is never a warning: the whole reason to archive a source is that the
   * claim derived from it can be re-checked, and a document that changed since is not the document
   * the claim was made from.
   */
  get(key: ObjectKey, expectedSha256: string): Promise<Uint8Array>;

  exists(key: ObjectKey): Promise<boolean>;

  /** Lifecycle expiry only. Never called on evidence — see the module docstring. */
  delete(key: ObjectKey): Promise<void>;

  /**
   * A time-limited URL for a client to download with.
   *
   * Buckets are private and never public (`docs/architecture/object-storage.md`), so this is the
   * only way bytes reach a browser.
   */
  createSignedUrl(key: ObjectKey, expiresInSeconds: number): Promise<string>;
}

/**
 * Deterministic object keys: `<category>/<jurisdiction>/<year>/<slug>.<extension>`.
 *
 * Deterministic because a key that cannot be recomputed from the record is a key that cannot be
 * audited — you would have to trust the stored string rather than being able to check it.
 *
 * Lower-cased and punctuation-collapsed for the same reason company domains are: one document
 * stored under two keys is two documents, and the second is the one nobody knows about.
 */
export function objectKeyFor(parts: {
  readonly category: string;
  readonly jurisdiction: string;
  readonly year: number;
  readonly slug: string;
  readonly extension: string;
}): ObjectKey {
  const clean = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  return [
    clean(parts.category),
    clean(parts.jurisdiction),
    String(parts.year),
    `${clean(parts.slug)}.${clean(parts.extension)}`,
  ].join('/');
}

/** Re-exported so a consumer can type a stream without importing from `node:stream` itself. */
export type { Readable };
