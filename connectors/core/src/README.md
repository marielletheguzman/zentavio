# src

> **Purpose:** Core connector source: contract, normalization types, discovery/loading.

| Module | Holds |
|---|---|
| `contract.ts` | the `Connector` interface and every type it names |
| `registry.ts` | `ConnectorRegistry` — the only module permitted to reference a connector |
| `errors.ts` | `ConnectorError`, the retryable/terminal taxonomy, `Retry-After` parsing |
| `retry.ts` | `withRetry` — exponential backoff, full jitter, capped by attempts and total time |
| `rate-limit.ts` | `RateLimiter` — sliding window budget plus minimum interval |
| `index.ts` | the public surface; a connector imports from here, never from a module directly |

Design rationale is in [`../README.md`](../README.md). Nothing here does I/O against a real source:
`retry.ts` and `rate-limit.ts` take their clock, sleep, and randomness as injected dependencies, so
their tests assert the schedule the policy chose rather than measuring wall-clock time.
