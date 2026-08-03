# ADR 0019: Outcome recording begins at M2

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** project lead
- **Affects:** `docs/roadmap/mvp.md`, `docs/roadmap/milestones.md`, `docs/database/entities/outcome.md`,
  `packages/db`, `ai/skill-gap`

## Context

`docs/roadmap/mvp.md` lists outcomes as **not cuttable** — "recorded from day one, even though nothing
reads them yet" — and makes "outcomes are being recorded" an exit criterion. `milestones.md` says the
same twice: outcome capture ships in M1 because M7 and M9 are gated on data accumulating, and M1a's
done-when includes "outcome recording is wired here, before anything reads it".

The reasoning is sound and is the reason this ADR exists rather than a quiet scope cut:
**calibration data cannot be backfilled.** A prediction is only checkable against a result if the
prediction was recorded when it was made, so a system that starts recording outcomes late has
permanently lost the window in which its early scores could have been validated.

Building M1a exposed a problem the roadmap could not have seen. `outcomes.kind` is a closed set of
application-lifecycle events — `applied`, `screened`, `interviewed`, `offered`, `rejected`,
`withdrawn`, `accepted`, `started`, `relocated`, `course_completed`, `assessment_passed` — and
**none of them describes "a profile was created"**. The table also carries foreign keys to
`applications` and `companies`, neither of which exists, so it cannot be migrated as documented.

The deeper issue is what the table is *for*. Every row carries `predicted_score`, `predicted_kind`,
`scorer_version` and `knowledge_as_of`: it exists to compare a prediction against what actually
happened. A profile-creation event has neither a prediction nor a result. It would be a row that
calibrates nothing.

So "recorded from day one" was not achievable as written for M1a. M1a produces no predictions with
results — the first prediction with a checkable outcome is an application, and applications begin at
M2.

## Options considered

### Option A — Add a profile-lifecycle `kind`

Extend the closed set with `profile_created` or similar.

**Pros.** Cheapest to implement. Satisfies the letter of "outcomes are being recorded" immediately,
and keeps one table for everything that happens to a person.

**Cons.** Puts a non-predictive event into a column whose entire purpose is comparing predictions to
results. Any aggregate over `kind` then mixes "what happened to an application" with "what happened
to a profile", which is precisely what a closed set exists to prevent — a `kind` that means two
different things cannot be aggregated. It also does not solve the foreign keys, so the table still
cannot be migrated as documented.

### Option B — A separate profile-events table

Leave `outcomes` untouched and add a table for profile lifecycle.

**Pros.** Keeps both tables coherent. Records that a profile was created, if that turns out to
matter.

**Cons.** Creates a table before it has a reader — the rule that kept `career_edges`, `skill_edges`
and `career_skills` unmigrated until M1b needed them, on the grounds that a table created before its
first reader is one whose shape nobody has verified. Nothing in M1a, M1b or M1c reads profile
events, and nothing has asked for them.

### Option C — Outcomes begin at M2

Record nothing now. `applications` and `companies` migrate in M2, and outcome capture ships with
them.

**Pros.** The table stays what it is for. `kind` stays aggregatable. The foreign keys exist by the
time the table does. The calibration window opens at the same moment the first checkable prediction
exists, so nothing is actually lost — there is no M1 outcome to miss.

**Cons.** Contradicts three documented statements, including a not-cuttable item, which is why it
needs an ADR rather than an edit. It also defers the calibration of `CLAIMED_CREDIT` in
`ai/skill-gap`, which records `awaiting: "recorded outcomes in knowledge-engine/outcomes"` and stays
an assumption for longer.

### Option D — Do nothing

Leave the gap undecided and M1a unfinished.

**Cons.** The gap is already documented in `milestones.md` and has blocked M1a from closing for
several slices. An undecided question is not free: it is re-litigated every time someone reads the
milestone.

## Decision

**Option C.** Outcome recording begins at M2, with `applications` and `companies`.

The MVP constraint is not being dropped — it is being attached to the milestone where it can
actually hold. "Recorded from day one" becomes **recorded from the first day there is something to
record**, and M2 cannot exit without it.

## Consequences

**Accepted costs.**

- **Three documents change**, including a not-cuttable row in `mvp.md`. Each now says outcomes begin
  at M2 and why, rather than being silently softened.
- **`CLAIMED_CREDIT` in `ai/skill-gap` stays an assumption longer.** It is already emitted with every
  readiness score alongside its basis and what would replace it, so the assumption is visible rather
  than buried — but it does not become a measurement until M2 data accumulates.
- **The risk the original constraint guarded against is real and now sits on M2.** If outcome capture
  slips again, the calibration window closes for M2's predictions too. The mitigation is that it is
  an M2 exit criterion rather than an aspiration.

**Follow-up work.**

- Migrate `applications` and `companies` in M2, then `outcomes` with its foreign keys intact.
- Record a prediction at the moment it is shown, not when its result arrives — `predicted_score`,
  `predicted_kind`, `scorer_version` and `knowledge_as_of` are only truthful if written together
  with the prediction.
- Revisit `CLAIMED_CREDIT` once enough transitions are recorded to observe the rate rather than
  assume it.
- **M1a closes with this ADR.** Erasure — the other half of its step 10 — is already implemented,
  because retrofitted privacy is a breach already shipped.

**Reversal cost.** Low while nothing reads outcomes. Adding a profile-lifecycle kind or a separate
table later is additive, and no data is lost by not writing rows that would calibrate nothing.

## Compliance

- **`outcomes` is not migrated before `applications` and `companies`.** A migration adding it with
  its foreign keys dropped, or with `kind` extended to a non-application event, contradicts this ADR.
- **M2 does not exit without outcome capture**, and its milestone entry says so.
- **Every recorded outcome carries the prediction it is checking**, or it is not a calibration row.

## Related

- ADR-0009 (evaluation and calibration), ADR-0018 (`CLAIMED_CREDIT` awaits this data)
- `docs/database/entities/outcome.md`, `docs/roadmap/mvp.md`, `docs/roadmap/milestones.md`
- `.claude/context/career-philosophy.md` — why a score without calibration is a claim nobody checked
