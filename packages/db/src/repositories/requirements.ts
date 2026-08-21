/**
 * The requirements repository (ADR-0010, ADR-0012).
 *
 * **This is where the invariants are enforced**, which is why repositories are hand-written rather
 * than generated (`docs/development/testing.md`). The database has `CHECK` constraints for the same
 * rules; these guards exist so a violation fails with a message naming the rule, before a round
 * trip, rather than surfacing as a constraint error a caller has to decode.
 *
 * Defence in depth, not duplication: the constraint is the guarantee, the guard is the diagnosis.
 */

import type { Insertable, Kysely } from 'kysely';
import type { Database, ImposedByColumn, RequirementsTable } from '../schema.ts';

export class RequirementInvariantError extends Error {
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(`${rule}: ${message}`);
    this.name = 'RequirementInvariantError';
    this.rule = rule;
  }
}

/**
 * What a caller supplies. `Insertable` makes generated columns optional and maps each `ColumnType`
 * to its insert form, so this cannot drift from the table definition the way a hand-written Omit
 * would.
 */
export type NewRequirement = Insertable<RequirementsTable>;

/**
 * Every rule that must hold before a row is written. Returns all violations rather than the first,
 * so a malformed ingest reports everything wrong with it at once.
 */
export function validateRequirement(row: NewRequirement): readonly RequirementInvariantError[] {
  const errors: RequirementInvariantError[] = [];

  // Tier 1 only, for every domain. A recognition rule from a forum is not a recognition rule.
  if (row.source_tier !== 1) {
    errors.push(
      new RequirementInvariantError(
        'ck_req__tier_one',
        `source_tier must be 1, got ${row.source_tier}. Only the responsible official authority ` +
          'may produce a requirement.',
      ),
    );
  }

  if (!row.source_url?.trim()) {
    errors.push(
      new RequirementInvariantError(
        'source_url',
        'a requirement must point at the exact page it came from',
      ),
    );
  }

  // "Who do I contact?" is one of the most useful things this feature answers, and it is only
  // answerable if the row records the deciding body.
  if (!row.authority?.trim()) {
    errors.push(
      new RequirementInvariantError('authority', 'the body that decides must be recorded'),
    );
  }

  // Scope must match the domain: a visa rule has a pathway, a licence rule has a profession.
  if (row.domain === 'immigration' && !row.pathway_id) {
    errors.push(
      new RequirementInvariantError(
        'ck_req__scope',
        'an immigration requirement belongs to a pathway, so pathway_id is required',
      ),
    );
  }
  if ((row.domain === 'recognition' || row.domain === 'credential') && !row.profession) {
    errors.push(
      new RequirementInvariantError(
        'ck_req__scope',
        `a ${row.domain} requirement belongs to a profession, not a visa pathway, ` +
          'so profession is required',
      ),
    );
  }

  if (row.contested === true && !row.contested_note?.trim()) {
    errors.push(
      new RequirementInvariantError(
        'ck_req__contested_note',
        'an ambiguous source must have the ambiguity written down, never resolved by picking the ' +
          'friendlier reading',
      ),
    );
  }

  if (row.effective_to !== null && row.effective_to !== undefined) {
    // Both are ISO YYYY-MM-DD strings (see schema.ts), so a lexical comparison is also the
    // chronological one — no Date construction, and therefore no timezone.
    const from = String(row.effective_from);
    const to = String(row.effective_to);
    if (to < from) {
      errors.push(
        new RequirementInvariantError('ck_req__validity', 'effective_to precedes effective_from'),
      );
    }
  }

  return errors;
}

function assertValid(row: NewRequirement): void {
  const errors = validateRequirement(row);
  if (errors.length === 0) return;
  throw new RequirementInvariantError(
    errors.map((e) => e.rule).join(', '),
    `\n  ${errors.map((e) => e.message).join('\n  ')}`,
  );
}

export function insertRequirement(db: Kysely<Database>, row: NewRequirement) {
  assertValid(row);
  return db.insertInto('requirements').values(row);
}

/**
 * Requirements as of a date — the query that makes an answer reproducible.
 *
 * Not "current": every response carries `asOf`, and a verdict given last year must still be
 * explicable against the rules as they stood then (`entities/requirement.md`).
 *
 * ## What this deliberately does not filter on
 *
 * **`applies_to` is never touched here** (ADR-0029). Origin scoping lives in
 * `applies_to.origin_jurisdiction`, and an absent key means the rule applies whatever the
 * counterpart is — "absent means broader, not narrower", the same reading `route` already gets.
 * A SQL filter on that key would drop exactly the rules that apply to everybody, which is the
 * opposite of what scoping is for. Retrieval gathers candidates; the evaluator matches them.
 *
 * So the scope here is the **structural** one — which pathway, which profession, which
 * jurisdiction, and which side imposed the rule — and nothing about the person.
 */
export function requirementsAsOf(
  db: Kysely<Database>,
  scope: {
    readonly pathwayId?: string;
    readonly profession?: string;
    readonly jurisdiction?: string;
    /**
     * Which side imposes the rule. `origin` is how the origin state's own duties are gathered —
     * an overseas-employment clearance is imposed by the Philippines and is invisible to any query
     * scoped to the destination.
     */
    readonly imposedBy?: ImposedByColumn;
    /**
     * Widen `profession` to also return rules that name no profession.
     *
     * An origin state's duties frequently apply to every departing worker rather than to nurses in
     * particular, and those rows carry `profession IS NULL`. Matching the profession exactly would
     * drop them silently — the person would be told nothing about a clearance they still have to
     * obtain. Off by default: a destination's recognition lookup wants the profession's own rules
     * and nothing else.
     */
    readonly includeProfessionless?: boolean;
  },
  asOf: string,
) {
  let query = db
    .selectFrom('requirements')
    .selectAll()
    .where('effective_from', '<=', asOf)
    .where((eb) =>
      eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', asOf)]),
    );

  if (scope.pathwayId !== undefined) query = query.where('pathway_id', '=', scope.pathwayId);

  if (scope.profession !== undefined) {
    const profession = scope.profession;
    query =
      scope.includeProfessionless === true
        ? query.where((eb) =>
            eb.or([eb('profession', '=', profession), eb('profession', 'is', null)]),
          )
        : query.where('profession', '=', profession);
  }

  if (scope.jurisdiction !== undefined) query = query.where('jurisdiction', '=', scope.jurisdiction);
  if (scope.imposedBy !== undefined) query = query.where('imposed_by', '=', scope.imposedBy);

  return query;
}

/**
 * Supersede a requirement: close the old row, insert the new one.
 *
 * **Never an `UPDATE` of a value.** A user planned against the requirement as it stood, and
 * "the threshold you were planning against changed" only exists if the old row does. The caller runs
 * both statements in one transaction — returned as a pair rather than executed here, so the
 * repository does not own transaction scope.
 */
export function supersedeRequirement(
  db: Kysely<Database>,
  previous: { readonly id: string; readonly closeOn: string },
  next: NewRequirement,
) {
  assertValid(next);
  if (next.supersedes !== previous.id) {
    throw new RequirementInvariantError(
      'supersedes',
      'the replacement must point at the row it supersedes, or the version chain breaks',
    );
  }

  return {
    close: db
      .updateTable('requirements')
      .set({ effective_to: previous.closeOn })
      .where('id', '=', previous.id)
      .where('effective_to', 'is', null),
    insert: insertRequirement(db, next),
  };
}

/** Requirements past their refresh window — stale must be visible, never silent. */
export function staleRequirements(db: Kysely<Database>, asOf: string) {
  return db
    .selectFrom('requirements')
    .selectAll()
    .where('effective_to', 'is', null)
    .where('refresh_after', '<', asOf);
}
