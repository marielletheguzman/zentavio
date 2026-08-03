# ADR 0003: Python for AI Services

> **Purpose:** Why AI/ML services use Python/FastAPI.

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** `ai/*`, `packages/types`, `services/matching`, `services/api-gateway`, `infra/docker`, `infra/ci`

## Context

Zentavio is a TypeScript monorepo (ADR-0001). Everything under `services/` is NestJS, everything
under `apps/` is Next.js, and shared contracts live in `packages/types`. Adding a second language
costs real money: two toolchains, two CI paths, two dependency ecosystems, duplicated types, and a
serialization boundary that must be maintained forever.

Against that, the AI layer's work is not "call an LLM and return the text". It is embedding
generation and vector math, resume parsing from PDF and DOCX, tokenization, text normalization,
evaluation harnesses over prompt datasets, and eventually calibration and outcome modeling over
recorded results. That work has a mature, first-class library ecosystem in exactly one language.

The tension is concrete: a single-language codebase is cheaper to operate, but the AI layer is the
product's core differentiator, and the libraries it depends on are Python-first with TypeScript
ports that lag in features, quality, and maintenance. Choosing TypeScript everywhere means the
most important layer is built on the weakest available tooling.

A separate constraint from `CLAUDE.md`: `ai/` must be **stateless** and the model must be
**replaceable**. Whatever language it is, no LLM call may exist outside `ai/`.

## Options considered

### Option A — TypeScript everywhere, including AI services

**Pros.** One language, one toolchain, one CI path. `packages/types` is imported directly, so the
contract cannot drift — no JSON Schema, no code generation, no serialization boundary. Any
contributor can work anywhere in the tree. Turborepo covers the entire repository.

**Cons.** The document-parsing story is materially worse: PDF and DOCX extraction in Node is a
patchwork compared to what Python offers, and resume ingestion is a day-one feature. Embedding,
tokenization, and evaluation tooling are ports that trail their Python originals. Any future
calibration or outcome modeling — the long-term moat in
`.claude/context/business.md` — would be written against libraries that mostly do not exist. The
cost does not appear on day one; it appears at the exact moment the differentiating work starts,
which is the worst possible time to discover it.

### Option B — Python for `ai/`, TypeScript for everything else

**Pros.** The AI layer uses the ecosystem its work actually lives in: document parsing,
embeddings, tokenization, evaluation harnesses, numerical work. The language boundary lands
exactly on the architectural boundary that already exists — `ai/` is stateless, HTTP-facing, and
must be independently replaceable — so the split reinforces the layering rather than cutting
across it. FastAPI gives typed request/response models and generated OpenAPI, so the contract is
machine-checkable at the boundary. Model-runtime and ML libraries are first-class rather than
ported.

**Cons.** Two toolchains, permanently. `packages/types` cannot be imported by Python, so the
contract must be expressed as JSON Schema and mirrored on both sides — with real drift risk if
generation is not enforced. Two CI paths, two Docker base images, two dependency-audit surfaces.
A contributor touching a contract needs both environments. Turborepo does not manage the Python
tree (ADR-0001).

### Option C — Python everywhere

**Pros.** Single language, and the AI ecosystem is fully available.

**Cons.** Gives up Next.js, and therefore the entire frontend plan and Vercel deployment. NestJS's
structure and the TypeScript type system are what make the service layer's conventions enforceable.
Sharing types with the frontend would become the drift problem, moved to the layer that changes
most often. Strictly worse than Option B for this product.

### Option D — Do nothing: decide per service, later

**Pros.** No commitment now.

**Cons.** The polyglot boundary determines how `packages/types`, CI, Docker, and the service-to-AI
contract are built. Deferring means those are built assuming one language and then retrofitted —
and a retrofitted contract boundary is where drift lives permanently.

## Decision

All AI capability services under `ai/` are written in Python with FastAPI; every other runtime unit
is TypeScript, and the two communicate over HTTP using contracts defined as JSON Schema in
`packages/types`, from which both sides are generated or mirrored.

## Consequences

**Accepted costs.**

- Two toolchains forever: Node workspaces plus a Python dependency tool, two CI paths, two Docker
  base images, two vulnerability-audit surfaces.
- **The contract is the permanent risk.** TypeScript types and Pydantic models describing the
  same payload will drift unless generation is enforced in CI. This is the single most likely way
  this decision goes wrong.
- No compile-time checking across the boundary. A field renamed on one side surfaces as a runtime
  validation error, so the boundary needs contract tests, not just unit tests.
- Cross-boundary work requires both environments installed. Onboarding is heavier.
- Serialization overhead on every AI call, and an extra network hop where an in-process call would
  otherwise do. Acceptable because AI calls are already the slowest thing in any request path —
  and this is precisely why `.claude/skills/backend-service/SKILL.md` forbids a synchronous
  `ai/*` call on a user-facing request path unless the endpoint is documented as long-running.

**Follow-up work.**

- Define the JSON Schema source of truth in `packages/types`, with generation to TypeScript types
  and to Pydantic models. Neither side hand-writes the other's shapes.
- Add a CI check failing when generated types are out of date relative to the schema. Without it,
  the primary risk of this ADR is unmitigated.
- ~~Add contract tests exercising the real HTTP boundary against fixtures, in both directions.~~
  **Done** — `ai/resume-parser/tests/test_contract.py` writes the fixtures from the live app and
  `packages/types/src/contracts.test.ts` validates them against the hand-written TypeScript types,
  so a change on either side fails a test in the same pull request. It is the interim guard until
  the JSON Schema item above lands, not a replacement for it.
- ~~Establish the Python dependency and lint toolchain for `ai/`.~~ **Done** — Ruff for lint and
  format (ADR-0005), uv workspace for dependencies (ADR-0006).
- ~~Standardize FastAPI service structure: health endpoints, error envelope matching
  `.claude/skills/backend-service/SKILL.md`.~~ **Done** — `ai/resume-parser` and `ai/skill-gap`
  both expose `/health/live` and `/health/ready` and return the shared envelope, including from a
  middleware that catches anything unhandled: a traceback reaching the client is the likeliest way
  résumé content escapes.
- **Still open: structured logging with the same correlation id propagated across the boundary.**
  Blocked on `packages/logger` (ADR-0008), which does not exist.
- Confirm no state: `ai/*` services own no tables and no cache of record.

**Reversal cost.** Per service, moderate: porting one Python service to TypeScript means finding
replacements for its libraries, which is the whole reason for the decision. Reversing the *policy*
is expensive but mechanical, and it becomes cheaper as the Node ML ecosystem matures. The signal to
revisit: the Python libraries in use no longer offer a meaningful advantage over their Node
equivalents, while the contract-drift tax keeps being paid.

## Compliance

- **Language boundary:** nothing under `ai/` is TypeScript; nothing outside `ai/` imports a model
  or LLM SDK. The LLM SDK ban is `no-restricted-imports` in `eslint.config.mjs` (which ignores
  `ai/` entirely); the file-extension check under `ai/` is still outstanding.
- **Contract generation check:** CI regenerates types from `packages/types` schemas and fails if
  the working tree changes. This is the enforcement that keeps the decision honest.
- **Contract tests:** each `ai/*` service has a test asserting its FastAPI request/response models
  match the shared schema, and each TypeScript consumer has one asserting the same.
- **Statelessness check:** `ruff.toml` bans importing `sqlalchemy`, `psycopg`, `psycopg2`,
  `asyncpg`, `alembic`, `redis`, `qdrant_client`, and `boto3` anywhere under `ai/`, so an AI
  service that opens a store fails `ruff check ai/`. A reviewer additionally verifies each `ai/*`
  service can run with `services/` and `packages/db` unavailable.
- **Import direction:** `ai/` must not import from `services/` or `apps/` — covered by the
  dependency-direction lint rule from ADR-0001.

## Related

- ADR-0001 (monorepo), ADR-0004 (vector store choice)
- `.claude/skills/architecture/SKILL.md` — the TypeScript↔Python contract rule
- `.claude/skills/ai-matching/SKILL.md`, `.claude/skills/prompt-engineering/SKILL.md`
- `.claude/context/ai-principles.md`, `.claude/context/tech-stack.md`
- `docs/architecture/ai-services.md`, `docs/development/ai-service-guide.md`
