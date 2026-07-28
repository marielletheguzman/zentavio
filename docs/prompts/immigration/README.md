# Immigration Prompts

> **Purpose:** Prompts for pathway explanation.

The strictest prompts in the system. A wrong threshold or a stale rule sends someone into a failed
application or a collapsed relocation, so the model's role here is deliberately minimal: it **restates
retrieved rules in plain language** and nothing else.

Prompt files live at `ai/career-roadmap/prompts/` (eligibility lives with the roadmap service).

## What the model does not do

| Never | Where it happens instead |
|---|---|
| decide eligibility | deterministic code over retrieved rules (`docs/architecture/immigration.md`) |
| state a threshold, quota, or timeline from memory | retrieved from `immigration_rules`, tier 1 only |
| infer one country's rule from another's | nowhere — each jurisdiction has its own sourced rows |
| predict an approval | nowhere |
| give advice | nowhere |

**No prompt is in the eligibility path.** Rules are evaluated by code; the prompt receives the already-
evaluated result and describes it.

## Prompts

| Prompt | Job |
|---|---|
| `pathway-explain` | plain-language description of a pathway from its retrieved rules and stages |
| `eligibility-narrate` | narrate an already-computed per-rule result |
| `rule-change-notify` | one sentence describing a rule version change |

### `eligibility-narrate`

**Inputs.** `{{ evaluated_rules }}` (each with `result`, `sourceUrl`, `effectiveFrom`),
`{{ needs_from_user }}`, `{{ as_of }}`, `{{ pathway }}`.

**Output.**

```json
{
  "summary": "<plain language>",
  "perRule": [{ "ruleId": "…", "statement": "…" }],
  "nextInput": "<the single most useful thing the user could supply>",
  "asOf": "2026-07-28",
  "disclaimer": "<verbatim, never paraphrased>"
}
```

Constraints:

- **`undetermined` is narrated as undetermined.** Never "you probably qualify", never "you likely meet
  this". The evaluator's three states are preserved exactly.
- **`nextInput` leads when it exists.** One missing salary figure converting an `undetermined` into a
  definite answer is the most actionable output the platform produces.
- **Every rule statement carries its source and date.** The prose cites; it does not assert.
- **`asOf` is always present.** Rules change, and an answer without a date is unverifiable.
- **The disclaimer is emitted verbatim.** The model may not reword, shorten, or "make it friendlier".

### `pathway-explain`

Describes stages, dependent rights, and the permanent-residency and citizenship clocks — strictly from
the retrieved pathway row. Where a rule is `contested`, the ambiguity is stated rather than resolved
toward the friendlier reading.

### `rule-change-notify`

Turns a version supersession into one sentence: what changed, when it took effect, and what it means
for the plan the user had. This is among the highest-value notifications Zentavio sends
(`.claude/skills/recommendations/SKILL.md`), and it exists only because rules are versioned rather than
overwritten.

## Language

Prohibited phrasings, because each implies a judgment we have not made:

| Prohibited | Use |
|---|---|
| "you qualify" | "the rules retrieved indicate X is met" |
| "you should apply" | "eligibility under this pathway appears met; confirm with the authority" |
| "you will get" / "approval is likely" | nothing — we do not predict |
| "typically the threshold is…" | the retrieved threshold, or `unknown` |
| "similar countries require…" | nothing — no cross-jurisdiction inference |

## Unknown path

No current sourced rules for the pathway → `status: "unknown"`, with what is missing named. **The prompt
is not invoked.** There is nothing to restate, and inviting the model into that space is exactly how a
fabricated threshold reaches someone planning a move.

A stale rule past its `refresh_after` is narrated with reduced confidence and its date stated, never
silently as current.

## Eval cases

| Case | Guards |
|---|---|
| `happy-blue-card-met` | statements cite `sourceUrl` and `effectiveFrom`; disclaimer verbatim |
| `undetermined-preserved` | `undetermined` never becomes "probably qualify" |
| `needs-input-leads` | the missing input is the headline |
| `unknown-no-rules` | no rules → prompt not invoked |
| `stale-rule-flagged` | past refresh window → reduced confidence, date stated |
| `no-cross-jurisdiction` | Sweden's rules never inferred from Norway's |
| `no-advice-language` | none of the prohibited phrasings appear |
| `no-approval-prediction` | no likelihood claim |
| `contested-stated` | ambiguity surfaced, not resolved |
| `disclaimer-verbatim` | disclaimer not reworded or shortened |

These are the strictest eval cases in the repository, and a regression on any of them blocks regardless
of other improvements (`../evals.md`).

## Related

- `docs/architecture/immigration.md` — rules as data, deterministic evaluation
- `.claude/skills/immigration/SKILL.md`, `.claude/context/countries.md`
- `docs/database/entities/immigration-rule.md`
- `../conventions.md`, `../evals.md`
