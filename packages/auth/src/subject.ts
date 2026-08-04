/**
 * Who is making a request.
 *
 * `docs/architecture/security.md`: identity lives here, no service implements its own, and
 * `services/api-gateway` is the only component that authenticates — everything behind it receives an
 * already-authenticated subject.
 *
 * **The mechanism is ADR-0017 (Accepted), and no provider is configured yet.** This file is the seam
 * that makes that survivable: the port already carries the decision, so routes never read a user id
 * out of the request body, and wiring a provider replaces one implementation instead of touching
 * every controller.
 *
 * The hole this closes is not theoretical. Until now `userId` arrived in the request body, so any
 * caller could read and correct any person's profile — with a résumé behind it.
 */

/** An authenticated person. Deliberately minimal: a service needs the id, not the identity. */
export interface Subject {
  /** `users.id`. The predicate every person-scoped query is written against. */
  readonly userId: string;
  /**
   * How this subject was established, for logging and for the audit trail.
   *
   * `insecure-dev` is deliberately ugly. It appears in logs, and it should look wrong there.
   */
  readonly authenticatedVia: 'oidc' | 'session' | 'insecure-dev';
}

/**
 * Refusal to establish a subject.
 *
 * Carries no detail about *why* beyond a fixed reason: an unauthenticated caller learning whether an
 * account exists, or whether a token was expired versus forged, is an enumeration oracle.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super('Not authenticated.');
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Establishes the subject for one request.
 *
 * Takes headers rather than a framework request object so `packages/auth` stays free of NestJS,
 * Express, and Next — it is imported by all three.
 */
export interface SubjectResolver {
  resolve(headers: ReadonlyMap<string, string>): Promise<Subject>;
}

/**
 * Refuses everything.
 *
 * **The default, and deliberately so.** `security.md` requires deny-by-default: a route without an
 * explicit policy must be unreachable rather than public. A missing configuration therefore produces
 * a locked door, not an open one — the failure mode that is safe to get wrong.
 */
export class DenyAllSubjectResolver implements SubjectResolver {
  resolve(): Promise<Subject> {
    return Promise.reject(new UnauthenticatedError());
  }
}

/** Header carrying the acting user for {@link InsecureDevSubjectResolver}. */
export const DEV_SUBJECT_HEADER = 'x-zentavio-dev-user';

/**
 * Trusts a header. **Not authentication.**
 *
 * This exists so the stack is demonstrable before a provider is configured, and it is written to be
 * impossible to enable by accident:
 *
 * - it must be constructed with `enabled: true`, which the composition root only passes when an
 *   explicitly-named config flag is set
 * - it refuses outright when `NODE_ENV` is `production`, regardless of that flag — a misconfigured
 *   deployment gets a locked door rather than an open one
 * - every subject it produces is marked `insecure-dev`, so it is visible in any log that records how
 *   a request was authenticated
 *
 * It is a stand-in for a provider, not a shortcut around the decision — ADR-0017 is Accepted, and
 * `OidcVerifier` in this package is what it chose. **When a provider is configured this class is
 * deleted, not extended.** That is the trigger: acceptance of the ADR is not, or this file would
 * already be gone.
 */
export class InsecureDevSubjectResolver implements SubjectResolver {
  readonly #enabled: boolean;
  readonly #isProduction: boolean;

  constructor(options: { readonly enabled: boolean; readonly isProduction: boolean }) {
    this.#enabled = options.enabled;
    this.#isProduction = options.isProduction;
  }

  resolve(headers: ReadonlyMap<string, string>): Promise<Subject> {
    // Production wins over the flag. Two independent conditions, because a single guard around
    // something this dangerous is a single point of failure.
    if (!this.#enabled || this.#isProduction) {
      return Promise.reject(new UnauthenticatedError());
    }

    const userId = headers.get(DEV_SUBJECT_HEADER);
    if (userId === undefined || !isUuid(userId)) {
      return Promise.reject(new UnauthenticatedError());
    }

    return Promise.resolve({ userId, authenticatedVia: 'insecure-dev' });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Authorize an action on a person-scoped resource.
 *
 * `security.md` requires two independent checks — at the gateway and again at the data boundary —
 * "because a single point of enforcement becomes a single point of failure". This is the second one,
 * and it exists so a service cannot accidentally operate on a user it was merely *told* about.
 *
 * The failure it prevents is the most common serious bug in an application of this shape: an
 * authenticated user reading another user's profile by changing an id.
 */
export function assertOwns(subject: Subject, resourceUserId: string): void {
  if (subject.userId !== resourceUserId) {
    // Same error as unauthenticated, on purpose. Distinguishing "not yours" from "does not exist"
    // tells an attacker which ids are real.
    throw new UnauthenticatedError();
  }
}
