/**
 * `connectors/core` — the connector SDK (ADR-0002).
 *
 * The contract every source implements, the registry that is the only module allowed to name a
 * connector, and the shared operational behaviour — retry, rate limiting, error taxonomy — that
 * is never hand-rolled per source. A retry policy that differs by connector is a policy nobody
 * can reason about during an incident.
 *
 * See `docs/architecture/connectors.md` for the design and
 * `docs/development/connector-guide.md` for the step-by-step.
 */

export type {
  ArchivableSource,
  DerivedSource,
  Connector,
  ConnectorKind,
  ConnectorMeta,
  ConnectorRegistrationInput,
  Cursor,
  HealthState,
  HealthStatus,
  Page,
  RateLimitSpec,
  SearchQuery,
  ValidationIssue,
  ValidationResult,
} from './contract.ts';
export { isIngestible, toRegistration } from './contract.ts';

export type { ConnectorErrorOptions, FailureKind } from './errors.ts';
export { ConnectorError, kindForStatus, parseRetryAfter } from './errors.ts';

export type { RetryDeps, RetryPolicy } from './retry.ts';
export { DEFAULT_RETRY_POLICY, backoffMs, realRetryDeps, withRetry } from './retry.ts';

export type { LimiterDeps } from './rate-limit.ts';
export { RateLimiter, realLimiterDeps } from './rate-limit.ts';

export type { AnyConnector } from './registry.ts';
export { ConnectorRegistry, DuplicateConnectorError, UnknownConnectorError } from './registry.ts';
