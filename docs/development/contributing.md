# Contributing

> **Purpose:** Contribution process and review expectations.

## The process

1. **Read the relevant skill** before starting. `.claude/skills/` holds the rules for each kind of work,
   and they are not optional — a constraint phrased as a prohibition means it, absent an ADR.
2. **Branch** per `branching.md`.
3. **Write the doc first** where behaviour is being defined. For a schema change, the entity document is
   the specification the migration must satisfy — not a description written afterward.
4. **Build it**, then reconcile the doc with what was actually built. Designs shift; the doc must end up
   describing reality.
5. **Run `pnpm lint:all`.**
6. **Open a PR** stating what, why, how verified, and what was left out.

## What a change owes

Every change, regardless of size:

| Owes | Why |
|---|---|
| Its documentation, in the same commit | code contradicting its doc is broken (principle 5) |
| Its tests, at the cheapest level that could catch the failure | `testing.md` |
| An ADR, if it touches a boundary, dependency, or contract | `.claude/context/decisions.md` |
| Passing `lint:all` | the boundaries are enforced, not suggested |
| An honest unknown path, if it produces a claim | `.claude/context/ai-principles.md` |
| A retention decision, if it touches person data | `docs/database/data-retention.md` |

## Review expectations

A reviewer is checking whether the change is **right**, not whether it is agreeable.

**Always check:**

- Does the doc match the code? If they disagree, one of them is a bug — say which.
- Is every number accompanied by its evidence and version?
- Is there an unknown path, and does it return `unknown` rather than a default?
- Does anything invent a fact — a salary, a rule, a course, a requirement, a sponsorship claim?
- Is provenance attached to every stored fact?
- Does the diff stay inside the boundary the change claims? Adding a connector should touch four paths;
  more means something leaked.
- Is any PII in a log, an error, an event payload, or a fixture?
- Is an `eslint-disable` on a boundary rule present? That needs an ADR, not a comment.

**Do not block on:** formatting (tools own it), naming preference where the glossary is silent, or an
approach you would have taken differently that is equally sound.

**Do block on:** an unexplainable score, an invented fact, a missing unknown path, a boundary violation,
PII in the wrong place, or a doc that now lies. Those are correctness, not taste.

## Reviewing an AI-authored change

Much of this repository is written with Claude, so:

- **Verify claims rather than trusting them.** If a commit says a check passes, run it. Confident prose is
  not evidence.
- **Check that referenced files exist.** A plausible path to a file that was never created is the most
  common failure mode.
- **Check that a "specified" thing is not described as built.** Two documents in this repo previously
  described a CI gate that did not exist.
- **Be suspicious of round numbers and precise-sounding estimates** — those are where fabrication hides.

## Raising a problem with the rules

The rules are not sacred; they are recorded. If one is wrong:

- Say so, with the case that breaks it.
- Propose the change as an ADR — including what it costs and what it forecloses.
- Do not work around it silently. A quiet exception is worse than a changed rule, because nobody can see
  it.

## What is not wanted

- A change that "will be documented later".
- A score without evidence.
- A default value standing in for a missing fact.
- A feature that answers no user question (`.claude/context/feature-philosophy.md`).
- A new dependency without an ADR.
- Real personal data anywhere, including a fixture.

## Related

- `branching.md`, `conventions.md`, `testing.md`, `ci-cd.md`
- `../../CLAUDE.md` — the five non-negotiable principles
- `.claude/context/product-principles.md` — the eight per-feature criteria
