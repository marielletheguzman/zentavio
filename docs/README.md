# Zentavio Documentation

> **Purpose:** Source-of-truth docs index: organization, navigation, conventions. Links every top section: architecture, features, prompts, roadmap, database, development.

`docs/` is the source of truth. Code that contradicts its doc is broken. Every document opens
with a `> **Purpose:**` line — that line is a binding contract for what belongs in the file.

## Sections

| Section | Contains | Start at |
|---|---|---|
| [`architecture/`](architecture/) | system structure, layering, boundaries, data flow, security, privacy | [`overview.md`](architecture/overview.md) |
| [`architecture/decisions/`](architecture/decisions/) | ADRs — binding once Accepted | [`README.md`](architecture/decisions/README.md) |
| [`features/`](features/) | what each capability does, for whom, with which states | [`README.md`](features/README.md) |
| [`database/`](database/) | schema, entities, relationships, migrations, retention, vector store | [`schema-overview.md`](database/schema-overview.md) |
| [`prompts/`](prompts/) | prompt contracts, per-service prompt docs, evals | [`conventions.md`](prompts/conventions.md) |
| [`development/`](development/) | how to work in the repo: setup, conventions, testing, CI, observability | [`getting-started.md`](development/getting-started.md) |
| [`roadmap/`](roadmap/) | vision, phases, MVP, milestones, backlog | [`vision.md`](roadmap/vision.md) |
| [`09_AI_SKILLS/`](09_AI_SKILLS/) | catalog of project-specific Claude Skills | [`AI_SKILLS.md`](09_AI_SKILLS/AI_SKILLS.md) |
| [`GLOSSARY.md`](GLOSSARY.md) | canonical vocabulary — binding on code, docs, prompts, and UI copy | — |

## Where a document belongs

One home per fact. If something is documented twice, one copy will rot and be believed. Link
instead of restating.

| Kind of content | Location |
|---|---|
| How the system is structured, and why | `architecture/` |
| A decision with a tradeoff | `architecture/decisions/00NN-*.md` |
| What a feature does | `features/` |
| Tables, entities, retention | `database/` |
| Prompt contracts and evals | `prompts/` |
| How to work in the repo | `development/` |
| Where the product is going | `roadmap/` |
| Canonical vocabulary | `GLOSSARY.md` |
| Project-wide truth for Claude | `.claude/context/` |
| How to do a kind of task correctly | `.claude/skills/` |

## Conventions

- **Purpose line required.** Every document opens with one, and its content serves it.
- **Present tense, specific paths.** "The gateway authenticates every request", with the file
  named.
- **Shape first.** A JSON example or a table beats paragraphs describing a shape.
- **Doc before code, shipped together.** A behavior change without its doc change is incomplete.
- **Placeholders are marked** `_Status: placeholder — content to be authored._`
- **No invented external facts.** A doc citing a rule, salary, or benchmark cites its source and
  date, exactly like a knowledge-engine fact.
- **No PII** in any document, example, or fixture.

Full rules: the `documentation` skill (`.claude/skills/documentation/SKILL.md`) and
[`development/conventions.md`](development/conventions.md).

## Reading order for a new contributor

1. [`../CLAUDE.md`](../CLAUDE.md) — what Zentavio is and the non-negotiable principles
2. [`roadmap/vision.md`](roadmap/vision.md) — the north star and the design test
3. [`GLOSSARY.md`](GLOSSARY.md) — the vocabulary, including what each score is *not*
4. [`architecture/overview.md`](architecture/overview.md) — layers and boundaries
5. [`development/getting-started.md`](development/getting-started.md) — setup
6. [`09_AI_SKILLS/AI_SKILLS.md`](09_AI_SKILLS/AI_SKILLS.md) — how Claude works in this repo

## Current state

The repository is a documentation-first skeleton — no application code yet, beyond the boundary
enforcement in `eslint.config.mjs` and `ruff.toml`.

| Area | Authored | Status |
|---|---|---|
| `architecture/` (incl. `decisions/`) | 18 / 18 | complete — ADRs 0001–0006 Accepted and binding |
| `database/` | 14 / 14 | complete |
| `prompts/` | 9 / 9 | complete |
| `development/` | 11 / 11 | complete |
| `roadmap/` | 6 / 6 | complete |
| `features/` | 11 / 11 | complete |
| root | `GLOSSARY.md`, `09_AI_SKILLS/AI_SKILLS.md` | this file included |

**Every document in `docs/` is authored — no placeholders remain.**

Filling a placeholder means writing what its purpose line declares — that line is the specification.
The six Accepted ADRs are binding on everything written afterward; read them before changing a
boundary they cover.

Documents that describe things **not yet built**, and say so in place: graded prompt evals
(`prompts/evals.md` — runner exists, needs a model host), deployment (`development/ci-cd.md`), and
**origin-side immigration rules** (`architecture/immigration.md` — the rule model cannot express them
yet, which blocks any eligibility verdict for regulated professions).
