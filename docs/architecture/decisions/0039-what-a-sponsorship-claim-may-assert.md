# ADR-0039: Sponsorship is a four-value status carried by an explicit statement, extracted only from a statement of availability and never from the topic being mentioned

- **Status:** Proposed
- **Date:** 2026-08-23
- **Deciders:** project lead
- **Affects:** `packages/db` (`job_postings`, `employer_sponsorship_facts`), `services/ingestion`, `services/matching`, `docs/features/migration-friendly-jobs.md`, `docs/database/entities/job.md`, `connectors/`

## Context

`docs/roadmap/backlog.md` names the jobs discovery surface as the consumer of everything #141–#162
built, and `docs/features/migration-friendly-jobs.md` already specifies the feature in detail — the
four-value semantics, the source tier order, *"Employers sponsor. Governments grant."*, and *"never
infers sponsorship from silence"*.

**What the spec does not settle is where a value comes from**, and that question collides directly
with ADR-0033.

### The collision

ADR-0033 forbids reading facts out of posting prose. Salary, country and remote scope are stored only
when the source states them structurally, because a parsed guess inherits into every score derived
from it. `salary_is_stated` is false on all 239 stored postings precisely because that rule holds.

`migration-friendly-jobs.md` then expects `stated_available` from *"the posting or employer says
so"* — which is prose. Either sponsorship is an exception to ADR-0033, or it is not readable from a
posting at all, and the feature's dominant source disappears.

ADR-0035 already resolved this shape once for skills: prose **may** be read, but what it produces is
`description-extraction` carrying a verbatim span, never `stated-requirement`, and never `is_required`
from prose. The question here is what the equivalent line is for sponsorship, where the cost of being
wrong is different in kind.

### What the real corpus actually contains

Measured against the 239 Zoox postings ingested 2026-08-23, the first genuine board this repository
has stored:

| | |
|---|---|
| postings whose prose contains `sponsor*` | **2** |
| postings mentioning `visa` | **1** |
| postings mentioning `relocat*` | **2** |
| distinct postings matching any of the three | **3 of 239 (1.3%)** |
| `company_id` populated | **0 of 239** |
| `company_name_raw` populated | **0 of 239** |

And the three spans, verbatim:

1. *"…partnering with stakeholders across engineering and earning executive **sponsorship**."*
2. *"…often involving complex compensation, negotiation, and **relocation** strategies."*
3. *"This role is initially based in the UK, with a mandatory requirement to relocate to Foster City…
   Continued employment in this position is contingent upon obtaining valid US work authorization and
   **visa** eligibility. Company **visa sponsorship** and **relocation** assistance details will be
   provided during the interview process."*

**Two of the three are the wrong sense of the word.** "Executive sponsorship" is stakeholder buy-in.
"Relocation strategies" describes a recruiter's job, not a benefit offered. This is the `Go` failure
again — a keyword matching ordinary English — and it is worse here, because a false `stated_available`
tells somebody a job solves their immigration problem when it does not.

**The one genuine span still does not state availability.** It says details *will be provided*, and
pairs that with employment being *contingent on the applicant obtaining* authorization — which reads
closer to a requirement placed on the candidate than an offer made by the employer.

So on a real 239-posting board: **a strict reading yields zero `stated_available` values, and a naive
keyword reading yields two false positives and one overstatement.** `unknown` is not merely the
dominant value the spec predicted; it is very nearly the only honest one.

### The second blocker: sponsorship is an employer property, and employers do not resolve

`migration-friendly-jobs.md`'s tier-1 source is an official sponsor register — keyed to an *employer*.
`employer_sponsorship_facts` is designed in `data-retention.md` and **does not exist**. Neither does a
join key: `company_id` and `company_name_raw` are null on all 239 postings, because a Lever board
publishes a slug rather than an employer and ADR-0034 forbids resolving a slug to a company.

**The strongest source in the spec's own tier order is unreachable**, and will stay unreachable until
employer resolution exists. Any decision here that assumes the registry path is available is deciding
against a capability the repository does not have.

## Options considered

### Option A — Alias/keyword extraction, as the skill scan does

**Pros.** The machinery exists and is proven; `skill_aliases` plus corroboration already runs over
every posting.

**Cons.** The evidence rejects it. Two of three matches on a real board are the wrong sense, and
corroboration cannot save them — "executive sponsorship" sits in a sentence about stakeholders, and no
neighbouring token disambiguates it. A skill false positive costs a misleading gap; a sponsorship
false positive costs an application, a visa timeline, and possibly a move.

### Option B — Model extraction with a span, per ADR-0018's division

**Pros.** The correct long-term shape: a model proposes the span, code decides the status. Handles the
ambiguity of span 3, which no pattern will classify well.

**Cons.** No model is configured, and there is no eval corpus — three spans in 239 postings cannot
support the six required eval kinds (`ai/shared/evals/cases.py`). Building the model path first means
shipping an unevaluated classifier on the highest-stakes field in the product. It is the second step,
not the first.

### Option C — Explicit statement of availability only, deterministic, `unknown` otherwise

Sponsorship is stored on the posting as a **four-value status with a verbatim span**, and a value
other than `unknown` requires a sentence that **states the employer's own position on providing it**.
Mentioning the topic is not a statement. Requiring it of the candidate is not an offer.

**Pros.** Precision over recall on the field where a false positive is most expensive, matching
`ai-principles.md`'s *"prefer being under-confident to over-confident"*. `unknown` is already designed
as the dominant, first-class path, and the UI is specified around it. Deterministic, so a stored value
is reproducible from `extractor_version` the way `job_posting_skills` is. Leaves Option B as a clean
later addition behind `prompt_version`, exactly as ADR-0035 left it for skills.

**Cons.** On today's corpus it stores `unknown` for 239 of 239 postings, which looks like a feature
that does nothing. Recall will stay low even on boards where sponsorship is genuinely discussed,
because employers phrase it loosely. It is honest and unimpressive, and that combination is hard to
keep once someone wants a demo.

### Option D — No posting-level extraction; employer registry facts only

**Pros.** Tier 1 in the spec's own order, verifiable, and about the actor who actually sponsors.

**Cons.** **Blocked, not merely harder.** No employer resolution exists, `employer_sponsorship_facts`
has no table and no join key, and no connector reads any register. Choosing this is choosing to ship
nothing until three unbuilt things land.

### Option E — Do nothing; leave sponsorship out of the jobs surface

**Pros.** No overclaim. Skill Fit alone still ranks jobs.

**Cons.** *"A high-paying role with no sponsorship is not actionable for a non-EU applicant. Skill fit
alone ranks jobs the user cannot take, which is the failure this feature exists to prevent"* — the
spec's own opening. It also leaves the surface answering the narrower of the two questions its users
have.

## Decision

**Option C, proposed.** Sponsorship, relocation support and immigration assistance are each stored as
a **four-value status** — `stated_available`, `stated_unavailable`, `inferred_likely`, `unknown` — on
the posting, and **any value other than `unknown` requires a verbatim span in which the employer
states its own position on providing that benefit.**

Three rules follow, and they are what the constraints must enforce:

1. **A mention of the topic is not a statement of availability.** "Executive sponsorship", "relocation
   strategies", "visa eligibility" as a candidate requirement — all `unknown`.
2. **A statement about the candidate's obligation is not an employer offer.** *"contingent upon
   obtaining valid US work authorization"* is a requirement placed on the applicant.
3. **`inferred_likely` may not be written from prose at all.** It is reserved for registry membership
   or aggregated outcomes — employer-level sources that do not exist yet — so nothing in this
   repository may produce it until they do, the way ADR-0035 reserved `stated-requirement`.

**`employer_sponsorship_facts` is not built by this decision.** Its key does not exist. Employer
resolution is its prerequisite and belongs to its own slice.

## Consequences

**Accepted costs.** The feature stores `unknown` for essentially every posting on the corpus that
exists, and the jobs surface will show a column that is almost entirely empty. That is the honest
state and the UI is already specified to render it — but it will read as an unfinished feature, and
the pressure to loosen rule 1 will be real and recurring. It also means the migration-friendly filter
cannot be demonstrated on Zoox; demonstrating it needs a board where employers state sponsorship,
which is an argument for choosing the *next* board deliberately rather than for weakening the rule.

**Follow-up work.**
1. Columns on `job_postings` for the three statuses, each paired with a span column, with a CHECK that
   a non-`unknown` status requires its span — the `ck_jpsk__extracted_has_span` pattern.
2. A CHECK refusing `inferred_likely` until an employer-level source exists, plus a test asserting the
   absence, mirroring ADR-0035's `stated-requirement` test.
3. Deterministic extraction in `services/ingestion`, versioned, re-running through ADR-0036's marker.
4. The three real spans above as the first regression cases — two must yield `unknown`.
5. `migration-friendly-jobs.md` updated to say where `stated_available` comes from, since it currently
   says "the posting says so" without saying what counts as saying so.

**Reversal cost.** Low while the columns hold only `unknown`. It rises the moment real values are
stored and a UI renders them, because loosening the rule later silently reclassifies rows written
under the stricter one — so the version stamp matters from the first row. The signal that would say to
revisit: a board where employers state sponsorship plainly and this rule still yields `unknown`, which
would mean the rule is mis-specified rather than the market quiet.

## Compliance

- A non-`unknown` status without a span is refused by CHECK, tested by inserting the forbidden row
  directly rather than only through the extractor.
- No row carries `inferred_likely` while no employer-level source exists; a test asserts it.
- The two wrong-sense spans from Zoox are permanent regression cases yielding `unknown`.
- Nothing writes a sponsorship value from a country, a job title, or an employer's name. Nothing infers
  it from silence (`migration-friendly-jobs.md`, "What it never does").
- The banned phrasings stay banned: no row, label or prompt says an employer provides residency or
  citizenship.

## Related

- ADR-0033 — what a job-board source may state; the rule this decision works within
- ADR-0035 — the same shape for skills: prose may be read, but the claim is bounded and carries a span
- ADR-0018 — the model/code division that Option B would use later
- ADR-0034 — why a board slug is not an employer, which is why the registry path is blocked
- ADR-0037 — Skill Fit, and why the immigration half is not merged into it
- `docs/features/migration-friendly-jobs.md` — the specification this implements, not replaces

---

**Indexing debt.** This ADR is deliberately **not** added to `docs/architecture/decisions/README.md`
or `.claude/context/decisions.md`. Both files currently carry uncommitted rows for ADR-0038, and
editing them here would either drop that work or sweep it into an unrelated commit. Both index rows
are owed once 0038 is committed.
