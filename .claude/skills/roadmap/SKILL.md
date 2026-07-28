---
name: roadmap
description: How Zentavio plans — vertical-slice phasing, MVP definition, milestone and backlog discipline, scope cuts that preserve explainability, and the depth-before-breadth rule. Load when editing anything under docs/roadmap/, planning a phase or milestone, prioritizing the backlog, defining or cutting MVP scope, or deciding what to build next.
---

# Roadmap

## Purpose

Keep planning honest about what Zentavio actually is: a reasoning system whose value appears
only when a whole vertical works end to end. This skill governs how work is sequenced, what
"done" means for a phase, and which cuts are legitimate when scope must shrink.

## Scope

**Applies to:** `docs/roadmap/vision.md`, `phases.md`, `mvp.md`, `milestones.md`,
`backlog.md`, and any prioritization decision.

**Does not apply to:** whether a feature should exist (`.claude/context/feature-philosophy.md`),
technical design (`architecture`).

## Vertical slices, not horizontal layers

A phase delivers **one complete answer to one user question**, through every layer.

```text
Good phase:  resume in → gap out → learning path out → honest readiness with evidence,
             for one career track in one country, fully explainable.

Bad phase:   "build the knowledge engine", then "build the AI layer", then "build the UI".
```

Horizontal phases produce nothing demonstrable and nothing learnable until the last one, and
the last one always slips. A vertical slice can be shown to a user, produces outcome data, and
proves the architecture end to end.

## Depth before breadth

> One country and one track answered completely beats ten answered vaguely.

Breadth is the growth plan; it is worthless before depth exists. Country ten is cheap only
because country one forced the design to be additive. Adding countries or tracks before one
works completely produces ten shallow answers and a design that hardcodes the shallowness.

Breadth work is legitimate when it is **additive by construction** — a reference file,
connector coverage, ingested facts, a registry entry, and zero service or AI code changes.

## Definition of done for a phase

A phase ships only when all of these hold:

1. **The question is answered end to end**, in the product, by a real user path.
2. **Every number shown carries its evidence** and its confidence.
3. **The unknown path works** — missing knowledge produces an honest answer, not a default.
4. **The docs describe what was built.**
5. **The invariant tests exist** — determinism, evidence completeness, provenance, unknown path
   (`testing`).
6. **Outcomes are captured** for whatever the phase produced, even if nothing reads them yet.

Items 2, 3, and 6 are the ones under pressure at the end of a phase. They are not cuttable —
see below.

## Legitimate scope cuts

When a phase is too big, cut in this order:

1. **Coverage** — fewer countries, tracks, sources, or companies. One is a valid number.
2. **Automation** — a manual ingest or a seeded fixture instead of a live connector. Honest and
   fast, as long as provenance is real.
3. **Polish** — fewer surfaces, simpler layout, no charts.
4. **Depth of a secondary engine** — interview prep can be a stub while career reasoning is real.

## Never cut

- **Evidence.** A score without its evidence is not a smaller feature, it is a different and
  worse product.
- **The unknown path.** Cutting it means shipping confident guesses.
- **Provenance.** A fact without a source cannot be repaired later; it silently poisons
  everything derived from it.
- **Privacy and retention.** Retrofitted privacy is a breach already shipped.
- **Documentation of what shipped.** The next phase starts from it.

If the phase cannot ship with these intact, the phase is too big. Cut coverage until it fits.

## Milestones and backlog

- A **milestone** is verifiable by someone who did not build it: a user path that works, not a
  set of merged PRs.
- A **phase** contains milestones; a milestone contains items with the phase's definition of
  done applied at its own scale.
- Every backlog item states the **user question** it serves
  (`.claude/context/feature-philosophy.md`). An item with no question is deleted, not deferred —
  a backlog full of unjustified items is where prioritization goes to die.
- Every item carries what it **depends on** in the chain (resume → gap → path → readiness →
  viability → matching → interview → outcome). Items are sequenced by that chain, not by
  enthusiasm.
- Prefer items that **deepen the chain** over items that widen the surface.

## Prioritization order

Between items that all pass the feature-philosophy tests, prefer the one that:

1. completes a vertical slice already in progress,
2. makes an existing answer more honest,
3. produces outcome data we can learn from,
4. removes a blocker for several later items,
5. widens coverage additively.

Finishing beats starting. Two half-slices deliver nothing; one whole slice delivers a product.

## Responsibilities

1. Phase by vertical slice; refuse horizontal phases.
2. Apply the definition of done, including the non-cuttable items.
3. Keep every backlog item tied to a user question and a chain position.
4. Cut coverage before quality, always.
5. Sequence by dependency, and finish what is started.
6. Record why a phase was ordered as it was — sequencing is a decision worth an ADR when the
   tradeoff is real.

## Workflow

1. Read `docs/roadmap/vision.md` and `phases.md`.
2. State the user question this phase answers, and for whom.
3. Trace the vertical: which connector, which facts, which AI service, which surface.
4. Identify the smallest coverage that makes the answer real (one track, one country).
5. Write the phase's definition of done, including the non-cuttable items explicitly.
6. Sequence milestones by the chain, not by layer.
7. When scope pressure arrives, cut per the order above and record what was cut and why.
8. On completion, verify the six done criteria before declaring the phase shipped.

## Constraints

- **No horizontal phase.**
- **No phase without a user question.**
- **No backlog item without a question and a chain position.**
- **No cut to evidence, unknown paths, provenance, privacy, or documentation.**
- **No breadth work before one vertical is complete**, unless it is additive by construction.
- **No milestone measured in merged PRs.**
- **No "we'll add explainability later."** It is structural; retrofitting it means rewriting the
  scoring layer.
- **No roadmap doc that contradicts `docs/roadmap/vision.md`.**

## Examples

**Bad phase definition.**

> **Phase 2: Knowledge Engine** — build the skills graph, career graph, company registry,
> immigration rules, market intel, and vector store.

Six months, nothing demonstrable, no user question, no learning, and no proof any of it is
shaped right for the features that will consume it.

**Good phase definition.**

> **Phase 2: "Am I ready for cloud engineering in Germany?"**
>
> One track (cloud-engineer), one country (DE), one user path.
>
> - Resume upload → parsed profile with evidenced/claimed skills and source spans
> - Skill graph seeded for the track (sourced edges only)
> - Weighted, dependency-ordered gap
> - Readiness score with remainder, evidence, and confidence
> - DE Blue Card rules ingested from tier-1 sources, versioned and dated
> - Relocation viability naming the binding constraint
> - Dashboard surface with all four states and evidence disclosure
>
> **Done when:** a real user completes the path, every number shows its evidence, missing
> knowledge returns an honest `unknown`, docs match, invariant tests pass, and outcomes are
> recorded.
>
> **Cuttable:** more tracks, more countries, live connectors (seeded facts acceptable),
> charts, interview prep.
> **Not cuttable:** evidence, unknown paths, provenance, privacy, docs.

## Best Practices

- Name phases after the user's question. It keeps scope arguments anchored to something real.
- A phase that cannot be demoed is not a phase.
- Write the "not cuttable" list at the start of a phase, when nobody is under pressure.
- Slice by user question, never by layer or by team.
- Re-read `docs/roadmap/vision.md` when prioritizing. The design test is a prioritization test
  too.
- Record what was cut and why. The next phase's scope conversation starts there.
