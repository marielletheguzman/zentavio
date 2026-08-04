/**
 * Archived source documents (ADR-0021).
 *
 * **Metadata only.** The bytes live in object storage behind the `DocumentStore` port; this
 * records where they are and what their checksum was when archived. `packages/db` never imports a
 * storage SDK — `eslint.config.mjs` makes that a build error.
 */

import type { Insertable, Kysely, Selectable } from 'kysely';
import type { Database, DocumentsTable } from '../schema.ts';

export type DocumentRow = Selectable<DocumentsTable>;
export type NewDocument = Insertable<DocumentsTable>;

/**
 * Record an archived document, or return the one already there.
 *
 * **Idempotent on `object_key`**, because keys are deterministic: re-archiving the same source
 * produces the same key, and a scheduled run that re-reads an unchanged page must not fail on a
 * unique violation. The stored row wins — it is what the existing requirements already cite.
 *
 * A checksum that differs for the same key is **not** silently accepted. The key is derived from
 * the document's identity, so two different byte streams under one key means either the source
 * changed without changing its identity, or a key collision — both need a person, not a merge.
 */
export async function recordDocument(
  db: Kysely<Database>,
  document: NewDocument,
): Promise<{ readonly row: DocumentRow; readonly created: boolean }> {
  const existing = await db
    .selectFrom('documents')
    .selectAll()
    .where('object_key', '=', document.object_key)
    .executeTakeFirst();

  if (existing !== undefined) {
    if (existing.sha256 !== document.sha256) {
      throw new DocumentConflictError(String(document.object_key), existing.sha256, String(document.sha256));
    }
    return { row: existing, created: false };
  }

  const row = await db.insertInto('documents').values(document).returningAll().executeTakeFirstOrThrow();
  return { row, created: true };
}

export class DocumentConflictError extends Error {
  constructor(objectKey: string, stored: string, incoming: string) {
    super(
      `${objectKey} is already archived with checksum ${stored}, but the incoming copy hashes to ` +
        `${incoming}. The key is derived from the document's identity, so this is either a source ` +
        'that changed without changing its identity, or a key collision. Neither is safe to merge.',
    );
    this.name = 'DocumentConflictError';
  }
}

/** Link a stored requirement to the document that evidences it. */
export function attachDocument(db: Kysely<Database>, requirementId: string, documentId: string) {
  return db.updateTable('requirements').set({ document_id: documentId }).where('id', '=', requirementId);
}

/**
 * Requirements with no archived evidence.
 *
 * **This is the query ADR-0021's enforcement phase must return empty before the flip.** Until it
 * does, turning `no-archived-document` into an error would reject rules that were accepted when
 * archival did not exist.
 */
export function unarchivedRequirements(db: Kysely<Database>) {
  return db
    .selectFrom('requirements')
    .select(['id', 'requirement_id', 'source_url'])
    .where('document_id', 'is', null)
    .orderBy('requirement_id');
}
