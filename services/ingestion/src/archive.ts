/**
 * Archiving a source document before its rules are stored (ADR-0021, rollout phase 5).
 *
 * **Persistence lives here, never in a connector.** The connector says what its source document is
 * — `archivable()` returns bytes and a content type — and this stores them and records the row.
 * That split is what lets the archive hold the actual document while keeping the rule that a
 * connector returns data and writes nothing.
 *
 * ## Order: store the object first, then the row
 *
 * ADR-0021 fixes this and the reason is asymmetry. An orphaned object is waste — bytes nobody
 * points at, found by a lifecycle sweep. An orphaned row is a **citation that resolves to
 * nothing**, which looks like evidence right up until someone tries to read it. Writing the row
 * first would risk exactly that.
 */

import type { AnyConnector, ArchivableSource, DerivedSource } from '@zentavio/connectors-core';
import {
  recordDocument,
  type Database,
  type DocumentRow,
  type NewRequirementSource,
} from '@zentavio/db';
import { objectKeyFor, type DocumentStore } from '@zentavio/storage';
import type { Kysely } from 'kysely';

export type ArchiveOutcome =
  | { readonly kind: 'archived'; readonly document: DocumentRow; readonly isOriginal: boolean }
  /** The connector has nothing archivable — a pure API whose response we already keep. */
  | { readonly kind: 'nothing-to-archive' }
  /**
   * Storage refused. Reported rather than thrown so the caller decides — a warning today, a
   * rejection once ADR-0021's enforcement phase lands.
   */
  | { readonly kind: 'failed'; readonly reason: string };

export interface ArchiveDeps {
  readonly store: DocumentStore;
  readonly db: Kysely<Database>;
  readonly newId: () => string;
}

/**
 * Archive one raw payload and record it.
 *
 * Idempotent by construction: the object key is derived from the document's identity, so
 * re-archiving an unchanged source writes the same key and `recordDocument` returns the existing
 * row. A *different* checksum under that key is refused rather than merged — see `recordDocument`.
 */
export async function archiveSource(
  connector: AnyConnector,
  raw: unknown,
  sourceUrl: string,
  retrievedAt: string,
  deps: ArchiveDeps,
): Promise<ArchiveOutcome> {
  const describe = connector.archivable?.bind(connector);
  if (describe === undefined) return { kind: 'nothing-to-archive' };

  let source: ArchivableSource | null;
  try {
    source = describe(raw);
  } catch (error) {
    return { kind: 'failed', reason: describeError(error) };
  }
  if (source === null) return { kind: 'nothing-to-archive' };

  return archiveOne(source, sourceUrl, retrievedAt, deps);
}

/**
 * Store one document's bytes and record its row.
 *
 * Extracted so the single-source path and the derived-source path (ADR-0025) cannot drift on the
 * order the ADR fixes: **object first, row second**. An orphaned object is waste; an orphaned row
 * is a citation that resolves to nothing.
 */
async function archiveOne(
  source: ArchivableSource,
  sourceUrl: string,
  retrievedAt: string,
  deps: ArchiveDeps,
): Promise<ArchiveOutcome> {
  const key = objectKeyFor({
    category: 'immigration',
    jurisdiction: source.jurisdiction,
    year: source.year,
    slug: source.slug,
    extension: source.extension,
  });

  let ref;
  try {
    // The object first. See the module docstring.
    ref = await deps.store.put({ key, body: source.bytes, contentType: source.contentType });
  } catch (error) {
    return { kind: 'failed', reason: describeError(error) };
  }

  try {
    const { row } = await recordDocument(deps.db, {
      id: deps.newId(),
      object_key: ref.key,
      provider: ref.provider,
      bucket: ref.bucket,
      mime_type: source.contentType,
      size_bytes: String(ref.sizeBytes),
      sha256: ref.sha256,
      source_url: sourceUrl,
      retrieved_at: retrievedAt,
      // `archived_at` is left to the column default, which is `now()` — and now is genuinely when
      // the object reached storage, because the `put` above has already returned. Supplying it
      // here would only let a caller claim a different moment.
    });

    return { kind: 'archived', document: row, isOriginal: source.isOriginal };
  } catch (error) {
    // The object is stored and the row is not. Orphaned bytes, which is the cheap failure — and
    // reported rather than swallowed, because the requirement must not be stored citing nothing.
    return { kind: 'failed', reason: describeError(error) };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One archived instrument, with the part it played in the rule (ADR-0025).
 *
 * `NewRequirementSource` minus `requirement_id`, because the requirement does not exist yet when
 * archival runs — ADR-0021 fixes that order and this preserves it. The caller binds these to a
 * requirement id after `executePlan` inserts the rows.
 */
export type ArchivedInstrument = Omit<NewRequirementSource, 'id' | 'requirement_id'>;

export type DerivedArchiveOutcome =
  | { readonly kind: 'archived'; readonly instruments: readonly ArchivedInstrument[] }
  /** The connector declares no derived sources — every existing connector, and that is fine. */
  | { readonly kind: 'nothing-to-archive' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Archive **every** instrument a derived rule was computed from.
 *
 * ADR-0025's enforcement point. A rule whose threshold is a product of two published instruments
 * must be able to cite both, each archived, or the number in the database cannot be recomputed
 * from evidence — and a citation that resolves to one of two operands is worse than none, because
 * it looks audited.
 *
 * **All or nothing.** The first failure abandons the set rather than returning a partial one:
 * storing the rule with half its instruments is exactly the half-evidenced state this exists to
 * prevent. Objects already written are orphaned bytes, which is the cheap failure ADR-0021 chose
 * deliberately over an orphaned citation.
 */
export async function archiveDerivedSources(
  connector: AnyConnector,
  raw: unknown,
  deps: ArchiveDeps,
): Promise<DerivedArchiveOutcome> {
  const describe = connector.archivableSources?.bind(connector);
  if (describe === undefined) return { kind: 'nothing-to-archive' };

  let sources: readonly DerivedSource[];
  try {
    sources = describe(raw);
  } catch (error) {
    return { kind: 'failed', reason: describeError(error) };
  }
  if (sources.length === 0) return { kind: 'nothing-to-archive' };

  const instruments: ArchivedInstrument[] = [];
  for (const derived of sources) {
    const outcome = await archiveOne(derived.source, derived.sourceUrl, derived.retrievedAt, deps);
    if (outcome.kind !== 'archived') {
      return {
        kind: 'failed',
        reason: `${derived.instrumentId}: ${outcome.kind === 'failed' ? outcome.reason : 'nothing to archive'}`,
      };
    }

    instruments.push({
      document_id: outcome.document.id,
      role: derived.role,
      instrument_id: derived.instrumentId,
      source_url: derived.sourceUrl,
      retrieved_at: derived.retrievedAt,
    });
  }

  return { kind: 'archived', instruments };
}
