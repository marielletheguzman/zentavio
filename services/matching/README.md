# matching

> **Purpose:** User-to-job match scoring service (TypeScript/NestJS).

**What is built:** `skill-fit-v1`, and it is the only scorer that exists. **There is no Job Match
Score**, and adding one is a decision rather than a feature (ADR-0037).

## Skill Fit is one axis of thirteen, and its name says so

`docs/features/job-matching.md` defines thirteen signals. Five have no input at all, and one of the
five — **work authorization** — is declared a *hard constraint*: a posting somebody cannot legally
take must carry a named constraint that leads the UI, never a quiet down-rank.

That constraint is **not evaluated**: the eligibility evaluator exists (`ai/career-roadmap`) and is
not wired to postings, and four other signals — seniority, location preference, sponsorship
registries, settlement pathways — have no input at all.

*Corrected 2026-08-23.* This README originally said the constraint was **unevaluatable**, because
`job_postings.country_code` is null. The first live fetch showed that claim was generalised from the
three-posting fixture: Lever states a country on **311 of 383** live postings (81%), and the fixture's
three are among the 19% that do not. ADR-0033 still forbids *inferring* a country from
`"Arlington, TX"` — that was never why the field was empty. See ADR-0037's Correction.

The decision stands and the gap is smaller than it was described. A number computed today still omits
a constraint nobody consulted, and that number is not the Job Match Score under a shorter name. Skill
Fit answers a narrower question honestly instead:

> how much of what this posting asks for does this person hold, or hold something that transfers?

The precedent is ADR-0022, which refused a composite viability score because **a single number cannot
carry a refusal**. The difference here is that one axis genuinely is computable, so it is named
rather than skipped.

**Do not rename this into "Job Match Score v1."** That undoes the decision. When authorization is
actually evaluated, a Job Match Score is added *beside* Skill Fit rather than redefining a number
people have already seen.

## The number is arithmetic

Retrieve → score → record. Facts come from `packages/db` with their provenance, the score is a pure
function, and the row carries the versions that make it re-derivable. **No `ai/` call happens in the
scoring path.** A model that produces a score is not reproducible, not calibratable and not
defensible (`.claude/skills/ai-matching/SKILL.md`); a model may later write prose *from* the computed
evidence, and that is a separate change behind HTTP in `ai/`.

## TypeScript, not Python

This README used to say *"(Python/FastAPI)"*. ADR-0003's Decision is unambiguous — *"All AI
capability services under `ai/` are written in Python with FastAPI; every other runtime unit is
TypeScript"* — and it names `services/matching` in its own **Affects** list. The score being "AI" does
not make the service Python, because the score is not a model output.

## Two rows can be `unknown`, for opposite reasons

`status = 'unknown'` never means a bad fit — it means no number exists, and `missing` says which
absence it was:

| `extracted_version` | Requirements | Why | What it asks of us |
|---|---|---|---|
| null | none | we have not read this posting (ADR-0036) | run extraction |
| set | none | we read it; it asks for nothing curated | curate the skill, or nothing |

**A posting asking for nothing is not a perfect fit.** Weighted coverage over an empty requirement
set has no denominator, and inventing `1.0` would make the least informative posting in the database
the best match in it. The second row is the common case today — the whole corpus is three Lever demo
postings whose qualifications read *"be smart"*.

## What has no trigger

`scorePostingForUser` is a function. Nothing calls it: what schedules scoring is a deployment
decision and nothing is deployed (ADR-0015, ADR-0021), the same boundary `runDueJobBoards` and
`extractDuePostings` sit behind.

## Related

- ADR-0037 — what the first match may claim; **read before changing anything here**
- ADR-0022 — the precedent: a composite that cannot carry a refusal is not computed
- ADR-0036 — never-extracted versus extracted-and-empty
- ADR-0030 — why a claimed skill is worth less than an evidenced one
- ADR-0003 — the language, and why
- `docs/features/job-matching.md`, `docs/database/entities/match.md`, `docs/GLOSSARY.md`
- `.claude/skills/ai-matching/SKILL.md` — the output contract every score obeys
