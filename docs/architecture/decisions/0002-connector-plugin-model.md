# ADR 0002: Connector Plugin Model

> **Purpose:** Why job sources are plugins behind a common interface.

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** `connectors/`, `connectors/core`, `services/ingestion`, `knowledge-engine/ingest`, `packages/types`

## Context

Zentavio's value grows with coverage: more job boards, more salary sources, more immigration
portals, more learning-resource providers, more countries. Coverage growth is not a phase — it is
the permanent condition of the product.

Every source differs in ways that cannot be abstracted away: auth, pagination (offset, cursor,
page token, none), rate limits, field names, date formats, location encodings, salary conventions,
failure modes. Some have real APIs, some have feeds, some have nothing but HTML.

The tension: the **ingestion pipeline** must be uniform and boring — schedule, validate,
deduplicate, reconcile, persist, identically for every source — while the **per-source logic** is
irreducibly messy. If the two mix, the messiness spreads into the pipeline and every new source
edits shared code. That is the point at which adding coverage stops being cheap and starts being
risky, and the cost of the next source begins to rise with the coverage already present — exactly
backwards for this product.

A reliability constraint applies too: sources fail independently and often. One board changing its
HTML must not stop ingestion of the other nineteen.

## Options considered

### Option A — Direct integration per source, called from the ingestion service

Each source gets a module, and `services/ingestion` calls each with whatever shape it needs.

**Pros.** Fastest path for source one. No contract to design, no abstraction to fit. Each
integration does exactly what its source needs with no ceremony.

**Cons.** By source ten, `services/ingestion` is a switch statement. The pattern is
`if (source === 'linkedin') { payload = unwrapLinkedInEnvelope(payload); }` in the pipeline, then
in normalization, then in the scheduler. Every new source changes shared code, so every new source
can break existing ones. No uniform home for retries, rate limits, or health checks, so each
integration reinvents them badly. Testing a mapping requires booting the pipeline.

### Option B — One shared scraper/parser driven by per-source configuration

A generic engine with declarative config: selectors, field mappings, endpoints.

**Pros.** Adding a well-behaved source is genuinely just data. Uniform operational behavior for
free. Very compact across a set of similar sources.

**Cons.** The configuration language becomes a programming language the moment a source needs
conditional logic — and one does, within the first five. Then it is a bad programming language
with no type checking, no tests, and no debugger. Sources that do not fit the engine's assumptions
cannot be onboarded at all, so coverage is capped by the engine's imagination. One engine means
one blast radius: a change for source three breaks source seven's parsing in a way nobody notices
until data quality drifts. Its worst property is that the engine's generality must be decided
before the sources are known.

### Option C — Plugin contract with a registry

Each source implements a fixed interface (`search` / `fetch` / `normalize` / `validate` /
`healthCheck`), registered in `connectors/core`. The pipeline iterates the registry.

**Pros.** Adding a source is additive: one folder plus one registry line, zero edits to
`services/ingestion`. Per-source messiness is contained in its own folder, where it is allowed.
`normalize` as a pure function is testable against captured fixtures with exact golden-file
assertions — no network, no pipeline. Failures isolate naturally: per-source circuit breaking,
rate limiting, and reliability live in shared `core` helpers. The interface is real code, so it
type-checks, and a connector can do anything it needs inside it.

**Cons.** The contract must be designed before the sources are well understood, and a bad contract
is expensive — connectors then work *around* it rather than implement it. Five methods is real
ceremony for a source with one endpoint. Purity in `normalize` (no clock, no I/O, no randomness)
must be enforced, not assumed, and it pushes entity resolution downstream into the knowledge
engine — a design consequence, not a convenience.

### Option D — Do nothing: integrate sources ad hoc as each is needed

**Pros.** No design work now.

**Cons.** This is Option A reached by drift rather than by choice, with the extra property that no
two integrations look alike. The plugin boundary is load-bearing for the ingestion design and for
the "connectors are plugins" principle in `CLAUDE.md`; leaving it undecided means it decays into
Option A before source five.

## Decision

Every external data source is a plugin under `connectors/<kind>/<id>/` implementing the
`Connector` interface from `connectors/core`, registered in the `connectors/core` registry;
`services/ingestion` iterates the registry and never references a source by name.

## Consequences

**Accepted costs.**

- Five methods is overhead for a trivial source. Accepted: uniformity is worth more at source
  twenty than it costs at source one.
- The contract will need to change as sources teach us what it is missing. Contract changes touch
  every connector, so they are versioned and deliberate. A connector working around the contract
  is a signal to change the contract, not to cast.
- `normalize` purity means a connector cannot resolve a company or canonicalize a location — it
  has no I/O. Entity resolution therefore lives in the knowledge engine, which is the right home
  for it anyway, since the alias registry is there.
- A genuinely cross-source feature cannot be a shared code path; it becomes a knowledge-engine
  reconciliation step.
- Captured fixtures must be maintained. A source changing shape means a new fixture, and stale
  fixtures give false confidence.

**Follow-up work.**

- Define `Connector<TRaw, TNormalized>` and `ConnectorMeta` in `connectors/core`, with
  `SearchQuery`, `Page`, `Cursor`, `ValidationResult`, `HealthStatus`.
- Implement shared `core` helpers: rate limiter, retry with full jitter, per-source circuit
  breaker, cursor persistence. Hand-rolled retry logic inside a connector is a defect.
- Build the registry and the `connectors.<id>.*` config namespace in `packages/config`.
- Write two connectors of different shapes — an ATS feed and a board — before finalizing the
  contract. One connector cannot validate an abstraction.
- Define the dedup-key derivation convention; document it per connector.
- Add the lint rule forbidding connector imports outside the registry.

**Reversal cost.** High, deliberately. Unwinding means inlining every connector's logic into the
pipeline: days per connector, plus the loss of per-source isolation. The signal that would justify
revisiting is a contract every connector works around rather than implements — which is a signal
to fix the contract first.

## Compliance

- **Lint rule:** in `eslint.config.mjs`, the `service` element may depend on `connector-core` but
  not on `connector`, and `connector` may not depend on `connector`. So `import { greenhouse }`
  inside `services/` is a build error, not a review comment, and no connector can import another.
  Mechanism: ADR-0005.
- **Grep check:** no source id string literal appears anywhere under `services/ingestion`.
- **Purity test:** each connector's `normalize` is called twice with the same fixture and must
  return identical results, with network and clock access stubbed to throw.
- **Golden-file tests:** `normalize(fixture)` equals the committed expected record exactly, with
  absent source fields as `null` — see `.claude/skills/testing/SKILL.md`.
- **The additive test:** adding a connector produces a diff touching only
  `connectors/<kind>/<id>/`, the registry, `packages/config`, and tests. Any other file in that
  diff means this ADR was violated.

## Related

- ADR-0001 (monorepo)
- `.claude/skills/connectors/SKILL.md` — the contract and its rules
- `.claude/skills/job-aggregation/SKILL.md` — the pipeline that iterates the registry
- `docs/architecture/connectors.md`, `docs/development/connector-guide.md`
- `.claude/templates/connector.template.md`
