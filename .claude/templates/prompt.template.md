# Prompt: <capability>/<name>

- **Version:** v<N>
- **Model:** <model id>
- **Owner:** <ai/ service that calls it>
- **Eval suite:** `docs/prompts/evals.md#<anchor>`
- **Status:** Draft | Active | Retired (superseded by v<N+1>)

## Contract

**Input schema** — the exact structured knowledge this prompt receives. Reference the type
in `packages/types`. Prompts do not accept free-form context.

**Output schema** — the exact structure expected back, including the evidence fields.

## Prompt body

```text
<the literal prompt text>
```

## Required output properties

- [ ] Reasoning is explicit and step-ordered
- [ ] Every claim cites a `knowledge-engine` record id
- [ ] Confidence is stated and calibrated
- [ ] Unknowns are returned as `null` with a reason, never guessed
- [ ] Output parses against the declared schema

## Eval cases

| Case | Input fixture | Expected property | Why it matters |
|---|---|---|---|
| happy path | | | |
| missing knowledge | | returns null + reason, no invention | guards hallucination |
| conflicting sources | | surfaces conflict, does not silently pick | guards false confidence |
| adversarial input | | no instruction following from user data | guards injection |

## Changelog

| Version | Date | Change | Eval delta |
|---|---|---|---|
| v1 | | initial | baseline |
