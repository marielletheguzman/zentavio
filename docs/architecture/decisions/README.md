# Architecture Decision Records

> **Purpose:** ADR index and template usage.

An ADR records a decision with a tradeoff: what was chosen, why, what was rejected and why, and
how a reviewer verifies the code follows it. **Accepted ADRs are binding** — code that contradicts
one is broken.

The part that survives is not the decision. It is the **options considered** and the **compliance**
section: a year from now nobody needs the decision restated, they need to know which options were
already ruled out and how the rule is enforced.

## Index

| ADR | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-monorepo.md) | Single monorepo managed by Turborepo | Accepted | 2026-07-28 |
| [0002](0002-connector-plugin-model.md) | Connector plugin model for all external sources | Accepted | 2026-07-28 |
| [0003](0003-python-for-ai-services.md) | Python/FastAPI for `ai/`, TypeScript elsewhere | Accepted | 2026-07-28 |
| [0004](0004-vector-store-choice.md) | Qdrant behind a swappable port | Accepted | 2026-07-28 |
| [0005](0005-boundary-enforcement.md) | Boundary enforcement via ESLint + eslint-plugin-boundaries | Accepted | 2026-07-28 |
| [0006](0006-python-dependency-toolchain.md) | uv workspace for Python dependencies in `ai/` | Accepted | 2026-07-28 |
| [0007](0007-test-strategy.md) | Vitest + pytest; unit/integration split | Accepted | 2026-07-28 |
| [0008](0008-observability.md) | OpenTelemetry instrumentation, backend deferred | Accepted | 2026-07-28 |
| [0009](0009-ai-evaluation.md) | Required delta report now, self-hosted runner later | Accepted | 2026-07-28 |
| [0010](0010-origin-side-requirements.md) | Origin-side requirements and professional recognition | Accepted | 2026-07-28 |
| [0011](0011-ci-required-checks.md) | Require the `ci` check on `main` | Accepted | 2026-07-28 |
| [0012](0012-database-access-layer.md) | `pg` + Kysely, plain SQL migrations, own runner | Accepted | 2026-07-28 |
| [0013](0013-lower-email-unique-index.md) | Case-insensitive email uniqueness via a `lower(email)` unique index; no `citext` | Accepted | 2026-07-29 |
| [0014](0014-typescript-runner.md) | Node native type stripping with `.ts` specifiers; no runner dependency | Accepted | 2026-07-31 |
| [0015](0015-hosted-postgresql.md) | Supabase as the managed PostgreSQL provider — and as nothing else | Accepted | 2026-08-01 |
| [0016](0016-document-text-extraction.md) | `pypdf` + `python-docx` for résumé text extraction, behind a port | Accepted | 2026-08-01 |
| [0017](0017-authentication.md) | How a person proves who they are | Accepted | 2026-08-01 |
| [0018](0018-skill-extraction-division-of-labour.md) | The model adds recall; code owns resolution and classification | Accepted | 2026-08-02 |
| [0019](0019-outcome-recording-begins-at-m2.md) | Outcome recording begins at M2 | Accepted | 2026-08-03 |
| [0020](0020-knowledge-substrate-location.md) | Structured knowledge lives in `packages/db`; `knowledge-engine/` curates it | Accepted | 2026-08-03 |
| [0021](0021-object-storage.md) | Source documents in S3-compatible object storage (R2), behind a port | Accepted | 2026-08-04 |
| [0022](0022-viability-composition.md) | Viability is two axes with the binding constraint named, not a single score | Accepted | 2026-08-04 |
| [0023](0023-tailwind-css-adoption.md) | Tailwind CSS v4, with `packages/ui/src/tokens.css` as its theme source | Proposed | 2026-08-05 |

**0010 is Accepted, and the rename is done** — `immigration_rules` is now `requirements`, with `domain`,
`imposed_by`, and `authority`. Regulated professions remain blocked on **data**, not schema: nursing,
engineering, and teaching return `unknown` until each profession's recognition rules are sourced and
ingested.

**Accepted is not implemented — but less of it than this section used to claim.** As of 2026-07-31: Vitest
and pytest are installed, the `promptVersion` check runs in CI, and ADR-0011 is fully discharged — branch
protection is configured on `main` and was verified by attempting to violate it. See ADR-0011's Correction
section, which also records that the required check is named `CI`, not `ci`, and that configuring it
required making the repository public.

Still undone: nothing is instrumented (0008), and graded evals do not run in CI (0009 defers the CI
runner deliberately — the eval runner itself has a model host). **0014 is fully discharged**: the
import convention and Node floor are implemented and enforced, and `pnpm migrate`
(`packages/db/src/migrate.ts`) is written — this section claimed it was not, for several milestones
after it landed.

0001–0004 define the boundaries every skill and context file assumes: one repository, sources as
plugins, a polyglot contract at the `ai/` boundary, and a vector store that is an index rather than
a system of record. **0005 is what makes them checkable** — it discharges the accepted cost 0001
took on, by turning the layer model into `eslint.config.mjs` and `ruff.toml`.

## When an ADR is required

Write it **before** the change, for:

- A new framework, library, datastore, queue, or hosted service (`.claude/context/tech-stack.md`)
- Changing a layer boundary or the dependency direction
- A new transport or communication pattern between services
- A change to a published contract: a `packages/types` shape, an event name, a public route
- Anything where a reasonable engineer would ask "why this way?"
- Overriding a constraint stated in a skill or a context file

**Not required for:** implementing a documented feature, a bug fix, adding a connector for an
already-approved source kind, or a refactor that changes no boundary and no contract.

## Template

Use [`.claude/templates/ADR.template.md`](../../../.claude/templates/ADR.template.md) — the
canonical skeleton. Sections: Context, Options considered, Decision, Consequences (accepted costs,
follow-up work, reversal cost), Compliance.

Rules that make an ADR worth writing:

- **Context states the tension.** If there is no tension, there is no ADR — write a doc instead.
- **Options considered are real**, each with the specific reason it lost. "No alternatives
  considered" means the decision has not been made yet.
- **"Do nothing" is always evaluated honestly.** Sometimes it wins.
- **Accepted costs are specific.** "Slower cold start on `services/matching`", not "some
  performance impact".
- **Reversal cost is stated.** What it takes to undo this in six months, and the signal that would
  say to.
- **Compliance names the enforcement** — the lint rule, test, or check. A decision nothing
  enforces will decay into a preference.

## Numbering and status

- Numbered sequentially, four digits, never renumbered: `00NN-kebab-case-title.md`.
- Filename states the decision, not the question.
- **Status:** `Proposed` (under discussion, not binding) · `Accepted` (binding) ·
  `Superseded by ADR-NNNN` · `Deprecated`.
- **Never delete an ADR.** Supersede it and point the old one at its replacement. A deleted
  decision is a decision that gets remade.
- A rejected proposal is kept with its reason — as valuable as an acceptance.

## Related

- `.claude/context/decisions.md` — the in-session summary of these rules
- `.claude/skills/documentation/SKILL.md` — ADR authoring rules
- `.claude/skills/architecture/SKILL.md` — enforces "no new dependency without an ADR"
