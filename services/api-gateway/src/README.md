# src

> **Purpose:** Gateway source: routes, middleware, service clients.

```text
main.ts · app.module.ts · tokens.ts
auth/     subject.guard.ts, oidc- and dev- resolvers, current-subject.decorator.ts
resume/   controller, service, parser-client, dto/
gap/      controller, service, gap-client, dto/
health/   health.controller.ts
http/     error-envelope.ts
```

**One feature per directory, controller and service and client together.** The client is the only
thing that speaks to an `ai/*` service, and it returns a discriminated outcome so a caller cannot
forget that "the service was unreachable" and "the résumé was unreadable" are different problems.

**`tokens.ts` holds explicit `Symbol` tokens** because injection by decorator metadata does not
survive `import type` — a `Kysely` type erases to `Function`, and the container then fails at boot
with "argument Function at index [0]", naming neither the file nor the cause.

`subject.guard.ts` is registered **globally** in `app.module.ts`. Opting each route in is a list
someone forgets, and the forgotten route is the one that leaks.
