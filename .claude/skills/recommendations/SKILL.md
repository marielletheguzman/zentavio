---
name: recommendations
description: How Zentavio decides what to suggest and when — ranking by expected value to the person, the next-action contract, diversity and honesty constraints, notification triggers, feedback capture, and never ranking by commercial interest. Load when building any ranked list, dashboard surface, suggestion, digest, or notification, or when deciding what a user should see next.
---

# Recommendations

## Purpose

Every Zentavio surface ends in a suggestion. This skill governs what gets suggested, in what
order, with what justification, and when it is worth interrupting someone — so that a
recommendation is a defensible next action rather than a ranked feed.

## Scope

**Applies to:** any ranked list or suggested action shown to a user, the dashboard's
next-action surface, `services/notifications` triggers, digests, and feedback capture.

**Does not apply to:** computing the underlying scores (`ai-matching`,
`career-intelligence`), building the plan (`learning-paths`), the facts behind it
(`knowledge-engine`).

## The contract

Every recommendation answers three things, in this order:

1. **What should I do?** — a concrete action, not a topic. "Learn Terraform (25–45h)", not
   "consider infrastructure skills".
2. **Why me, why now?** — the evidence, referencing this person's actual state.
3. **What changes if I do?** — the expected effect, honestly bounded. "Closes the largest
   remaining gap for cloud-engineer; readiness 0.61 → ~0.75."

A card missing any of the three is a notification, not a recommendation.

## Ranking

Rank by **expected value to this person**, never by score alone:

```text
expectedValue = impact × achievability × (1 − constraintPenalty) × freshness
```

- **impact** — how much this moves a goal the person has stated. Weighted by their target, not
  by market attractiveness in the abstract.
- **achievability** — realistic given their gap, time, and budget. A perfect match they cannot
  reach is not a recommendation.
- **constraintPenalty** — named constraints (eligibility, language, location, cost), applied
  visibly. Never a silent multiplier.
- **freshness** — decay so the same suggestion does not dominate forever.

Every factor appears in the evidence. A ranking whose order cannot be explained factor by
factor is not shippable.

## Honesty constraints

- **Never rank by commercial interest.** No partner, sponsor, or affiliate may change an
  order. If a partner resource appears, it is disclosed and it competes on merit only. The
  product is trust in the ordering; monetizing the ordering destroys the asset
  (`.claude/context/business.md`).
- **Never suppress a bad-news recommendation.** "This target is not realistic within your
  stated timeline; here is a closer one" is the most valuable thing we can say.
- **Never recommend into an unmet hard constraint** without naming it. Suggesting jobs in a
  country the person cannot work in is worse than showing nothing.
- **Never manufacture urgency.** No countdowns, no scarcity framing, no "act now". The
  deadlines we surface are real ones (application closes, rule changes, cohort starts).
- **Never present a low-confidence suggestion as a confident one.** Low confidence changes the
  visual treatment and the wording, not just a badge tint.

## Diversity

- Cap near-duplicates. Five postings at one company is one recommendation with four
  alternatives behind it.
- Mix horizons: at least one immediate action (this week), one structural action (this
  quarter). A list of only long-term suggestions produces no movement; only short-term ones
  produces no progress.
- Include one **near-miss** where it exists — "two skills from a materially better market" is
  this engine's highest-value output.
- Never fill a list to a target length. Three real recommendations beat ten with seven of
  padding, and padding trains users to ignore the surface.

## Notifications

Interrupting someone requires a real trigger. Valid triggers only:

| Trigger | Why it earns an interruption |
|---|---|
| A rule the user depends on changed | their plan is now wrong |
| A tracked target's requirements changed | their gap moved |
| Readiness crossed a threshold they set | they asked to know |
| A high-value match appeared within their constraints | perishable |
| A tracked application or pathway stage is due | perishable and consequential |
| Their plan has stalled and a smaller next step exists | actionable, not nagging |

**Invalid:** engagement prompts, streaks, "you haven't logged in", re-sends of unchanged
content, digests with nothing new. If there is nothing new, send nothing.

Every notification states what changed, why it matters to them, and one action. Frequency caps
and quiet hours are enforced in `services/notifications`, and every notification is
unsubscribable per category.

## Feedback

- Capture dismissal with a reason ("not interested", "not realistic", "already doing this",
  "wrong country"). Reasons are the training signal; a dismissal count is not.
- Feed accepted and completed recommendations into `knowledge-engine/outcomes` — this is how
  ranking becomes observed rather than assumed.
- Never re-surface an explicitly dismissed item without a stated reason for the change
  ("requirements changed since you dismissed this").
- Never treat inaction as rejection. People act on career decisions on career timescales.

## Responsibilities

1. Emit the three-part contract for every recommendation.
2. Rank by expected value with every factor in the evidence.
3. Name every constraint applied; apply none silently.
4. Enforce diversity and horizon mix; never pad.
5. Notify only on real triggers, with caps and unsubscribes.
6. Capture reasoned feedback and route it to outcomes.
7. Keep commercial interest out of the ordering, always.

## Workflow

1. Retrieve the person's goals, constraints, and current state.
2. Gather candidates from the relevant engines (matching, career, learning, interviews).
3. Score expected value per candidate, recording each factor.
4. Apply hard constraints as named filters or named penalties.
5. Diversify, mix horizons, include a near-miss, and truncate rather than pad.
6. Attach the three-part contract and the confidence to each item.
7. Decide notification-worthiness against the trigger table.
8. Log what was shown, in what order, with which factors — so the ordering is auditable later.

## Constraints

- **No recommendation without action, reason, and expected effect.**
- **No unexplainable ordering.**
- **No commercial influence on rank.**
- **No silent constraint.**
- **No manufactured urgency, streaks, or engagement bait.**
- **No padding a list to length.**
- **No notification without a real trigger and an unsubscribe.**
- **No re-surfacing a dismissed item without a stated change.**
- **No suppression of an unwelcome but honest recommendation.**
- **No PII in a notification payload beyond what the user already knows.**

## Examples

**Bad.**

```json
{ "title": "10 jobs you might like!", "urgency": "Apply in the next 24 hours!",
  "items": [ { "job": "…", "score": 0.62 }, "…" ] }
```

No reason, no expected effect, invented urgency, padded to ten, bare scores with no evidence,
and no check that the person can legally work in those locations.

**Good.**

```json
{
  "recommendations": [
    {
      "action": "Learn Terraform",
      "detail": "25–45h · 4–8 weeks at 6h/week",
      "why": "Largest remaining gap for cloud-engineer (weight 0.14); required in 71% of DE postings for this track (n=340).",
      "effect": "Readiness 0.61 → ~0.75 (estimate, medium confidence)",
      "horizon": "this quarter",
      "confidence": "medium",
      "evidence": ["…"]
    },
    {
      "action": "Add your expected salary to unlock a Blue Card eligibility check",
      "why": "Eligibility is undetermined only because this input is missing.",
      "effect": "Turns an undetermined verdict into a definite one",
      "horizon": "this week",
      "confidence": "high"
    }
  ],
  "nearMiss": {
    "action": "Consider platform-engineer in NL",
    "why": "Two skills from your current profile; higher demand and English-viable.",
    "confidence": "medium"
  }
}
```

## Best Practices

- One primary recommendation per surface. Everything else is secondary. Users act on one thing.
- The best recommendation is often "supply this missing input" — cheap for the user, and it
  converts an `undetermined` into an answer.
- Explain in the user's terms, using their target and their numbers, never generic market prose.
- Rank stability matters: an order that reshuffles on every visit reads as arbitrary. Decay
  freshness smoothly.
- Log the ordering and its factors. When a user asks "why was this first?", the answer must be
  retrievable, not reconstructed.
- If nothing has changed, show the plan, not a new suggestion. Manufacturing novelty is how a
  career platform becomes a feed.
