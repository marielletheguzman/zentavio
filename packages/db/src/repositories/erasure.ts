/**
 * Account erasure (`docs/database/data-retention.md`).
 *
 * **Retrofitted privacy is a breach already shipped** (`docs/roadmap/mvp.md`), which is why this
 * exists in M1a rather than when the first deletion request arrives. Résumés are the most sensitive
 * data this system holds, and the moment they can be stored is the moment they must be deletable.
 *
 * Erasure is deliberately **not** `ON DELETE CASCADE` from `users`. The foreign keys are `RESTRICT`
 * on purpose: deletion order is a decision recorded here in one readable place, not an emergent
 * property of the schema that changes whenever someone adds a table. A cascade also makes "delete
 * the account row" silently destroy data nobody was thinking about.
 *
 * **The user row survives as a tombstone.** `status = 'erased'` with identifying columns cleared,
 * so foreign keys and anonymised aggregates stay coherent. A deleted row would orphan or destroy
 * outcome data that is no longer personal.
 */

import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.ts';

export interface ErasureReport {
  readonly userId: string;
  /** Profile versions hard-deleted. `profile_skills` cascades from these. */
  readonly profilesDeleted: number;
  /** Target careers hard-deleted. What someone was trying to become is personal. */
  readonly targetsDeleted: number;
  /**
   * Person facts hard-deleted, all versions. An expected salary is among the most sensitive
   * things this system holds, and a superseded answer is exactly as personal as the live one.
   */
  readonly personFactsDeleted: number;
  /** False when the user did not exist, so a caller can tell "erased" from "nothing to erase". */
  readonly userTombstoned: boolean;
}

/**
 * Erase a user's personal data, leaving a tombstone.
 *
 * One transaction: a half-erased account is the worst outcome available — the user has been told
 * their data is gone, and some of it is not.
 *
 * What is deliberately **not** erased:
 *
 * - **`user_consents`** — the record that consent existed under a policy version is itself the
 *   legal basis for the processing that already happened. Destroying it destroys the defence for
 *   having held the data at all (`data-retention.md`).
 * - **World facts** — `skills`, `careers` and their aliases are not personal data and are shared by
 *   every user.
 *
 * There is no uploaded document to delete: it is parsed and discarded within the request that
 * carried it (`docs/features/resume-parsing.md`). The parsed profile is the asset, the file is a
 * liability, and the liability was never stored.
 */
export async function eraseUser(db: Kysely<Database>, userId: string): Promise<ErasureReport> {
  return db.transaction().execute(async (trx) => {
    // profile_skills has ON DELETE CASCADE from user_profiles, so this removes both. Deleting all
    // versions, not just the current one — "hard delete, all versions" is what the schedule says,
    // and a superseded profile is exactly as personal as the live one.
    const profiles = await trx
      .deleteFrom('user_profiles')
      .where('user_id', '=', userId)
      .executeTakeFirst();

    // Hard delete, per data-retention.md. A target is not a world fact — "I am trying to become a
    // platform engineer" is a statement about a person, and it outlives the profile that motivated
    // it unless it is deleted here.
    const targets = await trx.deleteFrom('user_targets').where('user_id', '=', userId).executeTakeFirst();

    // All versions, not just the current one. A superseded salary is exactly as personal as the
    // live one, and keeping history here would mean the erasure claim is false for the answers a
    // person most regretted giving. `person_fact_kinds` is untouched — it is a catalogue of what
    // may be asked, shared by every user, and holds nobody's answer.
    const personFacts = await trx
      .deleteFrom('person_facts')
      .where('user_id', '=', userId)
      .executeTakeFirst();

    const tombstone = await trx
      .updateTable('users')
      .set({
        // Cleared rather than nulled where the column is NOT NULL: the row must remain valid.
        // A per-user constant keeps `uq_users__email` satisfiable if two accounts are ever erased.
        email: sql<string>`'erased+' || id || '@invalid'`,
        email_verified_at: null,
        auth_subject: null,
        timezone: null,
        last_seen_at: null,
        status: 'erased',
        updated_at: sql`now()`,
      })
      .where('id', '=', userId)
      .where('status', '!=', 'erased')
      .executeTakeFirst();

    return {
      userId,
      profilesDeleted: Number(profiles.numDeletedRows),
      targetsDeleted: Number(targets.numDeletedRows),
      personFactsDeleted: Number(personFacts.numDeletedRows),
      userTombstoned: Number(tombstone.numUpdatedRows) === 1,
    };
  });
}

/**
 * Whether a user has any personal data left.
 *
 * The check that makes an erasure claim verifiable rather than asserted. A deletion routine nobody
 * can audit is a promise, and this is the audit.
 */
export async function hasPersonalData(db: Kysely<Database>, userId: string): Promise<boolean> {
  const profile = await db
    .selectFrom('user_profiles')
    .select('id')
    .where('user_id', '=', userId)
    .limit(1)
    .executeTakeFirst();

  if (profile) return true;

  // Audited as well as deleted. A table added to the schema without a line here would leave the
  // erasure claim technically false while every test still passed.
  const target = await db
    .selectFrom('user_targets')
    .select('id')
    .where('user_id', '=', userId)
    .limit(1)
    .executeTakeFirst();

  if (target) return true;

  const personFact = await db
    .selectFrom('person_facts')
    .select('id')
    .where('user_id', '=', userId)
    .limit(1)
    .executeTakeFirst();

  if (personFact) return true;

  const user = await db
    .selectFrom('users')
    .select(['status', 'email'])
    .where('id', '=', userId)
    .executeTakeFirst();

  if (!user) return false;
  return user.status !== 'erased';
}
