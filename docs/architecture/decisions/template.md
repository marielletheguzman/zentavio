# ADR Template

> **Purpose:** Template for ADRs: status, context, decision, consequences.

**The canonical template is [`.claude/templates/ADR.template.md`](../../../.claude/templates/ADR.template.md).**
Copy that file — do not copy this one. It exists so that a reader who finds this directory first is
sent to the right place, and so there is exactly one skeleton to maintain.

Copy it to `docs/architecture/decisions/00NN-kebab-case-title.md`, where the title states the
decision rather than the question.

## Shape

```markdown
# ADR-<NNNN>: <Decision, stated as the decision>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <names>
- **Affects:** <paths / packages / services>

## Context
What forced this decision, including the constraint that makes it non-obvious.

## Options considered
### Option A — <name>    Pros / Cons.
### Option B — <name>    Pros / Cons.
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

ADR-0002 is the worked reference for the shape and the level of detail expected.

## Related

- [`README.md`](README.md) — when an ADR is required, numbering, status rules, and the index
- `.claude/skills/documentation/SKILL.md`
