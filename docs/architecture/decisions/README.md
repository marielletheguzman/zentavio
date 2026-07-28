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
