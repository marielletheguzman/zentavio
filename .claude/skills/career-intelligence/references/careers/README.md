# Career References

> **Purpose:** Per-track career models. One file per career track
> (`cloud-engineer.md`, `ai-engineer.md`, `devops.md`, `data-engineer.md`,
> `cybersecurity.md`, …).

## Load one file, never the directory

A session modeling cloud engineering should not load cybersecurity. Read `<track>.md` for the
track in scope.

## What a reference file is — and is not

**Is:** the *model* of a career track. Which skills constitute it and how they cluster, the
seniority ladder, common entry points, adjacent careers and why competence transfers, what
evidence typically demonstrates competence, and how the track is verified.

**Is not:** the market values. Skill weights, demand figures, salary bands, and transition
frequencies live in `knowledge-engine` — derived from real postings, outcomes, and sourced
market data, and versioned as they change.

A weight typed into a reference file is a market fact frozen at the moment someone typed it.
Weights are measured (`knowledge-engine`, "Graphs"), not declared.

## Structure

Follow `_TEMPLATE.md`.

## Adding a track

1. Copy `_TEMPLATE.md` to `<track>.md`.
2. Define the skill set from **real postings**, not from intuition — the knowledge engine's
   posting co-occurrence is the basis, and the file records the method, not the numbers.
3. Map adjacency to existing tracks; the transfer weights come from skill-graph edges.
4. Seed the skill graph for the track: `requires` edges (prerequisites) are what make learning
   paths orderable.
5. Note the evidence that actually demonstrates competence, so `evidenced` vs `claimed` is
   decidable.
6. Verify the unknown path: an unmodeled sub-specialization must return `unknown`, not a
   generic answer.

Zero changes to `services/` or `ai/` should be required.

## Status

| Track | File | Status |
|---|---|---|
| Cloud / platform engineer | [`cloud-platform-engineer.md`](cloud-platform-engineer.md) | **the MVP track** — model written, values unmeasured |

`_TEMPLATE.md` defines the shape. The MVP track's skill list is **curated and pending derivation**: written
from the shape of the work, not from measured posting frequency, because no postings are ingested. Every
entry is a hypothesis to be replaced by `posting-cooccurrence` with real support counts.

## Related

- `.claude/context/career-philosophy.md` — what makes a career succeed
- `.claude/skills/career-intelligence/SKILL.md`
- `.claude/skills/learning-paths/SKILL.md` — consumes the `requires` edges
