/**
 * Reading the pathways a comparison is built from.
 *
 * The seed writes this table (`immigration-pathways.ts`); this reads it. Nothing here interprets a
 * pathway — the quota column is handed back as stored, because deciding what a capped-and-unsourced
 * quota *says* is a rendering decision (ADR-0027) and belongs to whoever renders it.
 *
 * **`REMOTE` is not in this table and never will be** (ADR-0028). A caller assembling destinations
 * adds it alongside these rows rather than expecting a query to produce it — a pathway row
 * describing nothing would be worse than no row.
 */

import type { Kysely, Selectable } from 'kysely';
import type { Database, ImmigrationPathwaysTable } from '../schema.ts';

export type PathwayRow = Pick<
  Selectable<ImmigrationPathwaysTable>,
  'pathway_id' | 'jurisdiction' | 'name' | 'description' | 'quota' | 'is_active'
>;

/**
 * Every active pathway, ordered by id.
 *
 * **Ordered so the query is deterministic, not because the order means anything.** The comparison
 * re-sorts within its own groups and declares that order arbitrary (ADR-0026); a caller must not
 * read significance into the sequence rows arrive in.
 */
export function activePathways(db: Kysely<Database>): Promise<PathwayRow[]> {
  return db
    .selectFrom('immigration_pathways')
    .select(['pathway_id', 'jurisdiction', 'name', 'description', 'quota', 'is_active'])
    .where('is_active', '=', true)
    .orderBy('pathway_id')
    .execute();
}
