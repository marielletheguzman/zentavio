# auth

> **Purpose:** Session, RBAC, and identity helpers.

Token verification and subject resolution (ADR-0017). **Owns no storage** — mapping a verified
identity to a `users` row happens in the gateway, which `docs/architecture/security.md` makes the
only component that authenticates.

```text
src/
├── oidc.ts      OidcVerifier: signature, algorithm, issuer, audience, expiry, via JWKS
└── subject.ts   SubjectResolver, DenyAll, InsecureDev, assertOwns
```

**No vendor is named.** OIDC is a standard, so Clerk, WorkOS, Auth0 or a self-hosted Keycloak are
two environment variables rather than a code change.

**Every verification failure returns one identical error.** Distinguishing expired from forged from
wrong-audience is a probing oracle. `assertOwns` collapses "not yours" into the same error as
"unauthenticated" for the same reason — telling them apart tells an attacker which ids are real.

`InsecureDevSubjectResolver` is refused in production, and checks that twice: a single guard around
something this dangerous is a single point of failure. Real authentication wins whenever it is
configured, so a forgotten dev flag cannot downgrade a working environment.

## Not here

Sessions and RBAC. There is one subject and no roles yet, and a role model invented before its first
policy is a guess.
