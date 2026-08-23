# matching

> **Purpose:** User-to-job match scoring service (TypeScript/NestJS).

_Structure placeholder — no implementation yet. What it will hold, and what is blocking it, is below._

## The purpose line said Python/FastAPI, and that was wrong

ADR-0003's Decision is unambiguous — *"All AI capability services under `ai/` are written in Python
with FastAPI; every other runtime unit is TypeScript"* — and it names `services/matching` in its own
**Affects** list. No sibling service README carries a language parenthetical. The line was a pre-ADR
scaffolding artifact, corrected rather than left for whoever runs `nest generate` and finds a FastAPI
purpose line waiting.

The score being "AI" does not make the service Python. **The number is arithmetic**
(`.claude/skills/ai-matching/SKILL.md`): a model may write prose from computed evidence, and that
call lands in `ai/`, behind HTTP, like every other model call.

## Why it is still empty

Not for lack of inputs on the skill axis — `profile_skills`, `job_posting_skills` and
`skill_edges.transfers_to` all exist and are populated. It is empty because
`docs/features/job-matching.md` specifies thirteen signals, five have no input at all, and one of the
five is declared a **hard constraint**.

**Work authorization cannot be evaluated for any stored posting.** `job_postings.country_code` is
null across the corpus, and by design: ADR-0033 forbids mining a country out of location text, and
Lever states none. So the constraint the feature doc says must be named and lead the UI is not merely
unevaluated — it is unevaluatable, and no code here changes that.

Writing the first line of scoring forces an answer to *"may a number exist when eight signals were
never consulted?"*, and `ck_matches__score_iff_scored` makes that answer permanent once rows are
written. **ADR-0037 is that decision.** Read it before implementing anything in this directory.

## Related

- ADR-0037 — what the first match may claim; **the blocking decision**
- ADR-0036 — never-extracted versus extracted-and-empty, which matching must not collapse
- ADR-0003 — the language, and why
- `docs/features/job-matching.md`, `docs/database/entities/match.md`, `docs/GLOSSARY.md`
- `.claude/skills/ai-matching/SKILL.md` — the output contract every score obeys
