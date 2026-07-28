---
name: learning-paths
description: How Zentavio builds learning plans — dependency-ordered gap closure, real sourced resources, honest time estimates, verification of learning, and progress tracking. Load when working in ai/learning-paths, connectors/learning-resources, generating a plan from a skill gap, estimating time to competence, or answering "what should I learn?".
---

# Learning Paths

## Purpose

A learning path turns a weighted skill gap into an ordered, resourced, honestly-timed plan. It
is the answer to "what should I learn?" — and it is the feature most easily degraded into a
course list, which answers nothing.

## Scope

**Applies to:** `ai/learning-paths`, `connectors/learning-resources`, learning-resource facts
in `knowledge-engine`, progress and verification tracking.

**Does not apply to:** computing the gap (`career-intelligence`, `ai-matching`), whether the
target is worth pursuing (`career-intelligence`), delivering the plan as a suggestion
(`recommendations`).

## What a learning path is

```text
target        the career or role the plan closes the gap toward
steps[]       ordered by dependency, each tied to exactly one gap item
              step: { skillId, why, prerequisites[], resources[], estimatedEffort,
                      verification, weight }
totalEstimate a range, with its basis and confidence
assumptions   hours/week available, starting point, what we do not know
```

Three properties make it a path rather than a list:

1. **Ordered by dependency.** Prerequisites from the skill graph (`requires` edges), never by
   difficulty or popularity. Learn Docker before Kubernetes because the graph says so.
2. **Every step justified by a gap item.** A step with no gap item behind it does not belong —
   it is padding, and padding costs the user weeks.
3. **Weighted by impact.** High-weight gaps come first among the steps that are unblocked. The
   user should be more employable after step one than after step five of an arbitrary ordering.

## Resources are real or absent

Every resource is a `learning-resource` fact ingested by a connector, with provenance:
`title`, `provider`, `url`, `format`, `cost`, `language`, `typicalDuration`, `level`,
`lastVerifiedAt`, `sourceTier`.

- **Never invent a course, book, URL, or certification.** This is `ai-principles.md` rules 1
  and 3, and it is the single most common failure mode of a learning feature.
- A step with no ingested resource says so: `resources: []` plus
  `note: "no verified resource for this skill yet"`. That is honest and actionable — it tells us
  what to ingest.
- Prefer official provider pages (tier 2 floor) over aggregator listings.
- Dead links are a data-quality bug: `lastVerifiedAt` plus a health check on resource URLs.

## Time estimates

Honest, ranged, and based on something:

```json
{
  "skillId": "terraform",
  "estimatedEffort": { "low": "25h", "high": "45h", "confidence": "medium",
                       "basis": "median duration across 12 ingested resources + 8 recorded outcomes" },
  "elapsed": { "low": "4 weeks", "high": "8 weeks", "assumes": "6 hours/week" }
}
```

Rules:
- **Effort and elapsed time are different numbers.** 30 hours is three weeks or three months
  depending on the person's availability. Always state the assumed hours/week.
- **Ranges, never point estimates.** A single number reads as a promise.
- **Basis stated.** Resource durations, recorded outcomes, or "unknown".
- **Never optimize the estimate downward for motivation.** If mastery takes a year, say a
  year. People reorganize their lives around these numbers, and an optimistic plan that fails
  is worse than an honest one that is hard.

## Verification

A completed course is not a held skill. Each step declares how competence is verified:

| Verification | Strength |
|---|---|
| assessment passed in-platform | evidenced |
| project artifact / repository | evidenced |
| recognized certification | evidenced (with the cert's own weight) |
| course completion claimed | claimed only |
| self-report | claimed only |

Only evidenced verification promotes a skill from `claimed` to `evidenced` in the profile —
which is what actually moves readiness (`career-intelligence`). Say this to the user
explicitly, or they will optimize for completions.

## Responsibilities

1. Order steps by skill-graph prerequisites, then by gap weight.
2. Tie every step to a gap item, with the reason visible to the user.
3. Attach only real, ingested resources — or state their absence.
4. Give ranged, based estimates for both effort and elapsed time, with assumptions stated.
5. Declare verification per step and distinguish claimed from evidenced.
6. Recompute the plan when the gap, the target's requirements, or the resource set changes.
7. Track progress, and adjust the remainder rather than restarting the plan.

## Workflow

1. Receive the weighted, dependency-annotated gap from `career-intelligence`.
2. Retrieve `requires` edges from the skill graph for the gap skills; topologically sort.
3. Within each unblocked tier, order by gap weight descending.
4. Retrieve learning resources per skill from `knowledge-engine`. Filter by the user's
   language, budget, and format constraints. Empty is a valid result.
5. Estimate effort from resource durations and recorded outcomes; convert to elapsed time using
   the user's stated availability.
6. Attach verification per step.
7. Emit the plan with evidence, assumptions, confidence, and versions
   (`ai-matching` output contract).
8. On progress events, recompute the remainder — never silently reissue the original plan.

## Constraints

- **No invented resource, URL, provider, or certification.**
- **No step without a gap item.**
- **No ordering by difficulty or popularity instead of prerequisites.**
- **No point-estimate timeline, and no optimistic rounding.**
- **No elapsed-time estimate without a stated hours/week assumption.**
- **No promotion to `evidenced` from a claimed completion.**
- **No plan longer than the gap requires.** Padding a path with adjacent nice-to-haves is a
  disservice, and it makes the target look unreachable.
- **No stale plan served as current** — recompute against current knowledge.
- **No state in `ai/`.**

## Examples

**Bad — invented resources, no order, false precision.**

```python
return {"steps": [
  {"skill": "Kubernetes", "resource": "Kubernetes Mastery on Udemy", "weeks": 2},
  {"skill": "Docker",     "resource": "Docker Deep Dive course",     "weeks": 1},
]}
```

Two invented course titles, Kubernetes before Docker (prerequisite inverted), point estimates
presented as fact, no verification, no gap linkage.

**Good.**

```python
gap     = await career.ordered_gap(user_id, target)          # weighted + dependency-annotated
order   = topo_sort(gap.items, skill_graph.requires_edges)   # prerequisites first
steps   = []
for skill in order:
    resources = await knowledge.learning_resources(
        skill, language=user.language, max_cost=user.budget, format=user.formats)
    effort = estimate_effort(skill, resources, outcomes)     # range + basis + confidence
    steps.append(Step(
        skill_id=skill.id,
        why=gap.reason_for(skill),                           # shown to the user
        prerequisites=skill_graph.requires(skill),
        resources=resources,                                  # [] when none ingested
        note=None if resources else "no verified resource for this skill yet",
        estimated_effort=effort,
        elapsed=to_elapsed(effort, user.hours_per_week),
        verification=verification_for(skill),
        weight=gap.weight_of(skill),
    ))
```

## Best Practices

- Front-load the highest-weight unblocked skill. Early visible readiness gain is what keeps a
  plan alive.
- Keep paths short. Three well-chosen steps beat twelve — the gap is the scope, not the
  curriculum.
- Prefer one good resource per step over five options. Choice paralysis is a real failure mode.
- Make the "why this order" visible. Users who understand the dependency follow the plan;
  users who don't reorder it.
- Missing resources are a backlog signal for `connectors/learning-resources`. Log them.
- Re-estimate from the user's actual pace once you have it. Their observed hours/week beats
  their stated one.
