# learning-resources

> **Purpose:** Course/learning-resource catalog source plugins.

**What is built:** `git-scm`, and it is the only source here. No second provider has a directory yet
— when one arrives it gets its own folder beside it, not a branch inside this one.

| Source | Covers | State |
|---|---|---|
| [`git-scm/`](git-scm/README.md) | the official Git reference documentation, ten chosen pages | **built** |

## A catalogue, never a mirror

A source here stores **a title, a URL and metadata**. It does not store the material. Copying a
provider's prose makes a mirror, and a mirror goes stale in the way that misinforms exactly the
person trying to learn from it.

The one-sentence purpose on each row is **ours** — why you would open the page — not the provider's
own summary. An ingested paraphrase of somebody else's documentation is the invented detail
`.claude/skills/learning-paths/SKILL.md` refuses.

## `grants_evidence` is always false

ADR-0030 decided an in-platform assessment is the only thing that may promote a skill to
`evidenced`. Reading a page, finishing a course and holding a certificate all promote nothing, and
validation rejects a row claiming otherwise. A connector here cannot opt out of that by describing
its resource more confidently.

## What a source must refuse to invent

**Difficulty**, where the provider grades nothing — a level we assign is our opinion wearing the
provider's clothes. **Duration**, where the provider states none: `typical_duration` stays null and
`ck_lr__duration_basis` is what stops a guess being stored quietly.

## Chosen lists over crawls

`git-scm` reads ten pages somebody picked, matched to the skill the `git-fundamentals` assessment
covers. Crawling a documentation site yields a catalogue nobody chose — every page equally weighted,
most irrelevant to any skill modelled — and an assessment citing one page while the catalogue offers
another is two opinions about where to learn the same thing.

## Related

- ADR-0030 — why a course completion evidences nothing
- ADR-0002 (plugin model), ADR-0021 (archived provenance)
- `docs/database/entities/learning-resource.md` — the table, and `learning_completions`
- `.claude/skills/connectors/SKILL.md`, `docs/development/connector-guide.md`
