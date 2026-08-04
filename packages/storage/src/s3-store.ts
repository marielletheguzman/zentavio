/**
 * The S3-compatible `DocumentStore` (ADR-0021).
 *
 * **The only module in the repository permitted to import an AWS SDK.** `eslint.config.mjs` bans
 * `@aws-sdk/*` everywhere else, in the same shape as the Qdrant-outside-`vector-store` rule — so
 * "no provider SDK escapes the port" is a build error rather than a review comment.
 *
 * One implementation serves both environments. Production is Cloudflare R2 and development is
 * MinIO; they differ by endpoint and credentials, not by code. That is the entire portability
 * argument of ADR-0021, and it is also what stops the real client being executed for the first time
 * in production.
 *
 * ## `forcePathStyle`
 *
 * MinIO serves `http://host:9000/<bucket>/<key>`; AWS defaults to virtual-hosted style
 * (`https://<bucket>.host/<key>`), which for a local endpoint resolves to a hostname that does not
 * exist. Path style is required for MinIO and harmless on R2, so it is on unconditionally rather
 * than branching on which provider is configured — a branch here would be provider-specific logic
 * inside the thing that exists to avoid it.
 */

import { createHash } from 'node:crypto';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  IntegrityError,
  ObjectNotFoundError,
  type DocumentRef,
  type DocumentStore,
  type ObjectKey,
  type UploadRequest,
} from './document-store.ts';

export interface S3DocumentStoreOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Recorded on every `DocumentRef`, so a row says which provider actually holds the bytes. */
  readonly provider: string;
}

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** S3 signals "no such key" through several error shapes depending on the operation. */
function isNotFound(error: unknown): boolean {
  const named = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    named.name === 'NoSuchKey' ||
    named.name === 'NotFound' ||
    named.$metadata?.httpStatusCode === 404
  );
}

export class S3DocumentStore implements DocumentStore {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #provider: string;

  constructor(options: S3DocumentStoreOptions) {
    this.#bucket = options.bucket;
    this.#provider = options.provider;
    this.#client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      // See the module docstring: required for MinIO, harmless on R2.
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(document: UploadRequest): Promise<DocumentRef> {
    // Computed before the write and sent as `ChecksumSHA256` is *not* what happens here: the
    // checksum is taken over the bytes we are storing, and `get` recomputes it on read. Trusting
    // the provider's own integrity header would make the provider the witness to its own claim.
    const sha256 = sha256Of(document.body);

    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: document.key,
        Body: document.body,
        ContentType: document.contentType,
        // Carried as metadata so an object can be checked without the database row that points at
        // it — the archive has to be auditable on its own.
        Metadata: { sha256 },
      }),
    );

    return {
      key: document.key,
      provider: this.#provider,
      bucket: this.#bucket,
      sizeBytes: document.body.byteLength,
      sha256,
    };
  }

  async get(key: ObjectKey, expectedSha256: string): Promise<Uint8Array> {
    let bytes: Uint8Array;

    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      if (response.Body === undefined) throw new ObjectNotFoundError(key);
      bytes = await response.Body.transformToByteArray();
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError(key);
      throw error;
    }

    // Verified here rather than in a separate method a caller could skip. An unverified read is
    // the failure the checksum exists to prevent, so it is not optional.
    const actual = sha256Of(bytes);
    if (actual !== expectedSha256) throw new IntegrityError(key, expectedSha256, actual);

    return bytes;
  }

  async exists(key: ObjectKey): Promise<boolean> {
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async delete(key: ObjectKey): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }

  async createSignedUrl(key: ObjectKey, expiresInSeconds: number): Promise<string> {
    // Checked first, because S3 signs a URL for a key that does not exist perfectly happily. A
    // signed link to nothing is one a user clicks and blames us for.
    if (!(await this.exists(key))) throw new ObjectNotFoundError(key);

    return getSignedUrl(
      this.#client,
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  /**
   * Create the bucket if it is absent.
   *
   * Lives here because this is the only module permitted to hold the SDK, and a test that had to
   * import `CreateBucketCommand` itself would need an exemption from the rule that keeps the
   * provider behind the port. Not part of `DocumentStore`: provisioning is not something business
   * logic does, and in production the bucket is created by whoever owns the account.
   */
  async ensureBucket(): Promise<void> {
    try {
      await this.#client.send(new CreateBucketCommand({ Bucket: this.#bucket }));
    } catch (error) {
      const named = error as { name?: string };
      // Already ours, or already exists. Both mean the postcondition holds.
      if (named.name === 'BucketAlreadyOwnedByYou' || named.name === 'BucketAlreadyExists') return;
      throw error;
    }
  }
}
