/**
 * An in-memory `DocumentStore`, for tests.
 *
 * **Not a development stub.** ADR-0021 requires development to run the same S3 protocol as
 * production, so this exists only so unit tests can exercise callers without a container. The
 * moment it is used as "the local implementation", the real client stops being exercised until
 * production — which is how the gateway shipped with no CORS at all through M1c.
 */

import { createHash } from 'node:crypto';

import {
  IntegrityError,
  ObjectNotFoundError,
  type DocumentRef,
  type DocumentStore,
  type ObjectKey,
  type UploadRequest,
} from './document-store.ts';

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class MemoryDocumentStore implements DocumentStore {
  readonly #objects = new Map<ObjectKey, Uint8Array>();
  readonly #bucket: string;

  constructor(bucket = 'test') {
    this.#bucket = bucket;
  }

  async put(document: UploadRequest): Promise<DocumentRef> {
    // Copied on write. Holding the caller's buffer would let a later mutation change what is
    // "stored", which no real object store would do and no test should be able to rely on.
    const stored = Uint8Array.from(document.body);
    this.#objects.set(document.key, stored);

    return {
      key: document.key,
      provider: 'memory',
      bucket: this.#bucket,
      sizeBytes: stored.byteLength,
      // Over the bytes actually stored, not over what the caller intended.
      sha256: sha256Of(stored),
    };
  }

  async get(key: ObjectKey, expectedSha256: string): Promise<Uint8Array> {
    const stored = this.#objects.get(key);
    if (stored === undefined) throw new ObjectNotFoundError(key);

    const actual = sha256Of(stored);
    if (actual !== expectedSha256) throw new IntegrityError(key, expectedSha256, actual);

    return Uint8Array.from(stored);
  }

  async exists(key: ObjectKey): Promise<boolean> {
    return this.#objects.has(key);
  }

  async delete(key: ObjectKey): Promise<void> {
    this.#objects.delete(key);
  }

  async createSignedUrl(key: ObjectKey, expiresInSeconds: number): Promise<string> {
    if (!this.#objects.has(key)) throw new ObjectNotFoundError(key);
    return `memory://${this.#bucket}/${key}?expires=${String(expiresInSeconds)}`;
  }

  /** Test-only: overwrite stored bytes to prove integrity verification actually fires. */
  corrupt(key: ObjectKey, bytes: Uint8Array): void {
    this.#objects.set(key, bytes);
  }
}
