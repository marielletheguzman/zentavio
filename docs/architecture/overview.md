# Architecture Overview

> **Purpose:** System purpose, high-level component map, and non-goals (NOT a job board).

## What the system is for

Zentavio answers one question with evidence: **"what should I do next?"** — for a professional
deciding where they can work, what they would have to become to get there, and whether it is worth
it.

That framing, not a feature list, is what the architecture serves. A system that answers it must
hold facts separately from judgments about facts, must be able to say "I don't know" without
degrading, and must grow to new countries and sources by adding data rather than editing code.
Every boundary below exists for one of those three reasons.

## Non-goals

Stated first, because each one is a shape the system could easily drift into:

- **Not a job board.** A job board's product is listings and its architecture optimizes retrieval.
  Zentavio's product is judgment, so the substrate is a knowledge graph rather than a search index.
  Postings are one input among many, not the centre.
- **Not a keyword matcher.** Fit is computed from a skill graph with weighted transfer edges, never
  from string overlap between a resume and a posting.
- **Not a chatbot over an LLM's memory.** The model reasons over retrieved facts and never supplies
  them.
- **Not a course marketplace.** Learning paths close a measured gap; they do not sell a catalogue.
- **Not a source of confident answers we cannot cite.** Immigration and salary claims come from
  tier-1 sources or are reported as unknown.

## Component map

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ apps/         web · admin · mobile          (Next.js, React, Tailwind)   │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ HTTPS — the only way in
┌───────────────────────────────▼──────────────────────────────────────────┐
│ services/     api-gateway  ── auth, routing, rate limits, response shape │
│               matching · ingestion · notifications · billing   (NestJS)  │
└──────┬──────────────────────────────────────┬────────────────────────────┘
       │                                      │ HTTP, contracts from packages/types
┌──────▼───────────────────────────┐   ┌──────▼────────────────────────────┐
│ knowledge-engine/                │   │ ai/            (Python, FastAPI)  │
│   skills-graph · companies       │◄──┤   resume-parser · skill-gap       │
│   immigration · market-intel     │   │   career-roadmap · learning-paths │
│   interview-reports · outcomes   │   │   interview-prep · embeddings     │
│   vector-store · ingest          │   │   STATELESS — owns no store       │
│   FACTS, versioned, with sources │   │   JUDGMENTS about those facts     │
└──────┬───────────────────────────┘   └───────────────────────────────────┘
       │                                              ▲
       │ normalized records + provenance              │ Ollama (Qwen, Gemma)
┌──────┴───────────────────────────┐                  │ the only layer that
│ connectors/   core (registry)    │                  │ talks to a model
│   job-boards · salary-data       │
│   company-data · immigration-data│
│   learning-resources · market    │
│   PLUGINS — persist nothing      │
└──────┬───────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────────────────┐
│ PostgreSQL (system of record) · Redis (cache, events) · Qdrant (index)   │
│ substrate — underneath everything, not a layer below AI                  │
└──────────────────────────────────────────────────────────────────────────┘

packages/   types · db · auth · events · config · logger · i18n · ui
            shared libraries; import from none of the above
```

## What each component owns

| Component | Owns | Never does |
|---|---|---|
| `apps/*` | presentation, interaction, rendering evidence | call `ai/`, a connector, or the database directly |
| `services/api-gateway` | auth, authorization, routing, rate limits, response shaping | business logic |
| `services/*` | use cases, orchestration, their own tables | call a model; write another service's tables |
| `knowledge-engine/*` | facts, versions, provenance, graphs, reconciliation | make judgments |
| `ai/*` | judgment, scoring, generation, explanation | own state; invent facts |
| `connectors/*` | one external source, behind a five-method contract | persist anything; know about each other |
| `packages/*` | shared contracts and libraries | import from apps, services, ai, or connectors |

## The four boundaries that matter

Everything else in `docs/architecture/` elaborates these.

**1. Dependencies point inward.** `apps` → `services` → `knowledge-engine` → `packages/types`.
`ai/` and `knowledge-engine/` must run with `services/` and `apps/` deleted. Enforced by
`eslint.config.mjs` (ADR-0005), not by convention.

**2. Facts and judgments are separate layers.** If it is a fact, it belongs to the knowledge engine;
if it is a judgment about facts, it belongs to `ai/`. A judgment persisted as a fact corrupts every
answer downstream, because the next reasoning step will cite it as truth.

**3. Sources are plugins.** Adding a data source is one folder plus one registry line.
`services/ingestion` never learns a source's name (ADR-0002).

**4. The model is replaceable.** No LLM call exists outside `ai/`. Nothing else knows which model
answered, which is what makes swapping one a configuration change instead of a refactor (ADR-0003).

## How a request flows

**Reading — "am I ready for cloud engineering in Germany?"**

```text
apps/web  →  api-gateway (authenticate, rate limit)
          →  services/matching (orchestrate)
          →  knowledge-engine (retrieve profile facts, requirements, DE rules — with provenance)
          →  ai/career-roadmap (compute readiness + gap; LLM writes prose from computed evidence)
          →  response: value + confidence + evidence + versions
          →  apps/web renders the number beside its reasons
```

The score is arithmetic over retrieved facts. The model contributes structure and explanation, never
the number — that is what makes it reproducible from `scorerVersion` and `knowledgeAsOf`.

**Writing — ingestion**

```text
scheduler  →  services/ingestion iterates the connector registry
           →  connector.search() → raw payloads (untouched)
           →  connector.normalize() → normalized records (pure function)
           →  connector.validate() → accept | flag | quarantine-with-reason
           →  knowledge-engine reconciles by dedup key (highest source tier wins)
           →  facts + raw payloads persisted with provenance
           →  event `job.posting.normalized.v1`
```

## Communication

| Between | Mechanism |
|---|---|
| Frontend → backend | HTTPS through `services/api-gateway`, only |
| Service → service | HTTP through the gateway, or a versioned event on Redis |
| Service → AI | HTTP to a FastAPI service; contract is JSON Schema in `packages/types` |
| Ingestion → downstream | versioned events (`job.posting.normalized.v1`) |
| Anything → storage | its own repository; never another service's tables |

No shared mutable state between services. Event names are permanent — namespace, noun, past-tense
verb, version. Never renamed; a `v2` is published alongside and `v1` retired.

## Current state

A documentation-first skeleton. No application code exists yet; the directory tree, the ADRs, the
skill ecosystem, and the boundary enforcement in `eslint.config.mjs` and `ruff.toml` are
established first so that every feature inherits them. See `docs/roadmap/phases.md` for the
sequence and `docs/development/ci-cd.md` for what CI already enforces.

## Related

- `principles.md` — the tenets behind these boundaries
- `system-diagram.md`, `data-flow.md` — the detail behind the two flows above
- `knowledge-engine.md`, `ai-services.md`, `connectors.md`, `immigration.md`
- `security.md`, `privacy.md`
- ADRs 0001–0006 in `decisions/` — binding once Accepted
- `.claude/context/architecture.md` — the in-session summary of this document
