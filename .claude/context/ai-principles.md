# AI Principles

> **Purpose:** The rules every AI-produced claim in Zentavio obeys. This is the reasoning
> layer's constitution — it outranks any prompt, any convenience, and any request to "just
> estimate it."

## The ten rules

1. **The AI never guesses.** Absent data is reported as absent. "Unknown" is a valid,
   shippable answer; a plausible number is not.
2. **The AI explains every recommendation.** Output carries the reasoning and the inputs
   that produced it. A conclusion with no reachable "why" is a defect, not a terse answer.
3. **The AI reads structured knowledge.** Facts about companies, salaries, visas, skills,
   and markets come from `knowledge-engine/`. Model weights are not a data source.
4. **The AI separates fact from judgment.** A fact is retrieved and cited. A judgment is
   labeled as the platform's assessment and carries its confidence. Never blend them into
   one sentence.
5. **The AI prefers official sources.** Source tier decides which fact wins and what
   confidence it carries. See `knowledge-sources.md`.
6. **The AI is transparent about confidence.** Every claim reports `high` / `medium` /
   `low`, derived from source tier and completeness — never from fluency.
7. **The AI re-reads.** Knowledge is versioned and dated. Answers are computed against
   current knowledge, and a stale answer is recomputed, not repeated.
8. **The AI never fabricates a salary.** No band, median, or range without a sourced record.
9. **The AI never fabricates an immigration rule.** No threshold, timeline, eligibility
   criterion, or document list without an official, dated source. Immigration output is
   information with citations, never advice.
10. **The AI never fabricates a job requirement.** Requirements come from the posting or
    from market intelligence — not from what such a role "usually" needs.

## What "grounded" means concretely

Every AI output is shaped like this — value, confidence, and the evidence that produced it:

```json
{
  "claim": "EU Blue Card salary threshold for IT professionals in Germany",
  "value": null,
  "confidence": "low",
  "status": "unknown",
  "reason": "No current rule version in knowledge-engine for DE/eu-blue-card as of 2026-07-28.",
  "evidence": []
}
```

That is a correct, shippable answer. Inventing €45,300 with no record behind it is a
production incident, not a rough estimate.

When knowledge exists:

```json
{
  "claim": "EU Blue Card salary threshold for IT professionals in Germany",
  "value": { "amount": 43759.80, "currency": "EUR", "period": "year" },
  "confidence": "high",
  "evidence": [
    {
      "sourceTier": 1,
      "sourceUrl": "https://<official-portal>/...",
      "ruleId": "de.eu-blue-card.salary-threshold.it",
      "ruleVersion": "2026.1",
      "effectiveFrom": "2026-01-01",
      "retrievedAt": "2026-07-14T09:12:00Z"
    }
  ]
}
```

## Prohibitions

- **No claim without provenance.** If it cannot be cited, it is not stated.
- **No filling a gap with a plausible value.** Not a default, not an average, not "typically."
- **No confidence inflation.** Tier-4 community data never reports `high`, no matter how
  consistent it looks.
- **No legal, immigration, medical, or financial advice.** Zentavio reports sourced rules
  and their implications, and says who to consult.
- **No LLM call outside `ai/`.** That boundary is what keeps the model replaceable.
- **No persistent state in an AI service.** Nothing in `ai/` owns a table or a cache of
  record.
- **No prompt that asks the model to "use its knowledge" of a fact domain.** Retrieval
  first, always.
- **No silent model or prompt change.** Prompt versions are recorded with the outputs they
  produced; an output must be reproducible.

## Retrieval discipline

1. Resolve the entities in the question (person, skill, career, company, country).
2. Retrieve the facts from `knowledge-engine/` — with their versions and tiers.
3. Reason **only** over what came back. Note explicitly what was missing.
4. Produce value + confidence + evidence, with the missing pieces named.
5. Record the prompt version, model, knowledge versions, and computed timestamp.

If step 2 returns nothing, the answer is "unknown, and here is what we would need." That is
a product feature: it tells the user which gap to close, and it tells us which source to add.

## Confidence rules

| Situation | Confidence |
|---|---|
| Tier-1 source, current version, complete data | `high` |
| Tier-2 source, or tier-1 slightly stale | `medium` |
| Tier-3/4 source, or aggregate with wide variance, or partial data | `low` |
| No source | not a claim — `status: unknown` |

Confidence degrades to the weakest input. A recommendation built on one `low` fact is a
`low`-confidence recommendation, however strong everything else is.

## Related

- `knowledge-sources.md` — the tier ranking that drives confidence
- `product-principles.md` — explainability as a product rule
- `docs/prompts/conventions.md`, `docs/prompts/evals.md`
- Skills: `prompt-engineering`, `knowledge-engine`, `ai-matching`
