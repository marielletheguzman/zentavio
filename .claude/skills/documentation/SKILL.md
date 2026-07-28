---
name: documentation
description: How Zentavio writes and maintains docs — the purpose-line contract, doc-before-code order, where each kind of document lives, ADR authoring, README rules, and keeping docs and code from diverging. Load when creating or editing anything under docs/, filling in a placeholder, writing an ADR or a README, or when a change alters documented behavior.
---

# Documentation

## Purpose

`docs/` is the source of truth. Code that contradicts its doc is broken — that is principle 5,
and it is what makes a documentation-first skeleton a feature rather than a delay. This skill
keeps documents accurate, findable, and in the one place they belong.

## Scope

**Applies to:** everything under `docs/`, every `README.md`, ADRs, `CLAUDE.md`, and
`.claude/context/*`.

**Does not apply to:** code comments and docstrings (`docs/development/conventions.md`), skill
authoring (`.claude/templates/SKILL.template.md`).

## The purpose-line contract

Every document opens with:

```markdown
# Title

> **Purpose:** One sentence stating exactly what belongs in this file.
```

That line is **binding**. When filling in a placeholder, the purpose line is the specification —
read it first and write what it declares, not what seems adjacent. Content that does not serve
the purpose line belongs in another file. If the right content genuinely does not match the
purpose line, change the purpose line deliberately and say why.

## Where a document belongs

| Kind | Location |
|---|---|
| How the system is structured, and why | `docs/architecture/` |
| A decision with a tradeoff | `docs/architecture/decisions/00NN-*.md` |
| What a feature does, for whom, with what states | `docs/features/` |
| Tables, entities, relationships, retention | `docs/database/` |
| Prompt contracts and evals | `docs/prompts/` |
| How to work in the repo | `docs/development/` |
| Where the product is going | `docs/roadmap/` |
| Canonical vocabulary | `docs/GLOSSARY.md` |
| Project-wide truth for Claude | `.claude/context/` |
| How to do a kind of task correctly | `.claude/skills/` |

**One home per fact.** If something is documented twice, one copy will rot and be believed.
Cross-link instead of restating; where a canonical doc exists, other files point to it.

## Doc-before-code

1. Write or update the doc describing the intended behavior.
2. Implement.
3. Reconcile the doc with what was actually built — the design always shifts.
4. Ship them together.

A change that alters documented behavior and does not touch the doc is incomplete. Reviewers
should reject it on that basis alone.

## Writing rules

- **State what is true, in the present tense.** "The gateway authenticates every request", not
  "the gateway will authenticate".
- **Be specific about paths, types, and names.** `services/matching/src/ranking.ts`, not
  "the matching code".
- **Show the shape.** A JSON example or a table beats three paragraphs describing a shape.
- **Say what something is *not*** when confusion is likely — the glossary's `Not:` lines exist
  because that confusion is real.
- **No aspirational content in a reference doc.** Future intentions live in `docs/roadmap/`.
- **Mark placeholders explicitly:** `_Status: placeholder — content to be authored._` An
  unmarked empty doc reads as a documented absence.
- **Date anything that ages** — a rule, a benchmark, a market figure.
- **No unexplained TODO.** Either the doc says what is missing and why, or it is not a doc.

## READMEs

A directory gets a README when a reader needs orientation to work in it. It answers: what lives
here, what the boundary is, what to read next. It does **not** duplicate the detail of the
documents it points to.

`docs/README.md` is the map of `docs/`. Keep it current — a stale map is worse than none,
because it sends readers to the wrong file confidently.

## ADRs

Use `.claude/templates/ADR.template.md`. Required: Decision, Reason, Alternatives Considered,
Consequences, Reversal, Status, Date. See `.claude/context/decisions.md` for when one is
required.

The parts that survive are **Reason** and **Alternatives Considered**. A year later nobody needs
the decision restated — they need to know which options were already ruled out, so they don't
re-argue them. "No alternatives considered" means the decision has not been made yet.

Never delete an ADR. Supersede it, and point the old one at the new one.

## Keeping docs and code aligned

- The doc and the code change in the same commit. Not the next one.
- When a placeholder is filled, its purpose line is the acceptance criterion.
- When a doc is found wrong, fixing it is the immediate task, not a follow-up — a wrong doc is
  actively misleading every future session.
- When code and doc disagree and it is unclear which is right, the doc is right until an ADR
  says otherwise. That is what "source of truth" means.

## Constraints

- **No document without a purpose line.**
- **No content that contradicts its own purpose line.**
- **No fact documented in two places.** Link.
- **No behavior change shipped without its doc change.**
- **No aspirational statement in a reference doc.**
- **No unmarked placeholder.**
- **No deleted ADR.**
- **No invented external fact in a doc** — a doc citing a salary, rule, or benchmark cites its
  source and its date, exactly like a knowledge-engine fact.
- **No PII in any document, fixture, or example.** Synthetic examples only.
- **No restating a skill's rules inside a prompt or a doc.** Reference the skill.

## Examples

**Bad.**

```markdown
# Matching

We're planning to add a really powerful matching system that will use AI to find the best
jobs. It will probably use embeddings. TODO: figure out scoring.
```

No purpose line, future tense, speculative, an unexplained TODO, and no shape — a reader learns
nothing they can act on.

**Good.**

```markdown
# Job Matching

> **Purpose:** How a person is scored against a single job posting, and what the score carries.

Job Match Score answers fit between one person and one posting. It is not Career Score
(see `docs/GLOSSARY.md`).

## Inputs
- profile facts from `knowledge-engine` (skills with evidenced/claimed status)
- posting requirement facts, with weights derived from market frequency

## Output
Every score carries `evidence`, `confidence`, `scorerVersion`, `promptVersion`,
`knowledgeAsOf`, `computedAt` — see the contract in `.claude/skills/ai-matching/SKILL.md`.

```json
{ "score": 0.72, "confidence": "medium", "evidence": [ … ], "scorerVersion": "job-match-v3" }
```

## Unknown path
Missing market facts return `status: "unknown"` with `missing` populated. Never a default score.

## Related
`docs/features/skill-gap-analysis.md` · `docs/prompts/matching/README.md` · ADR-0003
```

## Best Practices

- Write for the next session, not for yourself today. Assume no memory of this conversation.
- Lead with the shape, follow with the prose. Readers scan for the JSON and the table.
- Link generously across `docs/`, `.claude/context/`, and skills. Findability is a feature.
- Keep documents short and singular. A doc covering three concerns will be updated for one.
- If explaining a design takes many paragraphs of justification, the design is probably wrong —
  documentation is a good design review.
- Record what was rejected, not only what was chosen. The rejected option is the question the
  next person will ask.
