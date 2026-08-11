# ADR-0027: A quota is a property of the pathway, never a requirement a person can fail

- **Status:** Accepted
- **Date:** 2026-08-11
- **Deciders:** project lead
- **Affects:** `packages/db` (schema, seed), `connectors/immigration-data/*`, `ai/career-roadmap`
  (read-only), `docs/database/entities/requirement.md`,
  `.claude/skills/immigration/references/countries/ch.md`

## Context

Switzerland's third-country work pathway turns on **Höchstzahlen** — annual quotas set by the
Federal Council and allocated to cantons (Weisungen AIG § 4.2, art. 20 AIG, art. 19–21 VZAE). It is
the first pathway we have read where a quota is a real, operative condition rather than a
footnote.

**It does not fit the shape a requirement has.** `docs/database/entities/requirement.md` states the
invariant plainly: *one evaluable requirement per row*, where evaluable means it can be answered
`met` / `not_met` / `undetermined` **against a person's facts**. A quota cannot be. Nothing the
applicant knows, holds, earns or proves changes whether a canton's allocation is exhausted.

Stored as an ordinary requirement it fails in both directions, and both are the kind of failure this
project has already paid for once:

```text
no value on file       → undetermined dominates → every Swiss verdict is undetermined forever
quota exhausted        → not_met → a blocker → "you did not meet: quota"
```

The second is the ADR-0024 mistake in a new costume. Telling someone they *failed* a capacity limit
is a false statement about them — the same class as telling a degree holder they failed the
experience route, which is why `not_applicable` had to exist.

**The schema has already half-answered this, in two places that disagree.**

| Where | What it says |
|---|---|
| `immigration_pathways.quota jsonb` | a quota is a property **of the pathway** |
| `requirements.kind` CHECK includes `'quota'` | a quota is **a requirement** |

Both have been there since 2026-07-29 and nothing has written to either, so the contradiction has
been invisible. Switzerland is the first country that would write to one of them, and picking the
wrong one is cheap now and expensive later.

**A third fact makes this urgent rather than theoretical.** Switzerland's quota *value* lives in
VZAE Anhang 1 und 2 — an ordinance annex on `fedlex.data.admin.ch`, whose `robots.txt` disallows
`/filestore/*`. We can read that a quota exists and **cannot read its number** (`ch.md`). So the
first quota we model is one whose value we do not have, which means whatever we decide must behave
correctly with the number absent.

## Options considered

### Option A — Store it as a requirement row with `kind: 'quota'`

The CHECK constraint already permits it.

**Cons.** Both failure modes above, immediately. `undetermined` dominance is not a bug to work
around — it is the rule that keeps the product from guessing, and a permanently-unanswerable row
would make every Swiss verdict `undetermined` while telling the user the missing input is one no
person can supply. And with a value, `not_met` produces a blocker naming the applicant as having
failed something that was never theirs to satisfy. Rejected.

### Option B — Store it as a requirement with `kind: 'right'`

`right` already means *reported, never decides* — ADR-0024 excludes rights from dominance, blockers
and `needs_from_user`.

**Pros.** No schema change, no evaluator change, and the non-blocking behaviour is exactly what a
quota needs.

**Cons.** It is a lie about direction. A `right` is *a benefit the statute grants* — an occupation
list that **lowers** a bar. A quota is a constraint that **limits** access. Overloading one to mean
the other would make `kind` mean two opposite things, which is precisely the aggregation problem
ADR-0019 refused when it declined to add a profile event to `outcomes.kind`. Reusing the mechanism
is tempting and the semantics are wrong.

### Option C — The quota lives on the pathway, and the evaluator never sees it

`immigration_pathways.quota` holds it. No requirement row is emitted. The surface renders it as
**context about the destination**, beside the verdict rather than inside it.

**Pros.** It is what the column was created for, and it puts the fact where its subject is: a quota
is a property of the pathway in the same way `stages` and `permanent_residency` are. The evaluator
is untouched — no new `kind` behaviour, no dominance exception, and the jurisdiction-free AST test
keeps passing. **A missing value degrades honestly**: `quota: null` means we have not sourced it,
which is a statement about our coverage rather than a verdict about a person.

**Cons.** The verdict alone no longer tells the whole story — a person can be `met` on every rule
and still not get a permit this year. That has to be visible on the surface, and a surface that
renders the verdict without the pathway context would be misleading by omission.

### Option D — A new verdict dimension for capacity

Eligibility, employability, and a third axis for *is there room*.

**Cons.** ADR-0022 spent this argument: viability is a pair, and the binding constraint is a closed
set. A third axis is a large change to a settled model for one country's mechanism, and the same
information fits in Option C's context. **Revisit only if a second country's quota turns out to
need per-person evaluation** — for example an allocation reserved by occupation, which Switzerland's
is not.

### Option E — Do nothing; model Switzerland without its quota

**Cons.** The quota is the binding constraint for many real applicants: a canton exhausting its
allocation is why a qualified person with a valid offer is refused. Omitting it produces a verdict
that reads as *"you qualify"* when the honest answer is *"you qualify and there may be no room"* —
the same false positive `de-aufenthg` was prioritised to eliminate.

## Decision

**Option C. A quota is a property of the pathway, recorded in `immigration_pathways.quota`, and it
never becomes a requirement row.**

Precisely:

- **`requirements.kind` loses `'quota'`.** The CHECK constraint is narrowed so the wrong choice is
  a database error rather than a code review. Nothing has ever written that value, so no data
  migrates.
- **`immigration_pathways.quota` carries the shape**: that a quota exists, what it is allocated by
  (national, cantonal, occupational), its period, its source and date, and its value **when we
  have one**. `null` means unsourced, and is rendered as unsourced.
- **The evaluator does not read it and is not changed.** A verdict remains a statement about a
  person; capacity is not.
- **The surface renders it as context beside the verdict**, never inside it, and never as something
  the person failed. A verdict of `met` under an exhausted quota reads *"you meet the requirements;
  this pathway's places for the year are taken"* — two true sentences rather than one false one.
- **A quota with no value is still worth recording.** *"This pathway is capped and we have not
  sourced the cap"* is more useful than silence, and it is honest about which part is missing.

## Consequences

**Accepted costs.**

- **A migration to narrow the CHECK constraint**, for a value nothing uses. Cheap now; the point is
  that it stops being available to a future connector author who reaches for it because it is there.
- **The surface gains a concept.** A destination can be fully `met` and still capped, and the design
  has to make that legible without implying failure — harder than one status line.
- **ADR-0026's comparison gains a dimension that is not a requirement state.** A quota cell is
  neither `met` nor `not_applicable`; it is pathway context. That has to be expressible without
  becoming a sixth cell state.
- **Switzerland's quota will be recorded with a null value** for as long as the VZAE annex is
  unreachable, and the surface must not render that as *no quota*.

**Follow-up work.**

- Migration narrowing `ck_req__kind`; `requirement.md` documents why the value left.
- The `quota` shape in `packages/db` — seeded per pathway, sourced and dated like everything else.
- `ch.md`'s open question is answered and the file updated.
- ADR-0026's comparison model states how a capped destination renders.

**Reversal cost.** Low. Re-adding `'quota'` to the CHECK is a migration, and no data would need
rewriting — but doing so means arguing that a person can fail a capacity limit, which is the thing
this decision denies.

## Non-goals

- **No third viability axis.** ADR-0022's pair stands.
- **No evaluator change**, and no new `kind` behaviour. If implementing this requires touching
  `ai/career-roadmap`, it has been implemented wrongly.
- **No inference of a quota's value** from application statistics or any other proxy. Unsourced
  stays unsourced.
- **No queue position, no odds.** *"Places remaining"* is not a probability that this applicant gets
  one, and the product must not imply it can compute one.

## Compliance

- **`ck_req__kind` no longer permits `'quota'`**, and a test attempts to insert one and expects the
  violation — the way every constraint here is verified.
- **No requirement row anywhere has `kind: 'quota'`**, asserted across ingested data.
- **The jurisdiction-free AST test in `ai/career-roadmap/tests/` keeps passing**, unchanged.
- **A pathway with a capped quota and no value renders as capped-and-unsourced**, asserted in the
  view layer — never as uncapped, and never as a failed requirement.

## Related

- ADR-0024 (`not_applicable`, and why telling someone they failed something that was never theirs is
  a false statement), ADR-0022 (viability is a pair), ADR-0019 (why a `kind` that means two things
  cannot be aggregated), ADR-0026 (the comparison this feeds)
- `.claude/skills/immigration/references/countries/ch.md` — the pathway that forced this
- `docs/database/entities/requirement.md`, `docs/architecture/immigration.md`
