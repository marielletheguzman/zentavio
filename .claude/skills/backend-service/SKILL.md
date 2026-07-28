---
name: backend-service
description: How a deployable service under services/ is built — NestJS module layout, DTO validation, error taxonomy, config access, logging, health checks, and the HTTP/event contract it exposes. Load when creating or editing anything in services/api-gateway, services/ingestion, services/matching, services/notifications, services/billing, when adding a controller/route/handler, when wiring a repository, or when a service needs a new config value, event subscription, or health probe.
---

# Backend Service

## Purpose

Make every service in `services/` look like the same service from the outside: same error
shape, same config source, same log fields, same health endpoints, same DTO discipline.
A new engineer (or a new Claude session) should be able to open any service and already
know where things live. This skill owns the inside of a service; `architecture` owns
whether the service should exist and what it may import.

## Scope

**Applies to:** `services/*` (TypeScript/NestJS), their controllers, use cases,
repositories, DTOs, event handlers, and their `main.ts` bootstrap.

**Does not apply to:** `ai/*` — those are Python and stateless (`prompt-engineering`,
`ai-matching`). Schema and query design (`database`). Connector internals (`connectors`).
Cross-service topology (`architecture`).

## Service internal layout

```text
services/<name>/
├── src/
│   ├── main.ts                  # bootstrap only: app factory, pipes, shutdown hooks
│   ├── app.module.ts            # composition root
│   ├── <feature>/
│   │   ├── <feature>.controller.ts   # HTTP only — no logic
│   │   ├── <feature>.service.ts      # use case orchestration
│   │   ├── dto/                      # request/response DTOs, class-validator
│   │   ├── ports/                    # interfaces this feature needs
│   │   └── adapters/                 # implementations of other layers' ports
│   ├── events/                  # publishers and consumers
│   └── health/                  # liveness + readiness
└── test/
```

One feature folder per bounded capability. A controller with more than the CRUD of one
noun is two features.

## Responsibilities

1. Validate every inbound payload with a DTO before it reaches a service method.
   Unvalidated input entering a use case is a defect.
2. Return the shared error envelope for every failure path — never a bare Nest exception
   body, never a stack trace across the wire.
3. Read configuration only through `packages/config`. No `process.env` outside it.
4. Log through `packages/logger` with the request-scoped correlation id attached.
5. Expose `GET /health/live` and `GET /health/ready`. Readiness checks real dependencies
   (DB, Redis, downstream gateway) — a readiness probe that always returns 200 is a lie.
6. Keep controllers free of business logic and services free of HTTP concepts
   (no `Request`, `Response`, status codes, or headers inside a use case).
7. Version every published event and every public route.

## Workflow

1. Read `docs/development/conventions.md` and `docs/architecture/overview.md`.
2. Confirm with `architecture` that the capability belongs in this service.
3. Define the DTOs first — request, response, and the domain type in `packages/types` if
   another package needs it.
4. Write the use case against ports. Inject adapters in the module, never instantiate them
   inside the use case.
5. Add the route or event handler. Register the event name in `packages/events`.
6. Add config keys to `packages/config` with a schema entry and a safe default or an
   explicit "required" marker.
7. Write tests: unit for the use case with fake ports, integration for the route.
   See `testing`.
8. Update the service's own doc and `docs/architecture/data-flow.md` if the flow changed.

## Error taxonomy

Every failure maps to exactly one of these, and the envelope is identical everywhere:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Human-readable, safe to show a user.",
    "details": [{ "field": "targetCountry", "issue": "unsupported" }],
    "correlationId": "01J8Z...",
    "retryable": false
  }
}
```

| code | HTTP | retryable |
|---|---|---|
| `VALIDATION_FAILED` | 400 | no |
| `UNAUTHENTICATED` | 401 | no |
| `FORBIDDEN` | 403 | no |
| `NOT_FOUND` | 404 | no |
| `CONFLICT` | 409 | no |
| `RATE_LIMITED` | 429 | yes |
| `UPSTREAM_UNAVAILABLE` | 502 | yes |
| `INTERNAL` | 500 | no |

`retryable` is part of the contract, not a hint. Clients and connectors branch on it.

## Constraints

- **No `process.env` outside `packages/config`.** Untyped, undocumented config is banned.
- **No business logic in a controller.** Parse, delegate, shape. Three lines is typical.
- **No ORM entity crossing a service boundary.** Map to a DTO or a `packages/types` type.
- **No unversioned event.** `job.posting.normalized.v1`, never `job.posting.normalized`.
- **No swallowed error.** Catch to translate or to add context, never to hide.
- **No secret, token, email, or resume text in a log line.** See `docs/architecture/privacy.md`.
- **No cross-service database write.** A service owns its tables; others ask over HTTP or
  react to an event.
- **No synchronous call to `ai/*` on a request path that a user waits on** unless the
  endpoint is explicitly documented as long-running and streams or polls.

## Examples

**Bad — logic in the controller, env read inline, leaked internals.**

```typescript
@Post('match')
async match(@Body() body: any) {
  if (!body.userId) throw new BadRequestException('missing');
  const limit = Number(process.env.MATCH_LIMIT ?? 20);
  const rows = await this.repo.query(`SELECT * FROM jobs LIMIT ${limit}`);
  return rows;
}
```

**Good.**

```typescript
@Post('match')
@HttpCode(200)
async match(@Body() dto: CreateMatchRequestDto): Promise<MatchResponseDto> {
  const result = await this.matching.rank(dto.userId, dto.filters);
  return MatchResponseDto.from(result);
}
```

Validation lives in `CreateMatchRequestDto`, the limit lives in `packages/config`, the
query lives behind a repository port, and the response shape is explicit.

## Best Practices

- Name use case methods after the domain verb (`rank`, `enrich`, `normalize`), not the
  transport (`handlePost`).
- A service method that takes more than four parameters wants a command object.
- Prefer returning a result type over throwing for expected outcomes ("no match found" is
  data, not an exception). Throw for broken invariants.
- Idempotency keys on anything that spends money, sends a message, or writes an outcome.
- Graceful shutdown is not optional: drain in-flight requests, close the DB pool, ack or
  nack outstanding events.
- If two services need the same helper, it belongs in `packages/*`, not in a copy.
