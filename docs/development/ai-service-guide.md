# AI Service Guide

> **Purpose:** How to add or modify an AI service.

Every service under `ai/` is Python, FastAPI, and **stateless** (ADR-0003). It turns retrieved facts into
an explained judgment, and it owns no store.

Only `ai/shared/evals/` exists today, so this is the intended shape rather than a description of running
code.

## Before you start

Answer these, because they determine whether you are adding a service at all:

| Question | If the answer is… |
|---|---|
| Is this a **fact** or a **judgment**? | fact → it belongs in `knowledge-engine`, not here |
| Does it need to remember anything between requests? | yes → the state belongs in a service, not here |
| Is it computing a **number**? | then code computes it; the model only explains it |
| Does an existing `ai/` service already own this question? | extend it — do not add a peer |

## Layout

```text
ai/<service>/
├── pyproject.toml            uv workspace member (ADR-0006)
├── src/
│   ├── main.py               FastAPI app: routes, health, error envelope
│   ├── ports.py              what this service needs from knowledge
│   ├── compute.py            the arithmetic — deterministic, no model
│   └── explain.py            prose from computed evidence
├── prompts/
│   └── <name>-<YYYY-MM-DD>.md
└── tests/
```

`compute.py` and `explain.py` are separate files on purpose. The moment they merge, someone lets the model
produce a number.

### Adding the service to the workspace

The uv workspace exists (`ai/pyproject.toml`, `ai/uv.lock` committed). A new service is two steps:

```bash
# 1. add the directory to `members` in ai/pyproject.toml
# 2. re-resolve — one lockfile, one resolution pass
pnpm py:sync
```

**Members are added when the service is written, never in advance.** A member declared before it has a
single Python file is a dependency set nobody has verified.

**Runtime dependencies belong to the service, not to `shared`.** Document parsing libraries are
`resume-parser`'s; embedding libraries are `embeddings`'. A `shared` package that accumulates every
service's dependencies is the single bloated environment ADR-0006 rejected — the reason uv won was that
one resolution pass keeps `shared` and its consumers on the same versions *without* pooling their
dependencies.

**Never `pip install` in a Dockerfile or a CI step.** Every install path goes through `uv.lock`, or the
lockfile's guarantee is conditional on the machine. A `uv.lock` inside a service directory means the
workspace was bypassed.

## The division that matters

```text
retrieve facts (with provenance)  ─►  resolve  ─►  compute  ─►  explain
        knowledge-engine port          code        code        model
```

| The model does | Code owns |
|---|---|
| extract structure from messy text | any number that is a score |
| normalize a phrase to an id from a **supplied closed set** | all arithmetic |
| classify into a closed set | every threshold and comparison |
| write the explanation **from computed evidence** | which facts are true |

## Steps

1. **Confirm the layer** with `architecture` — a fact-shaped capability is not an AI service.
2. **Define the contract first** as JSON Schema in `packages/types`, and generate both the TypeScript
   types and the Pydantic models from it. Neither side hand-writes the other's shapes (ADR-0003).
3. **Declare the ports** this service needs from knowledge. It reads through them and can therefore be
   tested with fakes and run with `services/` deleted.
4. **Write `compute` with a test first.** Deterministic, exact assertions — a range on a deterministic
   score hides non-determinism.
5. **Write the prompt** per `docs/prompts/conventions.md`: knowledge before input, schema before rules,
   untrusted content delimited and declared as data.
6. **Write all six eval cases before tuning wording** (`docs/prompts/evals.md`). The cases define what
   right means; wording is the last resort and the least durable fix.
7. **Emit the output contract** — score, confidence, evidence, `missing`, `scorerVersion`,
   `promptVersion`, `knowledgeAsOf`, `computedAt`.
8. **Add health endpoints.** `/health/ready` checks the dependencies it actually needs; a probe that
   always returns 200 is a lie.
9. **Document it** in `docs/architecture/ai-services.md` and `docs/prompts/<service>/README.md`.

## The output contract

```python
return Explained(
    score=score,                       # from compute, never from the model
    confidence=weakest(profile, requirements, market),
    evidence=evidence,                 # weights reconcile to score
    missing=missing,                   # what would improve this
    scorer_version=SCORER_VERSION,
    prompt_version=PROMPT_VERSION,
    knowledge_as_of=knowledge.as_of,
    computed_at=utcnow(),
)
```

Confidence **degrades to the weakest input**. One `low`-confidence fact makes the whole result `low`,
however strong everything else is.

## The unknown path is not optional

Write it before the happy path. Missing knowledge returns `status: "unknown"` with `missing` populated and
**no score** — never `0.0`, which reads as "bad" rather than "not computed". There is an eval case for it,
and it is a blocking gate.

## What `ruff.toml` will reject

Statelessness is enforced, not requested. These imports fail `ruff check ai/`:

```text
sqlalchemy · psycopg · psycopg2 · asyncpg · alembic · redis · qdrant_client · boto3
```

If you need one, you are building a service, not an AI service. Also banned: `print` (except the eval
CLI) and relative imports beyond the current module.

## Modifying an existing service

- **Changing the arithmetic** → bump `scorerVersion`, run the evals, record the delta. An unversioned
  change makes past scores unreproducible.
- **Changing a prompt** → new versioned file, never an edit in place. Old versions stay.
- **Changing the contract** → JSON Schema in `packages/types` first, then regenerate both sides. CI fails
  if generated types drift.
- **Adding a field** → give it an explicit unknown representation, or the model will invent one.

## Never

- Own a table, a cache, or a vector collection.
- Call another `ai/` service — orchestration is a service's job; a peer call is hidden state in the call
  graph.
- Produce a score from a model.
- Persist or display chain-of-thought as evidence.
- Read a protected attribute as a scoring feature. Citizenship is admissible **only** as an input to a
  sourced immigration rule (`.claude/context/ai-memory-policy.md`).
- Log PII.

## Related

- `docs/architecture/ai-services.md` — the services and how they compose
- `docs/prompts/conventions.md`, `docs/prompts/evals.md`
- `.claude/skills/ai-matching/SKILL.md`, `prompt-engineering/SKILL.md`
- ADR-0003, ADR-0006
