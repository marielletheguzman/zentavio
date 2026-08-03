/**
 * Provisions the user behind the **development** credential (ADR-0017).
 *
 * `InsecureDevSubjectResolver` in `packages/auth` validates the header and stops there, because that
 * package owns no storage. This adapter is the storage half, and it lives in the gateway for exactly
 * the reason `OidcSubjectResolver` does: `docs/architecture/security.md` makes the gateway the only
 * component that authenticates.
 *
 * **The defect this closes.** The OIDC resolver provisions just-in-time; the dev one did not. So a
 * dev header naming a user id with no row produced a foreign key violation several layers down —
 * surfacing as a 500 with a correlation id and no hint that the cause was "that user does not
 * exist". Every write path hit it: the résumé upload, the correction, the target.
 *
 * **The dangerous check is not duplicated here.** Whether the dev credential is permitted at all
 * stays in the wrapped resolver — one implementation of "refuse in production", not two that can
 * drift. This adapter only runs after that resolver has already said yes.
 */

import { sql, type Kysely } from 'kysely';
import type { Subject, SubjectResolver } from '@zentavio/auth';
import type { Database } from '@zentavio/db';

export class DevSubjectResolver implements SubjectResolver {
  readonly #inner: SubjectResolver;
  readonly #db: Kysely<Database>;

  constructor(inner: SubjectResolver, db: Kysely<Database>) {
    this.#inner = inner;
    this.#db = db;
  }

  async resolve(headers: ReadonlyMap<string, string>): Promise<Subject> {
    // Throws for a missing, malformed, disabled, or production-context credential. Nothing below
    // runs unless the credential was accepted.
    const subject = await this.#inner.resolve(headers);
    await this.#ensureUser(subject.userId);
    return subject;
  }

  /**
   * Create the row if it is absent, and leave it entirely alone if it is not.
   *
   * `ON CONFLICT DO NOTHING` rather than a read-then-write: two concurrent first requests would
   * otherwise both see nothing and both insert. The id comes from the header rather than being
   * generated, which is the whole point — a developer picks an id, uses it across restarts, and
   * gets the same account.
   *
   * An **erased** user is deliberately not revived. `eraseUser` tombstones the row rather than
   * deleting it, so the insert conflicts and does nothing, and the tombstone keeps its cleared
   * columns. A dev credential that silently un-erased an account would make the erasure tests lie.
   */
  async #ensureUser(userId: string): Promise<void> {
    await this.#db
      .insertInto('users')
      .values({
        id: userId,
        // Routable nowhere, and derived from the id so it is stable across restarts. `users.email`
        // is NOT NULL, and a plausible-looking address would be worse — someone would eventually
        // send mail to it.
        email: sql<string>`'dev+' || ${userId}::text || '@invalid'`,
        auth_provider: 'password',
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
  }
}
