# Learning Paths

> **Purpose:** Recommend resources to close skill gaps.

Turns a weighted gap into an ordered, resourced, honestly-timed plan. The feature most easily degraded
into a course list — which answers nothing.

**User question:** *what should I learn, in what order, and how long will it actually take?*

## What makes it a path, not a list

1. **Dependency-ordered.** From `skill_edges.requires`, never by difficulty or popularity. Docker before
   Kubernetes because the graph says so.
2. **Every step tied to a gap item.** A step with no gap behind it is padding, and padding makes a
   reachable target look unreachable.
3. **Impact-weighted within each unblocked tier.** The user should be more employable after step one
   than after step five of an arbitrary ordering.

## A step

```json
{
  "position": 1,
  "skillId": "terraform",
  "why": "Largest remaining gap for cloud-engineer (weight 0.14)",
  "prerequisites": [],
  "resources": [{ "id": "…", "title": "…", "provider": "…", "url": "…", "cost": "free" }],
  "estimatedEffort": { "low": "25h", "high": "45h", "confidence": "medium",
                       "basis": "median across 12 ingested resources" },
  "elapsed": { "low": "4 weeks", "high": "8 weeks", "assumes": "6 hours/week" },
  "verification": "artifact"
}
```

## Resources are real or absent

Every resource is an ingested row with provenance. **Nothing is invented** — no course title, no URL,
no certification. That is the most common failure mode of a learning feature.

When nothing is ingested for a skill, the step says so:

> Terraform — no verified resource for this skill yet.

Honest, and it names exactly what to ingest next. The alternative — letting a model fill the gap — is
how a fabricated course reaches a user (`docs/prompts/learning-paths/README.md`).

## Time estimates

- **Effort and elapsed time are different numbers.** 30 hours is three weeks or three months depending
  on availability, so the hours-per-week assumption is always stated.
- **Ranges, never point estimates.** A single number reads as a promise.
- **Basis stated** — resource durations, recorded outcomes, or unknown.
- **Never optimized downward for motivation.** If mastery takes a year, we say a year. People
  reorganize their lives around these numbers, and an optimistic plan that fails is worse than an
  honest one that is hard.

## Verification, and why completion is not competence

| Verification | Effect on the profile |
|---|---|
| assessment passed in-platform | promotes to `evidenced` |
| project artifact / repository | promotes to `evidenced` |
| recognized certification | promotes to `evidenced`, at the cert's own weight |
| course completion claimed | stays `claimed` |
| self-report | stays `claimed` |

Said explicitly to the user, or they optimize for completions. Only evidenced skills move readiness.

## Progress

Progress adjusts the **remainder**, never restarts the plan. The gap, the target's requirements, and the
resource set all change over time, so a path is recomputed rather than reissued — and re-estimated from
the user's observed pace once there is one, which beats their stated pace.

## States

| State | Shown |
|---|---|
| **Loading** | skeleton in step shape |
| **Empty** | no gap yet — pick a target |
| **No gap** | nothing to learn for this target; point at matching |
| **Partial** | steps built, plus which skills have no resource coverage |
| **Error** | what failed, retryable or not |
| **Success** | ordered steps with effort, elapsed, verification, and why each is placed there |

## Unknown path

No duration data → `estimatedEffort` is null and the timeline is stated as unknown, not guessed.
Unmodelled skill → surfaced as missing coverage rather than planned around.

## What it never does

- Never invents a resource, provider, URL, or certification.
- Never a step without a gap item.
- Never a point-estimate timeline, and never rounded down.
- Never promotes a skill on a claimed completion.
- Never longer than the gap requires — three well-chosen steps beat twelve.
- Never five options where one strong choice will do. Choice paralysis is a real failure mode.

## Dependencies

`ai/learning-paths` · `connectors/learning-resources` · skill graph `requires` edges ·
`docs/prompts/learning-paths/`

## Related

- `skill-gap-analysis.md` — supplies the ordered gap
- `docs/database/entities/learning-resource.md`
- `.claude/skills/learning-paths/SKILL.md`
