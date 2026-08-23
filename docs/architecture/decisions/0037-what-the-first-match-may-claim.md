# ADR-0037: The first thing matching computes is Skill Fit, named for the one axis it measures, and no Job Match Score is stored until its hard constraint can be evaluated

- **Status:** Accepted
- **Accepted:** 2026-08-23
- **Date:** 2026-08-23
- **Deciders:** project lead
- **Affects:** `services/matching`, `packages/db` (`matches`), `docs/features/job-matching.md`, `docs/database/entities/match.md`, `docs/GLOSSARY.md`, `.claude/skills/ai-matching/SKILL.md`

## Context

`services/matching` is the last placeholder between stored postings and a person seeing anything.
Everything it needs on the skill axis now exists: `profile_skills` is populated, `job_posting_skills`
is populated by the alias scan, `skill_edges` carries `transfers_to`, and ADR-0036 made "extracted,
found nothing" distinguishable from "never read".

The blocker is not code. It is that **`docs/features/job-matching.md` specifies thirteen signals and
five of them have no input at all**, and one of the five is declared a *hard constraint*.

### What actually exists, signal by signal

| Signal | Input | State |
|---|---|---|
| Skill match, evidenced / claimed | `profile_skills` × `job_posting_skills` | **exists** |
| Skill transfer | `skill_edges.transfers_to` | **exists** |
| Skill missing | requirement with no cover | **exists** |
| Freshness | `posted_at`, `stale_after` | **exists** (ranking only, never the score) |
| Seniority fit | `job_postings.seniority` | **null everywhere** — Lever states none, and ADR-0033 forbids inferring it |
| Location / remote fit | a preferences table | **does not exist** |
| Language | posting market vs profile languages | needs the posting's market, which is the row below |
| **Work authorization** | eligibility for the posting's country | **unevaluatable** — see below |
| Visa sponsorship status | sponsor registries | no connector, no table |
| Relocation support · Settlement pathway | posting or careers page · destination pathways | not modelled per posting |

### The hard constraint is not merely unevaluated — it is unevaluatable

`job_postings.country_code` is null for every posting in the corpus. Not by accident: ADR-0033
forbids mining a country out of location text, and Lever's `categories.country` is null on all three
fixture postings while their locations read `"Arlington, TX"`, `"Atlanta, Georgia"` and
`"Bombay, MH"`. A human reads those instantly. The connector may not, and that refusal is correct —
it is the rule that stops `"Arlington, TX"` becoming a confident wrong country for somebody choosing
where to live.

So work authorization cannot be evaluated for **100% of stored postings**, and no amount of matching
code changes that. `docs/features/job-matching.md` is explicit about what that constraint is for:

> A posting the person cannot legally take is not quietly down-ranked. It carries a named constraint
> with `binding: true`, and the UI leads with it. Silently burying an ineligible job as "a weaker
> match" is misleading in a way that costs money.

A number computed today omits that constraint entirely — not as a low weight, but as a factor that
was never consulted.

### Why this needs a decision rather than a default

`matches` has `ck_matches__score_iff_scored`: a row is either `scored` with a number or `unknown`
with none. There is no partial state, deliberately. So writing the first matching code forces an
answer to *"may a number exist when eight signals were never evaluated?"*, and the schema will hold
whichever answer is given, permanently and invisibly, once rows are written.

`docs/GLOSSARY.md` has already ruled on the closest question. The **Career Score** entry ends:
*"**Not:** a percentage of skills matched."* A skills-only number is explicitly not one of the six
scores, and labelling it as one is the cross-score substitution `.claude/skills/ai-matching/SKILL.md`
lists under Constraints.

## Options considered

### Option A — Compute the Job Match Score from the skill axis, list the rest in `missing`

**Pros.** Ships the feature. `missing` is already a product surface and would honestly name every
absent signal. Reproducible and explainable on the axis it does cover.

**Cons.** The number is called the Job Match Score and is not one — it omits a hard constraint, and
`missing` is read as *"we could refine this"*, not *"we never checked whether you may legally take
this job"*. It is the failure the feature doc names in its own words. It also fails the glossary's
existing ruling that a percentage of skills matched is not one of the six scores.

### Option B — Every match is `status: 'unknown'` until work authorization is evaluatable

**Pros.** Cannot overclaim. Strictly true today.

**Cons.** Nothing is ever shown, so `services/matching` cannot be built or exercised at all, and the
skill machinery that *does* work stays invisible and untested against real rows. It also treats an
uncomputable composite as a reason to compute nothing, when one axis is genuinely computable —
which is the same conflation in the other direction.

### Option C — Compute **Skill Fit**, named for what it measures; no Job Match Score until its constraints exist

A seventh named score, defined as *"how much of what this posting asks for does this person hold, or
hold something that transfers"*. Stored in `matches` with `scorer_version = 'skill-fit-v1'`, which is
exactly what that column is for: saying which arithmetic produced the number.

`status: 'scored'` is honest because the score's own definition is fully satisfied — every input Skill
Fit names exists. The Job Match Score is simply not computed, and nothing renders one.

**Pros.** The name carries the limitation, so it cannot be misread by a user, a reviewer or a future
query. Follows ADR-0022 exactly: viability refused a composite and shipped the two axes with the
binding constraint named, because *a single number cannot carry a refusal*. Buildable today against
real rows. When authorization becomes evaluatable, Job Match Score is added **beside** Skill Fit
rather than redefining a number people have already seen.

**Cons.** A seventh score in a product whose glossary insists the six be kept distinct — the
confusion risk that glossary exists to fight, made slightly worse. `matches` becomes a table holding
more than one kind of score, so every reader must consult `scorer_version`. Requires glossary,
feature-doc and skill updates in the same change.

### Option D — Do nothing; leave `services/matching` a placeholder

**Pros.** No overclaim, no seventh score, no cost.

**Cons.** Stored postings stay inert, and the extraction work of #152 and #155 has no consumer. The
placeholder does not record *why* it is empty, so the next session re-derives this analysis from
scratch — which is the definition of a lost decision.

## Decision

**Option C.** Matching's first output is **Skill Fit** — one axis, named for itself, stored
with `scorer_version = 'skill-fit-v1'`. **No Job Match Score is computed, stored or rendered** until
work authorization can be evaluated for the posting in question.

The deciding argument is ADR-0022's, applied to a different composite: a single number cannot carry a
refusal, and "we never checked whether you may legally take this job" is a refusal, not a low weight.
The difference from ADR-0022 is that here one axis *is* fully computable — so the honest move is to
name that axis rather than to compute nothing.

## Consequences

**Accepted costs.** A seventh score, and a `matches` table whose rows must be read through
`scorer_version`. Users see a narrower answer than the feature doc promises, and the UI must say
which question was answered. The glossary grows the entry it exists to prevent people needing.

**Follow-up work.**
1. `matches` migration per `docs/database/entities/match.md`, unchanged — its constraints already
   express this ADR.
2. `services/matching` in **TypeScript/NestJS**, not Python — see the correction below.
3. Skill Fit arithmetic: evidenced hold, claimed hold at reduced weight, transfer via `skill_edges`,
   absent as a named negative. Weights from `job_posting_skills.weight`, never a constant per skill.
4. The ADR-0036 read: `extracted_version` null means `status: 'unknown'` with `missing` naming the
   extraction; set with zero rows means a real comparison over an empty requirement set.
5. Glossary entry, feature-doc section, and `.claude/skills/ai-matching/SKILL.md`'s score table.

**A correction this ADR must carry.** `services/matching/README.md` says *"(Python/FastAPI)"*. ADR-0003
is Accepted and its Decision is unambiguous — *"All AI capability services under `ai/` are written in
Python with FastAPI; every other runtime unit is TypeScript"* — and it names `services/matching` in
its own **Affects** list. No sibling service README carries a language parenthetical. The line is a
pre-ADR scaffolding artifact and is corrected here rather than left to be discovered by whoever runs
`nest generate` and finds a FastAPI purpose line.

**Reversal cost.** Moderate and front-loaded. Renaming Skill Fit into Job Match Score later means
migrating `scorer_version` values and re-explaining a number users have seen — which is precisely the
cost this ADR pays once, now, to avoid paying under pressure later. The signal that would say to
reverse: work authorization becoming evaluatable for most postings, at which point Job Match Score is
added beside Skill Fit and the two coexist.

## Compliance

- No row in `matches` carries `scorer_version = 'job-match-v*'` until authorization is evaluated. A
  test asserts the absence, the same way ADR-0035's `stated-requirement` is asserted absent.
- `ck_matches__score_iff_scored` and `ck_matches__evidence_present` are created with the table and
  tested by inserting the forbidden rows directly, not only through the scorer.
- A test asserting a posting with `extracted_version IS NULL` yields `status: 'unknown'` and never a
  score — the ADR-0036 distinction, enforced where it is actually consumed.
- No `ai/` call in the scoring path: the number is arithmetic. A model may later write prose from
  computed evidence (`.claude/skills/ai-matching/SKILL.md`), and that is a separate change.

## Correction — 2026-08-23: the constraint is evaluatable for most real postings

**The decision above is unchanged. Its central factual claim was wrong**, and is corrected here
rather than in place, so that what was believed and what turned out to be true both stay readable.

### What was claimed

> `job_postings.country_code` is null for every posting in the corpus. Not by accident: ADR-0033
> forbids mining a country out of location text, and Lever's `categories.country` is null on all
> three fixture postings […] So work authorization cannot be evaluated for **100% of stored
> postings**.

The first sentence is true of the corpus. **The generalisation to the source is false.**

### What is actually true

The first live fetch this repository has ever performed — `api.lever.co/v0/postings/leverdemo`,
2026-08-23, through the real connector — returned **383 postings, not three**, and Lever states
`categories.country` on most of them:

| | Committed fixture | Live board |
|---|---|---|
| postings | 3 | **383** |
| `country_code` stated | 0 | **311 (81.2%)** |

`US` 226 · `GB` 40 · `NL` 18 · `CA` 18 · `FR` 3 · `IN` 2 · `BE` 2 · `BR` 1 · `PL` 1.

The three fixture postings are among the 19% that state no country. **The claim was generalised from
a three-row sample to the behaviour of the source**, and the ADR presented it as a property of Lever.
ADR-0033 is unaffected and remains correct: nothing may *infer* a country from `"Arlington, TX"`. It
was never the reason the field was empty — the sample was.

Two other claims in the same section held up against the live data: `remote_scope` is stated on **0**
of 383, and `salary_is_stated` on **0** of 383, both exactly as ADR-0033 predicted.

### What this changes, and what it does not

**Does not change:** the decision. Skill Fit is built, correctly named, and answering its own question
honestly. Nothing about it depends on the corrected claim.

**Does change:** the *reason* no Job Match Score exists. The Consequences section named the signal
that would say to revisit — *"work authorization becoming evaluatable for most postings"* — and that
signal has now fired, at 81%. So the honest statement is no longer "it cannot be evaluated" but:

> No Job Match Score exists because **the eligibility evaluation is not wired to postings**, and four
> other signals still have no input at all — seniority, location/remote preference, sponsorship
> registries and settlement pathways. `country_code` is no longer among the blockers.

That is a smaller and more actionable gap than the one this ADR described, and it belongs to a future
decision rather than to this one. **Nothing here authorises building a Job Match Score**; it records
that the road to one is shorter than stated.

### The methodological finding, which outlives both

**A three-row fixture was treated as evidence about a source.** The corpus limit was recorded
honestly in ADR-0035 and repeated in every PR since — and it still produced a wrong premise, because
a limit that is stated is not the same as a limit that is respected in the next inference. The fixture
is a golden file for `normalize`; it was never a sample of what Lever publishes, and nothing in it
claimed to be.

The rule this sets: **a claim about what a source states requires a fetch, not a fixture.** A fixture
answers "does our parser still handle what we captured", and no question about the world.

## Related

- ADR-0022 — the precedent: a composite that cannot carry a refusal is not computed
- ADR-0036 — never-extracted versus extracted-and-empty, which matching must not collapse
- ADR-0035, ADR-0033 — what a posting may claim, and what may never be inferred from prose
- ADR-0003 — the language this service is written in
- `docs/GLOSSARY.md` — the six scores, and why a seventh needs an entry rather than a nickname
