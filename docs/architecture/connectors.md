# Connector Architecture

> **Purpose:** Plugin connector architecture: interface, registry, normalization contract.

Adding a data source must be an additive change: one folder plus one registry line. Nothing in
`services/ingestion` may learn a source's name. That property is what keeps coverage growth cheap,
and coverage growth is the permanent condition of this product (ADR-0002).

## The interface

Defined in `connectors/core`. Every source implements exactly this:

```typescript
export interface Connector<TRaw, TNormalized> {
  readonly meta: ConnectorMeta;

  search(query: SearchQuery, cursor?: Cursor): Promise<Page<TRaw>>;
  fetch(externalId: string): Promise<TRaw | null>;
  normalize(raw: TRaw): TNormalized;
  validate(normalized: TNormalized): ValidationResult;
  healthCheck(): Promise<HealthStatus>;
}

export interface ConnectorMeta {
  id: string;          // stable, kebab-case, never renamed or reused: 'greenhouse'
  version: string;     // semver of this connector's behavior
  kind: ConnectorKind; // 'job-board' | 'salary' | 'company' | 'immigration' | 'learning' | 'market'
  regions: string[];   // ISO country codes meaningfully covered, or ['*']
  rateLimit: RateLimitSpec;
  reliability: number; // 0..1, observed — never declared
  termsUrl: string;    // checked before the connector was written
}
```

`meta.id` is a foreign key in the database. It is never renamed and never reused.

### One job each

| Method | Does | Must not |
|---|---|---|
| `search` | cursor-paginated discovery, returns raw payloads untouched | normalize, persist |
| `fetch` | single item by the source's own id; `null` for gone, throws for broken | guess at a missing item |
| `normalize` | **pure** raw → Zentavio type | do I/O, read the clock, use randomness |
| `validate` | returns accept / flag / reject with reasons | throw |
| `healthCheck` | cheap upstream liveness | burn credentials or fetch a full page |

## The normalization contract

`normalize` is the only place a source's quirks are allowed, and it is subject to three hard rules.

**Pure.** No database, no HTTP, no `Date.now()`, no `Math.random()`. Called twice with the same
payload it returns the same result — asserted by a test with the clock and network stubbed to throw.
This is what makes golden-file testing possible, and it is why entity resolution (company aliases,
location canonicalization) happens later in the knowledge engine rather than here.

**Total.** Every raw payload maps to a normalized record or to a validation error. Never a thrown
exception.

**Honest.** A field the source does not provide is `null`. Never a guess, never a default, never a
market average. `salaryMin: 60000` as a fallback is invented data, and every score derived from it
inherits the invention.

```typescript
normalize(raw: GreenhouseJob): JobPosting {
  return {
    externalId:  raw.id.toString(),
    sourceId:    this.meta.id,
    title:       raw.title.trim(),
    companyName: raw.company?.name ?? null,
    location:    parseLocation(raw.location?.name),   // pure helper, same folder
    isRemote:    detectRemote(raw.location?.name, raw.content),
    salaryMin:   raw.salary_min ?? null,              // absent stays absent
    currency:    raw.salary_currency ?? null,
    postedAt:    raw.updated_at ? new Date(raw.updated_at) : null,
    sourceUrl:   raw.absolute_url,
    raw,                                              // kept for provenance
  };
}
```

## The registry

`connectors/core` holds the registry and is the **only** module that may reference a connector.

```text
services/ingestion  ──►  connectors/core (registry)  ──►  connectors/<kind>/<id>/
        │                                                          │
        └── iterates; never names a source                         └── source-specific logic lives here
```

Enforced in `eslint.config.mjs`: a `service` element may depend on `connector-core` but not on
`connector`, and no connector may import another connector. `import { greenhouse }` inside
`services/` is a build error.

## Operational behavior

Shared helpers in `connectors/core`, never hand-rolled per connector:

- **Retry** only what is retryable — network errors, `429`, `502`, `503`, `504` — with exponential
  backoff and full jitter, capped attempts and total time. Never retry `400`, `401`, `403`, `422`:
  those are bugs or auth problems, and retrying hides them.
- **Rate limiting** client-side from `meta.rateLimit`, so the platform is a good citizen even when the
  source would not stop us. Honour `Retry-After`.
- **Pagination** is cursor-based in the contract even when the source uses offsets — the connector
  translates. A cursor must be resumable after a crash.
- **Circuit breaking** per source: repeated terminal failures open the breaker, `healthCheck` closes
  it. One dead source must never stall or fail a run.
- **Reliability** is observed from validation pass rate, uptime, freshness accuracy, and outcome
  feedback. The tier bounds the ceiling; observation sets the value.

## Identity and deduplication

**The connector states identity; persistence deduplicates** (ADR-0034).

```text
connector  →  (source_id, source_scope, external_id)      one source's own coordinates
persistence →  dedup_key + dedup_basis                     the claim that two postings are one job
```

`source_scope` is the sub-namespace an `external_id` belongs to — a Lever board slug, an ATS tenant —
and the empty string when a source has one namespace. It is a namespace and **never an employer**.

A connector sees one feed, so it cannot make a cross-source claim, and the key the previous version of
this document prescribed —
`sha256(norm(company)|norm(title)|norm(location)|coarse(postedAt))` — needed a company name that an
ATS feed does not publish. That derivation still exists, in
`packages/db/src/repositories/jobs.ts`, alongside a `source-identity` derivation used when no employer
identity is available; the stored `dedup_basis` says which one produced a key.

Alias mapping (`Google LLC` → `google`) happens during reconciliation, not in the connector —
`normalize` has no I/O and therefore no registry access.

## Provenance

Every record carries `sourceId`, `externalId`, `fetchedAt`, `connectorVersion`, `sourceUrl`, and the
raw payload. The raw payload is kept forever: storage is cheap and re-fetching history is impossible.
Re-ingesting is idempotent on (`sourceId`, `externalId`).

## Legal and ethical constraints

- Terms of service and `robots.txt` are checked **before** the connector is written, and the legal
  basis is recorded in the connector's README.
- No bypassing rate limits, no scraping behind a login wall.
- If a source disallows automated access, the answer is that we do not integrate it.

## Constraints

- No source-specific logic outside `connectors/<kind>/<id>/`.
- No I/O, clock, or randomness in `normalize`.
- No persistence in a connector — they return data, never write.
- No credential in code or fixture. `packages/config` only.
- No connector importing another connector.
- No invented field value.
- No `meta.id` rename or reuse.
- No hand-rolled retry or rate limiting.

## Adding a source

1. Check terms of service and rate limits. Stop here if automated access is disallowed.
2. Scaffold from `.claude/templates/connector.template.md`.
3. Capture real raw payloads into `tests/fixtures/connectors/<id>/` — `normalize` is tested against
   fixtures, never the live API.
4. Implement `normalize` pure, then `validate`, then `search`/`fetch`.
5. Document the source identity triple in the README. **Do not derive a dedup key** — ADR-0034.
6. Register in `connectors/core/src/default-registry.ts`. Confirm `services/ingestion` needed
   **zero** edits.
7. Add config under `connectors.<id>.*` in `packages/config`.

## Related

- `overview.md`, `principles.md` (plugin-first), `data-flow.md`
- `docs/development/connector-guide.md` — the step-by-step
- `docs/features/job-aggregation.md`, `docs/database/entities/connector-source.md`
- `.claude/skills/connectors/SKILL.md`, `.claude/skills/job-aggregation/SKILL.md`
- ADR-0002 (connector plugin model), ADR-0005 (the lint rule that enforces the boundary)
