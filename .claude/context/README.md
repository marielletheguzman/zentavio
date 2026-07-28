# Zentavio Context Layer

> **Purpose:** The stable, project-wide context every Claude session should reason from —
> vision, terminology, principles, stack, and design philosophy. Skills say *how to do a
> task*. Context says *what is true about this project regardless of the task*.

## The split

| Layer | Answers | Lives in |
|---|---|---|
| **Context** | What is true about Zentavio always? | `.claude/context/` |
| **Skills** | How do I do this kind of work correctly? | `.claude/skills/` |
| **Templates** | What is the canonical skeleton? | `.claude/templates/` |
| **Docs** | What is the specified behavior of the system? | `docs/` |

Context is short, opinionated, and rarely changes. Skills are procedural and load on demand.
Docs are the detailed source of truth and are part of every change.

## Files

| File | Read it when |
|---|---|
| `business.md` | Deciding what to build, prioritizing, pricing, or scoping a user |
| `vision.md` | Any design decision — the "does this move us toward the vision?" test |
| `glossary.md` | Naming anything, or when a term feels ambiguous |
| `architecture.md` | Placing code, crossing a boundary, designing communication |
| `tech-stack.md` | Before reaching for any library, framework, or datastore |
| `ui-guidelines.md` | Building any screen or component |
| `ai-principles.md` | Writing a prompt, an AI service, or anything that produces a claim |
| `countries.md` | Adding or reasoning about a country |
| `career-philosophy.md` | Modeling careers, transitions, scores, or readiness |
| `product-principles.md` | Any feature — these are the non-negotiables |
| `knowledge-sources.md` | Adding a source, or assigning confidence to a fact |
| `feature-philosophy.md` | Justifying a feature's existence |
| `decisions.md` | Before changing a technology, boundary, or contract |

## Rules for this directory

1. **No forked truth.** Where a canonical document already exists in `docs/`, the context
   file points to it and summarizes only what Claude needs in-session. It never restates
   content that will drift.
2. **Short.** If a context file grows past roughly two screens of prose, the detail belongs
   in `docs/` and the context file should link to it.
3. **Prescriptive, not descriptive.** Context files state what must be true, in the
   imperative. Descriptions of current implementation live in `docs/`.
4. **Changing a context file is a real decision.** These files constrain everything
   downstream. Change them deliberately, and record the reason in `decisions.md` if a
   tradeoff was made.
