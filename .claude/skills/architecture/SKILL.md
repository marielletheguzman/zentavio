---
name: architecture
description: Zentavio's system architecture rules — Clean Architecture layering, SOLID, the plugin/connector boundary, event-driven flow, and the TypeScript/Python polyglot contract. Load when creating or moving modules, adding a service under services/, wiring dependencies between packages, designing cross-service communication, touching infra/, writing an ADR, or whenever a change crosses a directory boundary in the monorepo.
---

# Architecture

## Purpose

Keep Zentavio's dependency direction correct for the lifetime of the project. Every other
quality — testability, replaceability of the LLM, adding a country or a job source without
a rewrite — is downstream of layering. This skill is the arbiter when a change would let an
inner layer learn about an outer one.

## Scope

**Applies to:** module placement, cross-package imports, service boundaries, event contracts,
the connector plugin boundary, `infra/`, and all ADRs.

**Does not apply to:** intra-service code style (`backend-service`), schema design
(`database`), component structure (`frontend`), knowledge modeling (`knowledge-engine`).

## The actual layer model

The one-way flow is:

```text
Connectors (plugins)  ──►  services/ingestion  ──►  Knowledge Engine
                                                          │
apps/web ─► services/api-gateway ─► services/matching ─────┤
                                    ai/* (Python)  ────────┘
                                          │
                      PostgreSQL · Redis · Qdrant  (substrate, not a layer)
```

Read it as: connectors produce raw facts, ingestion normalizes and persists them, the
knowledge engine is the only interface to structured truth, AI services reason over it,
and the API gateway is the only thing the frontend talks to. Storage is underneath
everything — it is never "a layer below AI".

**Dependency rule.** Source code dependencies point inward only:
`apps` → `services` → `ai` / `knowledge-engine` → `packages/types`.
Nothing in `knowledge-engine/` or `ai/` may import from `services/` or `apps/`.
Nothing may import from a connector directly except the connector registry.

## Responsibilities

1. Enforce that a new capability lands in exactly one layer, and say which.
2. Reject any import that reverses the dependency rule; propose the inversion instead
   (interface in the inner layer, implementation injected from the outer).
3. Keep `services/ingestion` free of source-specific logic. Adding a source must be a
   registry entry plus a connector folder — nothing else.
4. Keep `ai/` stateless. AI services own no tables and no cache of record.
5. Define the contract whenever TypeScript and Python meet. Never let a Python service
   reverse-engineer a TypeScript type.
6. Require an ADR for any new dependency, datastore, transport, or framework.

## Workflow

1. Read `docs/architecture/overview.md` and `docs/architecture/principles.md`.
2. Identify which layer the change belongs to. If it seems to belong to two, it is two
   changes — split it.
3. Check the dependency direction of every new import. Reversal means you need an
   interface, not an exception.
4. If the change crosses TypeScript↔Python, define or update the JSON Schema contract in
   `packages/types` **first**, then generate/mirror both sides from it.
5. If the change is asynchronous, define the event in `packages/events` with a versioned
   name before any publisher or consumer is written.
6. If a tradeoff was made, write the ADR from `.claude/templates/ADR.template.md` into
   `docs/architecture/decisions/` in the same change.
7. Update `docs/architecture/system-diagram.md` if the flow changed.

## Constraints

- **No inward-pointing knowledge of outer layers.** `ai/` must run with `services/` deleted.
- **No connector imported outside the registry.** `import { greenhouse }` anywhere in
  `services/` is a defect.
- **No shared mutable state between services.** Communication is HTTP through the gateway
  or an event on Redis. Never a shared table written by two services.
- **No business logic in `services/api-gateway`.** It authenticates, authorizes, routes,
  rate-limits, and shapes responses. Nothing else.
- **No LLM call outside `ai/`.** The gateway, matching service, and frontend never talk to
  Ollama directly. This is what makes the model replaceable.
- **No new framework, datastore, queue, or heavyweight dependency without an ADR.**
- **`packages/*` must not import from `services/*`, `ai/*`, `apps/*`, or `connectors/*`.**

## Dependencies

- `docs/architecture/overview.md`, `principles.md`, `system-diagram.md`, `data-flow.md`
- `docs/architecture/decisions/` — binding once Accepted
- `docs/development/conventions.md`
- `eslint.config.mjs` — the executable form of the layer model above (ADR-0005). The
  `boundaries/element-types` rule block and the layer table in this skill must state the same
  thing; if they diverge, one of them is a bug. `ruff.toml` covers `ai/`.
- Skills: `backend-service`, `connectors`, `database`, `knowledge-engine`

## Examples

**Bad — outer layer leaking inward.**

```typescript
// ai/skill-gap/src/analyze.ts
import { JobPostingRepository } from '../../../services/matching/src/repositories';
```
`ai/` now cannot run without `services/`. The LLM layer is welded to a service.

**Good — dependency inversion.**

```typescript
// ai/shared/ports/knowledge.port.ts   (inner layer declares what it needs)
export interface SkillGraphPort {
  getRelatedSkills(skillId: string): Promise<SkillEdge[]>;
}

// services/matching/src/adapters/skill-graph.adapter.ts   (outer layer supplies it)
@Injectable()
export class SkillGraphAdapter implements SkillGraphPort { /* ... */ }
```

**Bad — source-specific logic in ingestion.**

```typescript
if (source === 'linkedin') { payload = unwrapLinkedInEnvelope(payload); }
```
That unwrapping belongs in `connectors/job-boards/linkedin/src/normalize.ts`.

## Best Practices

- Prefer a boring seam over a clever abstraction. One interface at the layer boundary beats
  three at the call site.
- A module that is hard to test almost always has a layering defect, not a testing defect.
- When unsure whether something is `knowledge-engine` or `ai`: if it is a fact, it is
  knowledge; if it is a judgment about facts, it is AI.
- Event names are permanent. `job.posting.normalized.v1` — namespace, noun, past-tense
  verb, version. Never rename; publish v2 alongside and retire v1.
- The monorepo's directory tree is the architecture diagram. If a file feels homeless, the
  architecture is missing a concept — surface that instead of picking the nearest folder.
