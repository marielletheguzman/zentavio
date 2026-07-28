---
name: career-intelligence
description: Zentavio's career reasoning — the career transition engine, readiness scoring, transferable-skill computation, opportunity scoring, career-graph traversal, and relocation viability. Load when working in ai/career-roadmap, modeling a career or transition, computing readiness or transferability, traversing the career graph, answering "what career should I pursue?", or adding a career track under references/careers/.
---

# Career Intelligence

## Purpose

This is the capability Zentavio is named for: reasoning about where a person can realistically
go from where they are. It turns a profile plus a target into a defensible verdict — how close
they are, what remains, how long it plausibly takes, and whether the market and the border
allow it.

## Scope

**Applies to:** `ai/career-roadmap`, career-graph traversal, transition modeling, Career Score,
Career Readiness Score, Opportunity Score, transferable-skill computation, relocation
viability, and `references/careers/*`.

**Does not apply to:** per-posting fit (`ai-matching`), plan construction
(`learning-paths`), rule lookup (`immigration`), fact storage (`knowledge-engine`).

## References

Per-track career models live in `references/careers/<track>.md`. **Load the specific file, not
the directory.** Each model defines the track's core skills and weights, seniority ladder,
common entry points, adjacent careers with transfer weights, typical evidence, and market
notes — all sourced.

## The four questions

| Question | Output |
|---|---|
| What could I do? | ranked reachable careers from the career graph, with distance and basis |
| How do I get there? | a transition path: gap, order, effort, elapsed time, plausibility |
| How close am I? | Career Readiness Score with its remainder, never a bare number |
| Is it worth it? | Opportunity Score for that career × market, person-independent |

## Career transition engine

A transition is a **path through the career graph**, not a label change.

1. **Locate** the person: current career node(s), evidenced skills, constraints
   (location, language, mobility, time available).
2. **Traverse** to candidate targets. Prefer paths with observed `transition_path` frequency
   from `knowledge-engine/outcomes` over merely adjacent ones — observed beats plausible.
3. **Compute transferability** per target (below).
4. **Compute the gap**: required skills the person lacks or under-evidences, each weighted and
   dependency-ordered.
5. **Estimate cost**: effort, elapsed time, and plausibility from this starting point — with
   the basis named and the confidence stated.
6. **Apply market and mobility reality**: demand, competition, language, eligibility. Name the
   binding constraint.
7. **Rank** by expected value to *this* person, with evidence attached.

A transition proposal with no cost and no binding constraint is not a proposal, it is
encouragement.

## Transferability

```text
transferability(person, target) = Σ over target requirements r of
    weight(r) × max(
        1.0            if evidenced hold of r,
        0.6            if claimed hold of r,             ← claimed is not evidenced
        edge_weight    if transfers_to edge from a held skill,
        0.0            otherwise
    )
```

Rules:
- Every non-zero term names its basis (`evidenced`, `claimed`, or the graph edge used).
- `weight(r)` comes from knowledge — posting emphasis and market frequency — never a constant
  typed into code.
- Edge weights come from the skill graph, with their provenance.
- Titles never transfer. Skills transfer. Two "Analysts" may share almost nothing.

## Readiness has a remainder

```json
{
  "target": "cloud-engineer",
  "readiness": 0.61,
  "confidence": "medium",
  "remaining": [
    { "skill": "Terraform",  "weight": 0.14, "typicalTimeToCompetence": "6-10 weeks", "basis": "learning-resource durations, n=12" },
    { "skill": "Kubernetes", "weight": 0.11, "partial": 0.5, "detail": "Docker held; transfer edge 0.8" }
  ],
  "estimatedTimeToReady": { "low": "4 months", "high": "7 months", "confidence": "low" },
  "bindingConstraint": null,
  "evidence": [ "…" ],
  "scorerVersion": "readiness-v2",
  "knowledgeAsOf": "2026-07-28T00:00:00Z"
}
```

A readiness number without `remaining` is a vanity metric. Ranges, not point estimates, for
anything about the future — and the range carries its own confidence.

## Relocation viability

> **viability = eligibility × employability**, and we always name which one binds.

Visa-eligible but unhirable is not an opportunity. Hirable but ineligible is not an
opportunity. Both are computed: eligibility from `immigration` (tier-1 rules only),
employability from readiness plus market demand plus the language level actually required for
that sector.

Never present one as the other. "You qualify for the Blue Card" without "and you are not yet
employable at the threshold salary" is a misleading answer with real consequences.

## Responsibilities

1. Answer with a verdict, a remainder, and a cost — never a bare score.
2. Compute transferability from the skill graph, never from title or keyword overlap.
3. Order gaps by dependency; an unordered gap list is not actionable.
4. Give honest timelines. A year is a year. Optimism here reorganizes people's lives.
5. Name the binding constraint whenever an option is not viable.
6. Prefer observed transition paths over theoretical adjacency, and say which was used.
7. Never score on a protected attribute or a background proxy
   (`.claude/context/career-philosophy.md`).

## Workflow

1. Read `.claude/context/career-philosophy.md` and the relevant
   `references/careers/<track>.md`.
2. Retrieve the person's profile facts and the target's requirement facts from
   `knowledge-engine` — with provenance.
3. Resolve both sides through the skill and career registries.
4. Compute transferability, then the ordered gap, then readiness with its remainder.
5. Estimate cost from learning-resource durations and recorded outcomes. State the basis.
6. Apply market and mobility constraints; identify the binding one.
7. Emit value + confidence + evidence + versions (`ai-matching` output contract).
8. Verify the unknown path: an unmodeled target must return `unknown` with what is missing —
   never a generic answer.

## Constraints

- **No readiness or Career Score without its remainder.**
- **No transition estimate without effort, time, and plausibility.**
- **No transferability from title similarity or keyword overlap.**
- **No optimistic rounding of timelines.**
- **No relocation verdict that reports only eligibility or only employability.**
- **No protected attribute or prestige proxy as a scoring feature.**
- **No career fact invented for an unmodeled track.** `unknown` + what is missing.
- **No advice framing on immigration.** Sourced information, and who to consult.
- **No state in `ai/`.**
- **No confusion of the score family.** Career Score ≠ Readiness ≠ Opportunity ≠ Job Match.

## Examples

**Bad — title-based transfer, invented timeline, no remainder.**

```python
if "analyst" in current_title.lower() and target == "data-engineer":
    return {"readiness": 0.8, "message": "Great fit! ~3 months to be ready."}
```

Title matching, an invented number, an invented timeline, no gap, no evidence, no confidence.

**Good.**

```python
profile = await knowledge.profile_facts(user_id)
target  = await knowledge.career_requirements("data-engineer")

transfer = transferability(profile, target, skill_graph)   # each term names its basis
gap      = ordered_gap(profile, target, skill_graph)       # weighted, dependency-ordered
cost     = estimate_cost(gap, resources, outcomes)         # ranges + basis + confidence
market   = await knowledge.market_intel("data-engineer", country)

return Readiness(
    readiness=transfer.score, confidence=weakest(transfer, target, market),
    remaining=gap, estimated_time_to_ready=cost.range,
    binding_constraint=first_binding([market.demand, profile.eligibility, profile.language]),
    evidence=transfer.evidence + gap.evidence,
    scorer_version=SCORER_VERSION, knowledge_as_of=knowledge.as_of,
)
```

## Best Practices

- Start from the person's evidenced skills, never from their job title. The title is the least
  informative field on a resume.
- Rank by expected value to this person, not by market attractiveness alone — a great market
  they cannot enter is not a recommendation.
- Surface the near-miss: "two skills from a much better market" is the single most useful thing
  this engine can say.
- Non-linear paths are normal. A career break changes which evidence to look for, never the
  ceiling.
- If a track is unmodeled, say so and record the request. That is the backlog for
  `references/careers/`.
- Recompute rather than cache verdicts. Knowledge moves; a stale verdict is a wrong verdict
  presented confidently.
