# api-gateway

> **Purpose:** Public API surface: auth, rate-limiting, request routing to internal services.

The only component that authenticates, and the only one a browser talks to.

**Compiled, not type-stripped** (ADR-0014's amendment): NestJS needs decorators and parameter
properties, which are a `SyntaxError` under Node's strip-only mode. Run
`pnpm --filter @zentavio/api-gateway build` first. **A stale `dist/` is the failure mode — the
symptom is a change that appears to do nothing.**

| Route | Does |
|---|---|
| `POST /v1/resume/upload` | multipart → `ai/resume-parser` → a versioned profile |
| `POST /v1/resume/corrections` | a disagreement, recorded as a new profile version |
| `POST /v1/targets` | the career track being pursued |
| `GET /v1/gap` | requirements + graph + profile → `ai/skill-gap` |

**The guard is global**, not per-route: opting a route *in* to protection is a list someone forgets,
and the route they forget is the one that leaks. The subject comes from `@CurrentSubject()`, never
from a request body — it used to arrive in the body, and that was an authorization hole.

**Injection uses explicit `Symbol` tokens** (`tokens.ts`), never decorator metadata: an
`import type { Kysely }` erases to `Function`, and the container then fails at boot with "argument
Function at index [0]", naming neither the file nor the cause.

**Every service client returns a discriminated outcome**, so a caller cannot forget that "the
service was unreachable" and "the résumé was unreadable" are different problems with different
answers for the user. Responses are validated, never cast.

**Most failures are 200.** A résumé that could not be read, a track nobody has modelled, a person
with no profile yet — all results to show, not errors to retry. `4xx` is reserved for "the caller
sent something wrong", and 503 for a service that did not answer.

`ZENTAVIO_WEB_ORIGIN` must be set or no browser can call this at all. The gateway warns at boot when
it is empty, because the symptom otherwise is "Could not reach the server" — a message pointing at
the network when the cause is one unset variable.

## Not here

Rate limiting, and any authorization beyond ownership.
