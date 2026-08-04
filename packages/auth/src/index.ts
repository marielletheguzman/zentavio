/**
 * `@zentavio/auth` — identity, and only identity.
 *
 * `docs/architecture/security.md`: no service implements its own. The mechanism is ADR-0017
 * (Accepted, and implemented here) — routes never trust a user id from the request body. What is
 * missing is a configured provider, so `InsecureDevSubjectResolver` stands in for one; it refuses
 * outright under `NODE_ENV=production`. Wiring a real provider replaces one class.
 */

export {
  DEV_SUBJECT_HEADER,
  DenyAllSubjectResolver,
  InsecureDevSubjectResolver,
  UnauthenticatedError,
  assertOwns,
  type Subject,
  type SubjectResolver,
} from './subject.ts';

export {
  OidcVerifier,
  TokenVerificationError,
  bearerToken,
  type OidcConfig,
  type VerifiedIdentity,
} from './oidc.ts';
