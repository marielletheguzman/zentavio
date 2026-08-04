/**
 * `@zentavio/storage` — the `DocumentStore` port (ADR-0021).
 *
 * Business logic depends on this interface and never on a provider SDK. Replacing Cloudflare R2 is
 * configuration, not a rewrite, because the S3 protocol is the portable interface.
 */

export {
  IntegrityError,
  ObjectNotFoundError,
  objectKeyFor,
  type DocumentRef,
  type DocumentStore,
  type ObjectKey,
  type UploadRequest,
} from './document-store.ts';

export { MemoryDocumentStore, sha256Of } from './memory-store.ts';
