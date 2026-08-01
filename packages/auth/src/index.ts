/**
 * `@zentavio/auth` — identity, and only identity.
 *
 * `docs/architecture/security.md`: no service implements its own. The mechanism is ADR-0017 and is
 * still Proposed; what exists today is the seam, so routes stop trusting a user id from the request
 * body and swapping in a real provider replaces one class.
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
