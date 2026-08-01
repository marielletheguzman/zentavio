# ADR-0017: How a person proves who they are

- **Status:** Accepted
- **Accepted:** 2026-08-01
- **Date:** 2026-08-01
- **Deciders:** project lead
- **Affects:** `packages/auth`, `services/api-gateway`, `apps/web`, `docs/architecture/security.md`,
  ADR-0015 (if Supabase Auth is chosen)

## Context

M1a works end to end and is **not deployable**, for one reason: `userId` arrives in the request body.
Any caller can name any user, read their profile, and correct their skills. That is not a missing
feature, it is an authorization hole with a résumé behind it.

`docs/architecture/security.md` already fixes most of the design and rules out the usual mistakes:

- identity lives in `packages/auth`; no service implements its own
- **`services/api-gateway` is the only component that authenticates**; everything behind it receives
  an already-authenticated subject
- sessions are short-lived tokens with refresh, **opaque to the frontend**, never in `localStorage`
  or a URL
- passwords, *if used at all*, are hashed with a memory-hard algorithm — and it says **prefer
  delegating to an identity provider over storing credentials**
- MFA available, required for `apps/admin`
- every request is authorized **against the subject**, enforced at the gateway and re-checked at the
  data boundary

What it does **not** decide is the mechanism, and the mechanism is a dependency, so it needs this ADR
(`.claude/context/tech-stack.md`).

Two constraints make the choice non-obvious.

**Storing credentials is a liability we may not want.** This product holds résumés and immigration
status. A password database raises the cost of a breach and brings reset flows, rate limiting,
breach-list checks, and MFA enrolment — each of which is someone's full-time job somewhere.

**ADR-0015 deliberately excluded Supabase Auth**, and named this exact moment: "Auth is the tempting
one precisely because M1a defers authentication, and adopting it by convenience rather than by
decision is exactly how a boundary erodes." Choosing it now is legitimate; choosing it *because it is
already there* is what that clause exists to prevent.

## Options considered

### Option A — Passwordless email links, implemented here

A signed, single-use, short-lived token emailed to the address; the gateway exchanges it for a
session cookie.

**Advantages.** No credential is ever stored, which is the strongest form of "prefer delegating over
storing". No password reset flow, because there is no password. Small surface, all ours. Works with
the existing `users` schema unchanged.

**Disadvantages.** Requires an email provider — another dependency, and another vendor holding user
addresses. Login latency becomes email-delivery latency, which is genuinely poor UX. Token handling
is security-critical code we own, and getting single-use and expiry exactly right *is* the job. MFA
is not naturally available.

### Option B — Supabase Auth

The platform already hosting PostgreSQL (ADR-0015).

**Advantages.** No new vendor, and the rows already live in the same project. Email, OAuth, and MFA
out of the box. Fastest route to a deployable M1a by a wide margin.

**Disadvantages.** **Directly reopens ADR-0015's "and nothing else" clause**, which is the
load-bearing half of that decision — its low reversal cost holds *only while nothing but PostgreSQL
is used*. Adopting it means the migration story stops being `pg_dump` and becomes a rewrite. It also
splits a user's identity between Supabase's `auth.users` and ours, and reconciling two user tables is
a known source of subtle bugs.

### Option C — A hosted identity provider (Clerk, WorkOS, Auth0)

**Advantages.** Delegation, exactly as `security.md` prefers. MFA, OAuth, session management, and
breach detection are theirs. `users.auth_provider = 'oidc:<issuer>'` and `auth_subject` already exist
in the schema for precisely this — **the schema was designed expecting it**, including a unique index
on the pair.

**Disadvantages.** A new vendor with real cost at scale, and pricing that tends to bite exactly when
the product starts working. Another external dependency in the login path. Lock-in is moderate: OIDC
is a standard, but enrolment and MFA state are not portable.

### Option D — Passwords, hashed with Argon2id

**Advantages.** No vendor, no email dependency, works offline, and users understand it. One library.

**Disadvantages.** The option `security.md` explicitly says to avoid preferring. It brings reset
flows, rate limiting, breach-list checks, credential-stuffing defence, and MFA enrolment — each a
place to be quietly wrong. A stolen password database belonging to people who uploaded résumés and
immigration status is close to the worst outcome this product has.

### Option E — Do nothing

**Advantages.** Zero work. M1a is demonstrable today.

**Disadvantages.** The current state is **not "no authentication", it is a hole**: `userId` in the
body means any caller reads and edits any profile. Nothing can be exposed to a real person, so the
milestone requiring one cannot be met. This option stops being free the moment anything is deployed.

## Decision

**Option C — a hosted OIDC provider.** Decided 2026-08-01 by the project lead.

Chosen for three specific reasons: `security.md`
already states a preference for delegating over storing; the `users` table was **already designed for
it**; and it keeps ADR-0015's "and nothing else" intact, so the database stays a `pg_dump` away from
any other host.

Option B was the fastest and would have been defensible, but it would have reopened ADR-0015's "and
nothing else" clause — and that clause is the reason the database is still a `pg_dump` away from any
other host. It was rejected on that ground, not on capability.

**The vendor is deliberately not named here, and that is the substance of the decision rather than a
gap in it.** OIDC is a standard: the issuer, audience, and JWKS endpoint are *configuration*. So the
implementation verifies tokens generically — discovery, JWKS, signature, issuer, audience, expiry —
and Clerk, WorkOS, Auth0, or a self-hosted Keycloak are a change to three environment variables
rather than a change to code. Naming one in an ADR would convert a config value into a decision
needing another ADR to undo.

**One dependency is adopted with this decision: `jose`** for JWT and JWKS verification. Named here
rather than smuggled in during implementation (`.claude/context/tech-stack.md`). It is the standard
JOSE implementation for JavaScript, has no dependencies of its own, and the alternative —
hand-rolling signature verification — is the single worst place in this system to be creative.

**Users are provisioned just-in-time.** The first time a valid token arrives with an unseen `sub`, a
`users` row is created with `auth_provider = 'oidc:<issuer>'` and `auth_subject = <sub>`. The
alternative is an invite flow nobody asked for, and the schema's unique index on
`(auth_provider, auth_subject)` already makes the operation safe under a race.

## Consequences

*Written against the recommendation. Rewritten if another option is chosen.*

**Accepted costs.**

- A vendor sits in the login path. If they are down, nobody signs in.
- Cost grows with users, and the pricing cliff usually arrives at the worst time.
- MFA enrolment state is not portable, so switching providers means re-enrolling users.

**Follow-up work.**

- Implement the `Subject` resolver in `packages/auth` against the provider's tokens.
- Session cookie: `httpOnly`, `Secure`, `SameSite=Lax`, short-lived with refresh — never
  `localStorage`, never a URL.
- Re-check the subject at the data boundary; `security.md` requires two independent checks.
- **Delete `userId` from every DTO. That is the change that closes the hole.**
- Rate-limit the login path.

**Reversal cost.** Low while the subject stays behind a port and the token is validated in one place;
high the moment provider-specific claims leak into a service.

## Compliance

- **Verified by attempting to violate it:** a request with no session, and a request naming another
  user's id, must both be refused. Until that test exists, the correct statement is "authentication is
  configured", not "profiles are protected".
- No route reads a subject from the request body or a query parameter.
- Deny by default: a route without an explicit policy is unreachable, not public.
- No token in `localStorage`, a URL, or a log.

## Related

- `docs/architecture/security.md` — the constraints this must satisfy
- ADR-0015 — the "and nothing else" clause Option B would reopen
- `docs/database/entities/user.md` — `auth_provider` / `auth_subject`, already shaped for OIDC
