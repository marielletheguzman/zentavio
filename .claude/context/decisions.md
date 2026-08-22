# Decisions

> **Canonical location:** [`docs/architecture/decisions/`](../../docs/architecture/decisions/).
> Full ADRs live there, one file per decision, numbered and dated. This file is the index and
> the rule for when an ADR is required. Decisions that live only in chat history are lost
> decisions — and the next session will quietly re-litigate them.

## When an ADR is required

Write one before the change, not after, for:

- A new framework, library, datastore, queue, or hosted service (`tech-stack.md`)
- Changing a layer boundary or the dependency direction (`architecture.md`)
- A new transport or communication pattern between services
- A change to a published contract: a `packages/types` shape, an event name, a public route
- Anything with a real tradeoff where a reasonable engineer would ask "why this way?"
- Overriding a constraint in a skill or a context file

No ADR needed for: implementing a documented feature, a bug fix, adding a connector for an
already-approved source kind, or a refactor that changes no boundary and no contract.

## Format

Use `.claude/templates/ADR.template.md` — the canonical skeleton:

```markdown
# ADR-<NNNN>: <Decision, stated as the decision, not the question>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <names>
- **Affects:** <paths / packages / services>

## Context
What forced this decision, including the constraint that makes it non-obvious. No tension,
no ADR — write a doc instead.

## Options considered
### Option A — <name>      Pros / Cons.
### Option B — <name>      Pros / Cons.
### Option C — do nothing  Always evaluated honestly.

## Decision
The chosen option, one sentence, active voice.

## Consequences
**Accepted costs.** What gets worse — specifically.
**Follow-up work.** Concrete tasks this creates.
**Reversal cost.** What undoing it in six months takes, and the signal that would say to.

## Compliance
How a reviewer verifies code follows this. Name the lint rule, test, or check.
```

**Options considered** and **Compliance** are the parts that survive. A year from now nobody
needs the decision restated — they need to know which options were already ruled out, and how
the rule is actually enforced. A decision nothing enforces decays into a preference.

## Status rules

- **Proposed** — under discussion, not binding.
- **Accepted** — binding. Code that contradicts it is broken.
- **Superseded** — kept forever, pointing at its replacement. Never delete an ADR; a deleted
  decision is a decision that gets remade.
- **Deprecated** — no longer applies, kept with the reason. Just as valuable as an acceptance.

An ADR is numbered sequentially and never renumbered.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](../../docs/architecture/decisions/0001-monorepo.md) | Single monorepo managed by Turborepo | Accepted |
| [0002](../../docs/architecture/decisions/0002-connector-plugin-model.md) | Connector plugin model for all external sources | Accepted |
| [0003](../../docs/architecture/decisions/0003-python-for-ai-services.md) | Python/FastAPI for `ai/`, TypeScript elsewhere | Accepted |
| [0004](../../docs/architecture/decisions/0004-vector-store-choice.md) | Qdrant behind a swappable port | Accepted |
| [0005](../../docs/architecture/decisions/0005-boundary-enforcement.md) | ESLint + eslint-plugin-boundaries for boundary enforcement | Accepted |
| [0006](../../docs/architecture/decisions/0006-python-dependency-toolchain.md) | uv workspace for Python dependencies in `ai/` | Accepted |
| [0007](../../docs/architecture/decisions/0007-test-strategy.md) | Vitest + pytest; unit/integration split | Accepted |
| [0008](../../docs/architecture/decisions/0008-observability.md) | OpenTelemetry, backend deferred | Accepted |
| [0009](../../docs/architecture/decisions/0009-ai-evaluation.md) | Eval delta report required; runner later | Accepted |
| [0010](../../docs/architecture/decisions/0010-origin-side-requirements.md) | Origin-side requirements and professional recognition | Accepted |
| [0011](../../docs/architecture/decisions/0011-ci-required-checks.md) | Require the `ci` check on `main` | Accepted |
| [0012](../../docs/architecture/decisions/0012-database-access-layer.md) | `pg` + Kysely, plain SQL migrations, own runner | Accepted |
| [0013](../../docs/architecture/decisions/0013-lower-email-unique-index.md) | Case-insensitive email uniqueness via `lower(email)` unique index; no `citext` | Accepted |
| [0014](../../docs/architecture/decisions/0014-typescript-runner.md) | Node native type stripping with `.ts` specifiers; no runner dependency | Accepted |
| [0015](../../docs/architecture/decisions/0015-hosted-postgresql.md) | Supabase as the managed PostgreSQL provider — and as nothing else | Accepted |
| [0016](../../docs/architecture/decisions/0016-document-text-extraction.md) | `pypdf` + `python-docx` for résumé text extraction, behind a port | Accepted |
| [0017](../../docs/architecture/decisions/0017-authentication.md) | How a person proves who they are | Accepted |
| [0018](../../docs/architecture/decisions/0018-skill-extraction-division-of-labour.md) | The model adds recall; code owns resolution and classification | Accepted |
| [0019](../../docs/architecture/decisions/0019-outcome-recording-begins-at-m2.md) | Outcome recording begins at M2 | Accepted |
| [0020](../../docs/architecture/decisions/0020-knowledge-substrate-location.md) | Structured knowledge lives in `packages/db`; `knowledge-engine/` curates it | Accepted |
| [0021](../../docs/architecture/decisions/0021-object-storage.md) | Source documents in S3-compatible object storage (R2), behind a port | Accepted |
| [0022](../../docs/architecture/decisions/0022-viability-composition.md) | Viability is two axes with the binding constraint named, not a single score | Accepted |
| [0023](../../docs/architecture/decisions/0023-tailwind-css-adoption.md) | Tailwind CSS v4, with `packages/ui/src/tokens.css` as its theme source | Accepted |
| [0024](../../docs/architecture/decisions/0024-alternative-routes.md) | A pathway has routes, and a verdict names the one it used | Accepted |
| [0025](../../docs/architecture/decisions/0025-derived-thresholds.md) | A threshold no authority publishes is computed by the connector and cites every instrument it came from | Accepted |
| [0026](../../docs/architecture/decisions/0026-destination-comparison.md) | Destinations are compared, grouped and explained — never ranked by a score | Accepted |
| [0027](../../docs/architecture/decisions/0027-quota-semantics.md) | A quota is a property of the pathway, never a requirement a person can fail | Accepted |
| [0028](../../docs/architecture/decisions/0028-remote-as-a-destination.md) | `REMOTE` compares on employability alone, and its eligibility is `not_applicable` rather than unknown | Accepted |
| [0029](../../docs/architecture/decisions/0029-origin-scoped-requirements.md) | Origin scopes a requirement through `applies_to`, and an origin with no rule is `unknown`, never `not_applicable` | Accepted |
| [0030](../../docs/architecture/decisions/0030-what-may-promote-a-skill-to-evidenced.md) | An in-platform assessment is the only thing that may promote a skill to `evidenced`, and what it evidences is the attempt | Accepted |
| [0031](../../docs/architecture/decisions/0031-minimum-support-for-an-interview-process.md) | A company's interview process is described per role family, above a stated support floor, and never from a single report | Accepted |
| [0032](../../docs/architecture/decisions/0032-interview-report-contribution.md) | Anyone signed in may report a pairing once, corrections recompute, and withdrawal detaches rather than deletes | Accepted |
| [0033](../../docs/architecture/decisions/0033-job-board-source-tier-and-what-a-posting-may-state.md) | A Lever board is a tier-2 source, and a posting states only what Lever states structurally | Accepted |
| [0034](../../docs/architecture/decisions/0034-job-posting-identity-and-lifecycle.md) | A posting’s identity is the source’s, deduplication belongs to persistence, and absence expires nothing unless the source lists exhaustively | Accepted |
| [0035](../../docs/architecture/decisions/0035-what-an-extracted-job-requirement-may-claim.md) | A skill read out of a posting’s prose is a mention with a span, never a stated requirement | Proposed |

0001–0004 define the boundaries every skill and context file assumes: one repository, sources as
plugins, a polyglot contract at the `ai/` boundary, and a vector store that is an index rather
than a system of record. **They are binding.** Read the ADR before changing anything it covers —
the options it already rejected are the questions you are about to ask.

**Enforcement lives in `eslint.config.mjs`** (the layer model, the connector registry rule, the
`process.env` rule, the Qdrant port rule, the banned-stack rule) **and `ruff.toml`** (`ai/`
statelessness). `eslint.config.mjs` and the layer table in
`.claude/skills/architecture/SKILL.md` must state the same thing — if they diverge, one is a bug.
CI runs both on every pull request (`.github/workflows/ci.yml`; see `docs/development/ci-cd.md`).
Locally: `pnpm lint:all`. Still outstanding: TypeScript project references and SHA-pinned actions
(ADR-0005 follow-up).

## Worked reference

`docs/architecture/decisions/0002-connector-plugin-model.md` is the reference for the expected
shape and level of detail: four real options (including "do nothing"), each with the specific
reason it lost; accepted costs stated plainly, including the ones that are genuinely
inconvenient; and a compliance section naming the grep, the lint rule, and the purity test that
make the decision checkable rather than aspirational.

## Related

- `tech-stack.md` — what an ADR is required to change
- `architecture.md` — the boundaries ADRs protect
- Skill: `architecture` — enforces "no new dependency without an ADR"
