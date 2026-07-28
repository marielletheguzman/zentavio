# Connector: <source-name>

> Scaffold for `connectors/<domain>/<source-name>/`. Every connector implements the same
> five methods so `services/ingestion` never learns source-specific logic.

## Required structure

```text
connectors/<domain>/<source-name>/
├── README.md            # Purpose, auth model, rate limits, known quirks
├── src/
│   ├── index.ts         # Exports the connector object only
│   ├── client.ts        # Raw HTTP against the source. No normalization here.
│   ├── normalize.ts     # Source payload -> packages/types canonical shape
│   ├── validate.ts      # Zod schemas, inbound and outbound
│   └── config.ts        # Rate limits, retry policy, endpoints, version
└── tests/
    ├── normalize.test.ts
    └── fixtures/        # Real captured payloads, secrets scrubbed
```

## Required interface

```typescript
export interface Connector<TRaw, TCanonical> {
  readonly id: string;              // stable, kebab-case, never reused
  readonly domain: ConnectorDomain; // job-boards | salary-data | company-data | ...
  readonly version: string;         // semver; bump on breaking normalize() change
  readonly reliability: ReliabilityTier;

  search(query: SearchQuery, ctx: ConnectorContext): Promise<Page<TRaw>>;
  fetch(ref: SourceRef, ctx: ConnectorContext): Promise<TRaw>;
  normalize(raw: TRaw): TCanonical;
  validate(candidate: unknown): ValidationResult<TCanonical>;
  healthCheck(ctx: ConnectorContext): Promise<HealthReport>;
}
```

## Required config

```typescript
export const config: ConnectorConfig = {
  rateLimit:  { requests: 60, per: 'minute', strategy: 'token-bucket' },
  retry:      { attempts: 3, backoff: 'exponential', baseMs: 500, jitter: true,
                retryOn: [429, 502, 503, 504] },
  timeout:    { requestMs: 10_000, totalMs: 45_000 },
  circuit:    { failureThreshold: 5, resetAfterMs: 60_000 },
  freshness:  { staleAfterMs: 6 * 60 * 60 * 1000 },
};
```

## README checklist

- [ ] Auth model and where credentials come from (never inline)
- [ ] Documented rate limits and the source's actual observed limits
- [ ] Pagination style (cursor / offset / page token) and its ceiling
- [ ] Fields the source does **not** provide, and what `normalize()` leaves null
- [ ] Terms-of-service position on automated access
- [ ] Reliability tier and why
