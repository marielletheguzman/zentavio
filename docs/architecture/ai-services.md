# AI Services

> **Purpose:** Matching, skill-gap, learning-paths, interview-prep, resume-parser service boundaries.

`ai/` holds the reasoning layer: Python, FastAPI, **stateless**, one service per capability. These
services turn facts into judgments and explain the result. They never hold facts of their own.

## What is true of every service here

1. **Stateless.** No tables, no cache of record, no migrations. Enforced by `ruff.toml`, which bans
   importing `sqlalchemy`, `psycopg`, `asyncpg`, `alembic`, `redis`, `qdrant_client`, and `boto3`
   anywhere under `ai/` (ADR-0003, ADR-0005). State lives in `packages/db` and `knowledge-engine/`.
2. **Grounded.** Facts arrive by retrieval from `knowledge-engine`. The model never supplies a fact
   about a company, salary, visa, or requirement (`.claude/context/ai-principles.md`).
3. **The number is code, the prose is the model.** Scores are arithmetic over retrieved facts. An
   LLM-produced score is not reproducible, not calibratable, and not defensible.
4. **Explained.** Every output carries `evidence` whose weights reconcile to the score, plus
   `confidence`, `scorerVersion`, `promptVersion`, `knowledgeAsOf`, `computedAt`.
5. **Honest when empty.** Missing knowledge returns `status: "unknown"` with `missing` populated —
   never a default, never a plausible value.
6. **Behind HTTP.** Contracts are JSON Schema in `packages/types`, generating both the TypeScript types
   and the Pydantic models. Neither side hand-writes the other's shapes (ADR-0003).
7. **Model-agnostic.** Only `ai/` talks to Ollama. Nothing outside knows which model answered, which is
   what makes swapping one a configuration change.

## The services

| Service | Answers | Reads | Owns |
|---|---|---|---|
| `resume-parser` | what does this document say? | the uploaded file | extraction to a structured profile, with source spans |
| `skill-gap` | what is missing for this target? | profile facts, requirement facts, skill graph | the weighted, dependency-ordered gap |
| `career-roadmap` | where can I realistically go, and how far am I? | career graph, skill graph, market intel, eligibility | transferability, readiness, transition cost, viability |
| `learning-paths` | what should I learn, in what order? | gap, `requires` edges, learning resources | ordered steps, effort and elapsed estimates, verification |
| `interview-prep` | what will they ask, and am I ready? | interview reports, company facts, requirement facts | process model, practice, interview readiness |
| `embeddings` | what is semantically near this? | text to embed | vector generation; writes go through the knowledge engine's port |
| `shared` | — | — | ports, error envelope, logging, prompt loading, output contract |

### Boundaries between them

The services compose in one direction, and each hands off a typed artifact:

```text
resume-parser ──► profile facts
                      │
                      ▼
                 skill-gap ──► weighted, ordered gap
                      │              │
                      ▼              ▼
              career-roadmap    learning-paths ──► plan
                      │
                      ▼
              readiness + viability ──► (services/matching ranks postings)
                                              │
                                              ▼
                                        interview-prep
```

Rules that keep the boundaries clean:

- **No AI service calls another AI service.** Orchestration is a service's job
  (`services/matching`), not a peer call. An `ai/` service that fans out to siblings has become a
  service with hidden state in its call graph.
- **`shared` holds ports and contracts only** — no domain logic. If two services need the same domain
  computation, that computation is probably one service's output that the other should receive.
- **Each service reads knowledge through a port**, so it can be tested with fakes and can run with
  `services/` deleted.
- **`embeddings` does not own the vector store.** It produces vectors; `knowledge-engine/vector-store`
  persists them behind its port (ADR-0004).

## What the model does, and does not

| The model does | Code owns |
|---|---|
| extract structure from a resume | any number that is a score |
| normalize a phrase to a known skill id from a closed set | all arithmetic |
| classify into a closed set | every threshold and comparison |
| write the explanation **from computed evidence** | which facts are true |
| summarize retrieved text | which facts to retrieve |

If a prompt asks the model for a fact or a number, the prompt is the bug (`prompts/conventions.md`).

## The output contract

Every scoring service returns this shape:

```json
{
  "score": 0.72,
  "confidence": "medium",
  "evidence": [
    { "kind": "skill_match",    "label": "Kubernetes", "weight": 0.18, "factIds": ["…"] },
    { "kind": "skill_missing",  "label": "Terraform",  "weight": 0.12 },
    { "kind": "skill_transfer", "label": "Docker→Kubernetes", "weight": 0.08, "detail": "graph edge 0.8" }
  ],
  "missing": ["salary band unknown for this market"],
  "scorerVersion": "job-match-v3",
  "promptVersion": "job-match-2026-07-01",
  "knowledgeAsOf": "2026-07-28T00:00:00Z",
  "computedAt": "2026-07-28T09:14:02Z"
}
```

`evidence` weights must reconcile to `score` — asserted generically across every scorer
(`.claude/skills/testing/SKILL.md`). `missing` is a product feature: it tells the user what to supply
and tells us which source to add.

## Service shape

Each service is a FastAPI application with:

- typed request/response models generated from `packages/types`
- `GET /health/live` and `GET /health/ready` — readiness checks the knowledge-engine dependency it
  needs, so a probe that always returns 200 is a lie
- the shared error envelope and code taxonomy from
  `.claude/skills/backend-service/SKILL.md`
- structured logging with the correlation id propagated across the language boundary, and **no PII**
- prompts loaded from versioned files, never inline strings

## Performance and the request path

Inference is the slowest thing in any path. So a synchronous `ai/*` call on a request a user waits on
is only allowed where the endpoint is documented as long-running, and otherwise the pattern is
enqueue-and-poll or stream (`.claude/skills/backend-service/SKILL.md`). Scores are recomputed rather
than cached as verdicts: knowledge moves, and a stale verdict is a wrong verdict served confidently.

## Constraints

- No persistent store in `ai/` — no database, cache, or vector client.
- No LLM SDK outside `ai/`.
- No score produced by a model.
- No fact invented to fill a gap.
- No output without evidence, confidence, and versions.
- No AI service calling another AI service.
- No unversioned prompt, and no inline prompt string.
- No chain-of-thought persisted or presented as evidence.
- No PII beyond what the task requires, and none in logs.
- No protected-attribute proxy in any feature or score.

## Related

- `overview.md`, `knowledge-engine.md`, `data-flow.md`
- `docs/development/ai-service-guide.md`, `docs/prompts/conventions.md`, `docs/prompts/evals.md`
- `.claude/skills/ai-matching/SKILL.md`, `career-intelligence/SKILL.md`, `learning-paths/SKILL.md`,
  `interviews/SKILL.md`, `prompt-engineering/SKILL.md`
- `.claude/context/ai-principles.md`
- ADR-0003 (Python, stateless, model boundary), ADR-0006 (uv workspace)
