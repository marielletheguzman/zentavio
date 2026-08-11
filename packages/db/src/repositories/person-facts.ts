/**
 * Reading and recording the facts a requirement asks for (ADR-0010, `entities/person-fact.md`).
 *
 * **A correction is a new version, never an edit.** The same rule profiles follow, for the same
 * reason: an eligibility verdict computed against a salary of 52 000 must stay reproducible after
 * the person corrects it to 48 000. An in-place update makes every prior verdict unexplainable
 * while its recorded version is unchanged — worse than having no history, because the record still
 * looks intact.
 */

import { validatePersonFactValue, type PersonFactValueType } from '@zentavio/types';
import type { Insertable, Kysely, Selectable } from 'kysely';
import type { Database, PersonFactsTable } from '../schema.ts';
import { uuidv7 } from '../uuid.ts';

export type PersonFactRow = Selectable<PersonFactsTable>;
export type NewPersonFact = Insertable<PersonFactsTable>;

export class UnknownFactKindError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(
      `'${key}' is not in person_fact_kinds. A rule may only ask for a fact the product can ` +
        'accept — otherwise needsFromUser names something nobody can answer.',
    );
    this.name = 'UnknownFactKindError';
    this.key = key;
  }
}

/**
 * The value does not satisfy the kind the catalogue declares.
 *
 * A separate error from `UnknownFactKindError` because they are different sentences: one is a
 * question nobody can answer, the other an answer in the wrong shape.
 */
export class InvalidFactValueError extends Error {
  readonly key: string;

  constructor(key: string, message: string) {
    super(message);
    this.name = 'InvalidFactValueError';
    this.key = key;
  }
}

/** Every current answer a person has given. What the evaluator is handed. */
export async function currentFacts(
  db: Kysely<Database>,
  userId: string,
): Promise<readonly PersonFactRow[]> {
  return db
    .selectFrom('person_facts')
    .selectAll()
    .where('user_id', '=', userId)
    .where('is_current', '=', true)
    .where('deleted_at', 'is', null)
    .orderBy('kind_key')
    .execute();
}

/** The catalogue, so a surface can ask a question in words rather than in a key. */
export async function factKinds(db: Kysely<Database>) {
  return db.selectFrom('person_fact_kinds').selectAll().orderBy('key').execute();
}

export interface RecordFactOptions {
  readonly userId: string;
  readonly key: string;
  readonly value: unknown;
  readonly basis?: 'self_reported' | 'derived' | 'verified';
  readonly basisDetail?: string;
  /** Required in effect when `basis` is `verified`; defaults to now rather than being omitted. */
  readonly verifiedAt?: Date;
  readonly validUntil?: string;
}

/**
 * Record an answer, superseding the previous one.
 *
 * One transaction: demoting the old row and inserting the new one must not be separable, or
 * `uq_person_facts__current` sees two live rows and the write fails in a way that looks like a
 * constraint bug rather than a race.
 *
 * The version is derived from what is stored rather than supplied, and is **never reused** —
 * including after a soft delete. "The salary as it stood at v2" is what an explained verdict is
 * built from.
 */
export async function recordFact(
  db: Kysely<Database>,
  options: RecordFactOptions,
): Promise<PersonFactRow> {
  return db.transaction().execute(async (trx) => {
    const kind = await trx
      .selectFrom('person_fact_kinds')
      .select(['key', 'value_type', 'unit', 'allowed_values'])
      .where('key', '=', options.key)
      .executeTakeFirst();

    // Checked here rather than left to the foreign key, so the caller gets a message naming the
    // rule instead of a constraint name it has to decode.
    if (kind === undefined) throw new UnknownFactKindError(options.key);

    // **The write boundary is where a fact becomes typed.** Enforced in the repository rather than
    // in the gateway's DTO so it holds for every caller — a script, a seed, an import — and not
    // only for the one that arrives over HTTP. The DTO cannot do it anyway: the type is a property
    // of the kind, which is a row, and restating it in a decorator would fork the catalogue.
    const check = validatePersonFactValue(
      {
        key: kind.key,
        valueType: kind.value_type as PersonFactValueType,
        unit: kind.unit,
        allowedValues: kind.allowed_values,
      },
      options.value,
    );
    if (!check.ok) throw new InvalidFactValueError(options.key, check.message);

    const highest = await trx
      .selectFrom('person_facts')
      .select('version')
      .where('user_id', '=', options.userId)
      .where('kind_key', '=', options.key)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();

    await trx
      .updateTable('person_facts')
      .set({ is_current: false })
      .where('user_id', '=', options.userId)
      .where('kind_key', '=', options.key)
      .where('is_current', '=', true)
      .execute();

    return trx
      .insertInto('person_facts')
      .values({
        id: uuidv7(),
        user_id: options.userId,
        kind_key: options.key,
        version: (highest?.version ?? 0) + 1,
        is_current: true,
        value: JSON.stringify(options.value),
        basis: options.basis ?? 'self_reported',
        basis_detail: options.basisDetail ?? null,
        // `ck_person_facts__verified` refuses a verified row with no date — a claim about
        // evidence with no evidence. The column has no default, so recording the moment of
        // verification is the caller's job, and defaulting it here is the honest reading: the
        // verification is being asserted now.
        verified_at: options.basis === 'verified' ? (options.verifiedAt ?? new Date()) : null,
        valid_until: options.validUntil ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
