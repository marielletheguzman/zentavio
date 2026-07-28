# Architecture

> **Canonical documents:** [`docs/architecture/overview.md`](../../docs/architecture/overview.md),
> `principles.md`, `system-diagram.md`, `data-flow.md`. The procedural rules live in the
> `architecture` skill. This file is the shape of the system, high level, no implementation.

## The flow

```text
Frontend            apps/web · apps/admin · apps/mobile
   ↓ HTTP (only path in)
Backend API         services/api-gateway → services/matching · ingestion · notifications · billing
   ↓
Knowledge Engine    knowledge-engine/  — the only interface to structured truth
   ↓
AI Services         ai/  (stateless, Python) — reason over facts, never store them
   ↓
Database            PostgreSQL · Redis · Qdrant   (substrate, underneath everything)
   ↑
Connector Plugins   connectors/  — produce raw facts, own no persistence
```

Read as: connectors produce raw facts → ingestion normalizes and persists them → the
knowledge engine is the only source of structured truth → AI services reason over it → the
gateway is the only thing the frontend talks to. Storage sits under all of it; it is a
substrate, not a bottom layer.

## Responsibilities

| Layer | Owns | Never does |
|---|---|---|
| **Frontend** | presentation, interaction, rendering evidence | call `ai/`, a connector, or the DB directly |
| **API Gateway** | auth, authorization, routing, rate limits, response shaping | business logic |
| **Services** | use cases, orchestration, persistence of their own tables | call a model; write another service's tables |
| **Knowledge Engine** | facts, versions, provenance, graphs, reconciliation | make judgments |
| **AI Services** | judgment, scoring, generation, explanation | own state; invent facts |
| **Connectors** | one external source, `search`/`fetch`/`normalize`/`validate`/`healthCheck` | persist; know about each other |
| **Packages** | shared contracts and libraries | import from services, apps, ai, or connectors |

## Boundaries

- **Dependency direction is one-way inward:** `apps` → `services` → `ai` / `knowledge-engine`
  → `packages/types`. `ai/` must still run with `services/` deleted.
- **The connector boundary is absolute.** Adding a source = one folder + one registry line.
  `services/ingestion` never learns a source's name.
- **The model boundary is absolute.** No LLM call outside `ai/`. That is what makes the model
  replaceable.
- **The fact/judgment boundary is absolute.** Facts belong to the knowledge engine; judgments
  about facts belong to `ai/`. If it is a fact, it is knowledge; if it is a judgment about
  facts, it is AI.

## Communication

| Between | Mechanism |
|---|---|
| Frontend → backend | HTTP through `services/api-gateway`, only |
| Service → service | HTTP through the gateway, or a versioned event on Redis |
| Service → AI | HTTP to a `ai/*` FastAPI service, contract from `packages/types` |
| Ingestion → everything downstream | versioned events (`job.posting.normalized.v1`) |
| Anything → storage | its own repository; never another service's tables |

No shared mutable state between services. Event names are permanent: namespace, noun,
past-tense verb, version. Never rename — publish `v2` alongside and retire `v1`.

## Related

- `tech-stack.md` — what each layer is built with
- `decisions.md` — the ADRs that fixed these boundaries
- Skills: `architecture` (the enforceable rules), `backend-service`, `connectors`,
  `knowledge-engine`, `database`, `frontend`
