---
name: connectors
description: The connector plugin contract — search/fetch/normalize/validate/healthCheck, registry registration, retry and rate limiting, pagination, deduplication keys, source reliability scoring, and per-source config. Load when adding or editing anything under connectors/, adding a job board, salary, company, immigration, or learning-resource source, debugging an ingestion failure, or when tempted to put source-specific logic in services/ingestion.
---

# Connectors

## Purpose

Adding a data source must be an additive change: one folder plus one registry line.
Nothing in `services/ingestion` may learn the name of a source. This skill defines the
contract that makes that true, and the operational behavior (retries, limits, health) that
keeps one flaky source from degrading the platform.

## Scope

**Applies to:** `connectors/core` (the contract) and every implementation under
`connectors/job-boards/`, `salary-data/`, `company-data/`, `immigration-data/`,
`learning-resources/`, `market-trends/`.

**Does not apply to:** scheduling and orchestration (`job-aggregation`,
`services/ingestion`), how normalized facts are stored and reconciled
(`knowledge-engine`), scoring of the resulting jobs (`ai-matching`).

## The contract

Every connector implements exactly this, from `connectors/core`:

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
  id: string;              // stable, kebab-case, never reused: 'greenhouse'
  version: string;         // semver of this connector's behavior
  kind: ConnectorKind;     // 'job-board' | 'salary' | 'company' | 'immigration' | 'learning' | 'market'
  regions: string[];       // ISO country codes it meaningfully covers, or ['*']
  rateLimit: RateLimitSpec;
  reliability: number;     // 0..1, maintained from observed outcomes
  termsUrl: string;        // the source's ToS — checked before writing the connector
}
```

Each method has one job:

- **`search`** — cursor-paginated discovery. Returns raw payloads untouched. Never
  normalizes, never persists.
- **`fetch`** — single-item retrieval by the source's own id. Returns `null` for gone,
  throws for broken.
- **`normalize`** — pure function. Raw shape → Zentavio type from `packages/types`.
  No I/O, no clock, no randomness. This is the only place source quirks are allowed.
- **`validate`** — is this normalized record usable? Returns errors and warnings, does not
  throw. A record with warnings is ingested and flagged; a record with errors is rejected
  with a reason.
- **`healthCheck`** — cheap liveness of the upstream. No credentials burned, no full page
  fetched.

## Responsibilities

1. Keep `normalize` pure and total — every raw payload maps to a normalized record or a
   validation error, never to a thrown exception.
2. Emit a stable deduplication key so the same posting from two sources reconciles.
3. Declare and honor the source's rate limit; back off on `429`/`503` with jitter.
4. Classify every upstream failure as retryable or terminal, matching the error taxonomy in
   `backend-service`.
5. Register in `connectors/core`'s registry — the only place a connector is named.
6. Record provenance on every record: `source_id`, `external_id`, `fetched_at`,
   `connector_version`, `source_url`.
7. Respect the source's terms of service and `robots.txt`. Document the legal basis in the
   connector's README.

## Workflow

1. Read `docs/architecture/connectors.md` and `docs/development/connector-guide.md`.
2. Check the source's ToS and rate limits. If scraping is disallowed, stop and say so.
3. Scaffold from `.claude/templates/connector.template.md`.
4. Capture real raw payloads into `tests/fixtures/connectors/<id>/` — normalize is tested
   against fixtures, never against the live API.
5. Implement `normalize` as a pure function, then `validate`, then `search`/`fetch`.
6. Define the dedup key and add it to the connector's README.
7. Add the retry/rate-limit policy via `connectors/core` helpers — never hand-rolled.
8. Register in the registry. Confirm `services/ingestion` needed **zero** edits.
9. Add config keys to `packages/config` namespaced `connectors.<id>.*`.
10. Write tests per `testing`: golden-file normalize tests, pagination test, a
    rate-limit/backoff test, and a `validate` rejection test.

## Retry, rate limiting, pagination

- **Retry** only what is retryable: network errors, `429`, `502`, `503`, `504`.
  Exponential backoff with full jitter, capped attempts, capped total time. Never retry a
  `400`, `401`, `403`, or `422` — those are bugs or auth problems, and retrying hides them.
- **Rate limit** client-side from `meta.rateLimit` so the platform is a good citizen even
  when the source would not stop us. Honor `Retry-After` when present.
- **Pagination** is cursor-based in the contract even when the source uses offsets — the
  connector translates. A cursor must be resumable after a crash.
- **Circuit break** per source: repeated terminal failures open the breaker, `healthCheck`
  closes it. One dead source must not stall the ingestion run.

## Deduplication

The key is derived, stable, and documented per connector:

```text
dedupKey = sha256(normalize(company) + '|' + normalize(title) + '|' + normalize(location) + '|' + coarse(postedAt))
```

Where `normalize()` here means casefold, strip punctuation, collapse whitespace, and map
known aliases (`Google LLC` → `google`) via the knowledge engine's company registry.
Reconciliation across sources is the knowledge engine's job; producing a comparable key is
the connector's.

## Constraints

- **No source-specific logic outside `connectors/<kind>/<id>/`.** Not in ingestion, not in
  matching, not in a shared util with an `if (source === ...)`.
- **No I/O in `normalize`.** No DB, no HTTP, no `Date.now()`, no `Math.random()`.
- **No persistence in a connector.** Connectors return data; they never write to the DB or
  the vector store.
- **No credential in code or fixture.** `packages/config` only.
- **No connector importing another connector.**
- **No silent data invention.** A field the source does not provide is `null`, never a
  guess, never a default that reads as fact.
- **No ToS violation, no bypassing rate limits, no scraping behind a login wall.**
- **No `meta.id` reuse or rename** — it is a foreign key in the database.

## Examples

**Bad — impure normalize that invents data.**

```typescript
normalize(raw: GreenhouseJob): JobPosting {
  return {
    title: raw.title,
    isRemote: raw.location?.name?.includes('Remote') ?? false,
    salaryMin: raw.salary_min ?? 60000,          // invented
    postedAt: new Date(),                        // clock in a pure function
    company: await this.companies.find(raw.org),  // I/O in normalize
  };
}
```

**Good.**

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
    salaryMax:   raw.salary_max ?? null,
    currency:    raw.salary_currency ?? null,
    postedAt:    raw.updated_at ? new Date(raw.updated_at) : null,
    sourceUrl:   raw.absolute_url,
    raw,                                              // kept for provenance
  };
}
```

Company resolution happens later, in the knowledge engine, where the alias registry lives.

## Best Practices

- Write `normalize` against three real payloads before writing `search`. The shape of the
  data decides the shape of the connector.
- Keep the raw payload. Storage is cheap; re-fetching history is impossible.
- Prefer an official API over HTML scraping even when the API covers less — coverage you can
  rely on beats coverage that breaks weekly.
- Treat `reliability` as observed, not declared: derive it from validation pass rate and
  outcome feedback (`knowledge-engine/outcomes`).
- Version the connector when `normalize` output changes for the same input. Downstream needs
  to know why a record changed.
- A connector that needs a new field on the Zentavio type is an `architecture` conversation
  (`packages/types` change), not a local cast.
