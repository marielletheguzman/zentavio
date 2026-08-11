/**
 * Archived source documents (ADR-0021).
 *
 * **Metadata only.** The bytes live in object storage behind the `DocumentStore` port; this
 * records where they are and what their checksum was when archived. `packages/db` never imports a
 * storage SDK — `eslint.config.mjs` makes that a build error.
 */

import { sql, type Insertable, type Kysely, type Selectable } from 'kysely';
import type { Database, DocumentsTable, RequirementSourcesTable } from '../schema.ts';

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
 *
 * **Only the primary instrument.** A rule derived from several (ADR-0025) can pass this and still
 * be half-evidenced, which is what `unevidencedRequirements` exists to catch — use that one when
 * the question is "can every number in this rule be recomputed from archived bytes?".
 */
export function unarchivedRequirements(db: Kysely<Database>) {
  return db
    .selectFrom('requirements')
    .select(['id', 'requirement_id', 'source_url'])
    .where('document_id', 'is', null)
    .orderBy('requirement_id');
}

/** One instrument a requirement was derived from, as it is recorded (ADR-0025). */
export type RequirementSourceRow = Selectable<RequirementSourcesTable>;
export type NewRequirementSource = Insertable<RequirementSourcesTable>;

/**
 * Record the instruments a derived requirement came from.
 *
 * Written in one statement with the requirement's own archival, because a rule that cites some of
 * its operands is worse than one that cites none: it looks audited.
 */
export async function recordRequirementSources(
  db: Kysely<Database>,
  sources: readonly NewRequirementSource[],
): Promise<readonly RequirementSourceRow[]> {
  if (sources.length === 0) return [];

  return db
    .insertInto('requirement_sources')
    .values([...sources])
    .returningAll()
    .execute();
}

/** Every instrument behind one requirement — the audit query the table exists for. */
export function requirementSources(db: Kysely<Database>, requirementId: string) {
  return db
    .selectFrom('requirement_sources')
    .selectAll()
    .where('requirement_id', '=', requirementId)
    .orderBy('role')
    .execute();
}

/**
 * Requirements whose stated derivation is not fully evidenced.
 *
 * **The ADR-0025 counterpart to `unarchivedRequirements`.** A rule that says in
 * `domain_detail.derivedFrom` that it was computed from operands must have an archived document
 * for **each** of them; a rule claiming a derivation it cannot evidence is a number nobody can
 * recompute, dressed as an audited one.
 *
 * Counts rows rather than comparing to a list, because the count is the invariant: one
 * `requirement_sources` row per operand named in the derivation, plus the formula instrument.
 */
export function unevidencedRequirements(db: Kysely<Database>) {
  return db
    .selectFrom('requirements')
    .select(['id', 'requirement_id', 'source_url', 'domain_detail'])
    .where((eb) =>
      eb.or([
        // Derived, and nothing recorded at all.
        eb.and([
          sql<boolean>`domain_detail ? 'derivedFrom'`,
          eb.not(
            eb.exists(
              eb
                .selectFrom('requirement_sources')
                .select('id')
                .whereRef('requirement_sources.requirement_id', '=', 'requirements.id'),
            ),
          ),
        ]),
        // Derived, and fewer instruments recorded than the derivation names.
        eb.and([
          sql<boolean>`domain_detail ? 'derivedFrom'`,
          sql<boolean>`(
            SELECT count(*) FROM requirement_sources rs WHERE rs.requirement_id = requirements.id
          ) < jsonb_array_length(domain_detail -> 'derivedFrom')`,
        ]),
      ]),
    )
    .orderBy('requirement_id');
}
