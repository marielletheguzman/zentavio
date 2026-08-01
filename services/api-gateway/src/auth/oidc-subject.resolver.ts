/**
 * Maps a verified OIDC identity to a Zentavio user (ADR-0017).
 *
 * `packages/auth` verifies the token and stops there — it owns no storage. This adapter is where the
 * external subject becomes a `users.id`, and it lives in the gateway because
 * `docs/architecture/security.md` makes the gateway the only component that authenticates.
 *
 * **Just-in-time provisioning.** The first valid token bearing an unseen `sub` creates the row. The
 * alternative is an invite flow nobody asked for, and the schema's unique index on
 * `(auth_provider, auth_subject)` already makes this safe under a race — two concurrent first
 * requests cannot produce two accounts.
 */

import { sql, type Kysely } from 'kysely';
import { UnauthenticatedError, type Subject, type SubjectResolver } from '@zentavio/auth';
import { bearerToken, type OidcVerifier, type VerifiedIdentity } from '@zentavio/auth';
import { uuidv7, type Database } from '@zentavio/db';

export class OidcSubjectResolver implements SubjectResolver {
  readonly #verifier: OidcVerifier;
  readonly #db: Kysely<Database>;

  constructor(verifier: OidcVerifier, db: Kysely<Database>) {
    this.#verifier = verifier;
    this.#db = db;
  }

  async resolve(headers: ReadonlyMap<string, string>): Promise<Subject> {
    const token = bearerToken(headers);
    if (token === undefined) throw new UnauthenticatedError();

    let identity: VerifiedIdentity;
    try {
      identity = await this.#verifier.verify(token);
    } catch {
      // Collapsed deliberately: the verifier already refuses to say why, and re-raising its type
      // here would leak the distinction through the guard.
      throw new UnauthenticatedError();
    }

    const userId = await this.#findOrCreate(identity);
    return { userId, authenticatedVia: 'oidc' };
  }

  async #findOrCreate(identity: VerifiedIdentity): Promise<string> {
    const existing = await this.#db
      .selectFrom('users')
      .select(['id'])
      .where('auth_provider', '=', identity.provider)
      .where('auth_subject', '=', identity.subject)
      .executeTakeFirst();

    if (existing) return existing.id;

    // **A person who erased their account and signs in again becomes a NEW user with no data.**
    //
    // That is a consequence of erasure clearing `auth_subject` (`eraseUser`), and it is the right
    // one: refusing them forever would be a ban, not an erasure. The tombstone keeps foreign keys
    // and anonymised aggregates coherent; it deliberately does not keep the person out.
    //
    // Worth stating because the alternative reading — "check for status = 'erased' here" — is
    // unreachable code that looks like a security control. There was one, and it was removed.

    const id = uuidv7();
    const inserted = await this.#db
      .insertInto('users')
      .values({
        id,
        // A verified address when the provider asserts one; otherwise a routable-nowhere placeholder
        // derived from the subject. `users.email` is NOT NULL, and inventing a plausible-looking
        // address would be worse than an obviously synthetic one.
        email: identity.email ?? `${identity.subject}@oidc.invalid`,
        email_verified_at: identity.email === undefined ? null : sql`now()`,
        auth_provider: identity.provider,
        auth_subject: identity.subject,
      })
      // Two concurrent first requests race here; the unique index makes the loser a no-op rather
      // than a duplicate account.
      //
      // The `where` is not optional. `uq_users__auth_subject` is a PARTIAL index
      // (`WHERE auth_subject IS NOT NULL`), and PostgreSQL refuses to use a partial index as a
      // conflict target unless the statement repeats its predicate — "there is no unique or
      // exclusion constraint matching the ON CONFLICT specification". Without it every first
      // sign-in fails, not just a racing one.
      .onConflict((oc) =>
        oc.columns(['auth_provider', 'auth_subject']).where('auth_subject', 'is not', null).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();

    if (inserted) return inserted.id;

    // Lost the race: the winner's row exists now.
    const winner = await this.#db
      .selectFrom('users')
      .select('id')
      .where('auth_provider', '=', identity.provider)
      .where('auth_subject', '=', identity.subject)
      .executeTakeFirst();

    if (!winner) throw new UnauthenticatedError();
    return winner.id;
  }
}
