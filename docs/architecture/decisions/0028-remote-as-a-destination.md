# ADR-0028: `REMOTE` compares on employability alone, and its eligibility is `not_applicable` rather than unknown

- **Status:** Proposed
- **Date:** 2026-08-11
- **Deciders:** project lead
- **Affects:** `packages/types`, `services/api-gateway`, `apps/web`, `.claude/context/countries.md`,
  `docs/roadmap/milestones.md`

## Context

M4 shows five destinations side by side: DE, LU, NZ, CH and **`REMOTE`**. Four of them now have
ingested rules. `REMOTE` has no dimension model at all, and it is the last thing standing between
M4 and its surface.

**It is already decided that `REMOTE` is not a country.** `.claude/context/countries.md`:

> `REMOTE` is a first-class target but modelled differently: **no jurisdiction, no pathway**. Its
> constraints are employer policy, time zone overlap, contracting and tax treatment, and payment
> mechanics. For a Philippines-based user it is often the *correct* answer and the fastest one, so
> it never renders as a country with an empty visa section.

And `business.md` makes it a first-class target rather than a fallback: *"earning in a stronger
currency without relocating is often the fastest real improvement available."*

**So the question is not whether `REMOTE` appears. It is what its cells mean.** A comparison table
invites symmetry, and symmetry here would be a lie in a specific direction: rendering `REMOTE`'s
immigration row as empty implies we failed to source something, when in truth there is nothing to
source.

**The distinction M4 already turns on makes this precise.** ADR-0026 fixed five cell states, and two
of them are the ones at stake:

| State | Means |
|---|---|
| `unknown` / `unmodelled` | **we** have not sourced it — a statement about Zentavio |
| `not_applicable` | the dimension does not apply — a statement about the destination |

Switzerland established that a system must be able to say *"we cannot determine this"* without it
becoming failure. `REMOTE` is the complementary case: a system must be able to say *"this does not
apply"* without pretending data is missing.

**One further fact shapes everything below, and it is not a coverage gap.** `REMOTE`'s constraints —
employer policy, time-zone overlap, contracting and tax treatment, payment mechanics — are
properties of **an employer and a contract**, not of a place. No authority publishes them, because
there is no authority: there is no Remote Ministry of Labour. This is a **category difference**, not
a sourcing backlog, and `backlog.md` already records the one piece that could be sourced —
*"Remote-work tax and contracting reality — what do I actually keep?"* — as **later**, not M4.

## Options considered

### Option A — Model `REMOTE` as a country with an empty pathway

A `remote.*` pathway with no rules.

**Cons.** It produces `unmodelled` for every immigration cell, which is the exact false statement
this decision exists to prevent: *unmodelled* means rules exist and we have not ingested them. It
also directly contradicts `countries.md` — *"it never renders as a country with an empty visa
section"* — and would let a future connector be written against a pathway that describes nothing.

### Option B — Omit `REMOTE` from the comparison

Show four countries; mention remote separately.

**Cons.** `business.md` makes `REMOTE` first-class precisely because it is *frequently the right
answer* for this product's primary user. A comparison of relocation destinations that silently
excludes the option most likely to be correct is worse than one that includes it honestly. Rejected.

### Option C — Give `REMOTE` its own dimensions and populate them

Model employer policy, time zones, contracting, tax.

**Pros.** It is the fullest answer, and eventually right.

**Cons.** **Nothing can source it at destination granularity.** These are per-employer and
per-contract facts; a value for "REMOTE's tax treatment" would be a fabrication averaged over
circumstances that differ per person. `backlog.md` places the one tractable piece in *later*. Doing
it now would mean inventing data to fill a table, which is what M4's verification exists to catch.

### Option D — `REMOTE` compares on employability, and declares its other dimensions inapplicable or unsourced

The eligibility axis is **`not_applicable` by construction**. The employability axis is **exactly the
one every country uses** — readiness against a career track, which `ai/skill-gap` computes with no
knowledge of jurisdiction. `REMOTE`'s own dimensions are **named and marked unsourced**, not
invented.

**Pros.** Every cell is a true statement. It needs no new data, no new connector, and no evaluator
change. It renders `REMOTE` as what it is: the destination where the rules do not apply and the
readiness question is identical.

**Cons.** The row looks sparse beside four countries with ingested rules. That is honest, and the
surface has to make sparse-because-inapplicable look different from sparse-because-unsourced.

## Decision

**Option D.** `REMOTE` is a **single destination of a different class**. Its eligibility axis is
`not_applicable`; its employability axis is the same one every country uses; its own dimensions are
declared and unsourced.

Precisely:

- **`REMOTE` has no pathway and never gains one.** No `remote.*` row in `immigration_pathways`, no
  requirements, no connector. A pathway describing nothing is worse than no pathway.
- **Every immigration dimension is `not_applicable`**, and that is a fact about `REMOTE` rather than
  about our coverage. It must never render as `unknown`, `unmodelled` or blank.
- **Employability is fully applicable and already computed.** Readiness against a career track has
  no jurisdiction in it, so `REMOTE`'s employability cell is as real as any country's — and for many
  users it will be the *only* complete row on the screen.
- **Its own dimensions are named, not populated**: employer policy, time-zone overlap, contracting
  and tax treatment, payment mechanics. Each renders `unknown` **with the reason that they are
  properties of an employer rather than of a place** — a different sentence from "not sourced yet",
  and the surface says which.
- **`REMOTE` is one destination, not a class of them.** Sub-dividing it would require employer-level
  data, which is M4+ and which `backlog.md` already sequences.

### Its binding constraint is drawn from a narrower set

ADR-0022's closed set is `eligibility` · `employability` · `recognition` · `unmodelled` · `none`.
For `REMOTE`:

| Constraint | Applies? |
|---|---|
| `employability` | **yes** — the only one that can bind |
| `none` | **yes** — ready, and nothing else to satisfy |
| `eligibility` | **never** — there are no rules to fail |
| `recognition` | **never** at destination level; a licence question belongs to whoever employs |
| `unmodelled` | **never** — it would assert rules exist |

**No new binding constraint is added.** `REMOTE` uses a subset of the existing closed set, which is
what keeps ADR-0022 intact and the union free of a member meaning *"not that kind of thing"*.

### Grouping under ADR-0026

`REMOTE` groups by its binding constraint like every other destination — usually `employability` or
`none`. **It is not given its own group**, and it is not pinned to a position. A destination with
fewer applicable dimensions must not sort better or worse for that reason: *more known data ≠ better
destination.*

## Consequences

**Accepted costs.**

- **The surface must render two kinds of sparse differently.** `not_applicable` and `unknown` look
  alike in a table and mean opposite things, and getting that wrong is the failure this ADR exists
  to prevent.
- **`REMOTE`'s own dimensions stay empty for now**, with a stated reason. A user asking *"what do I
  actually keep?"* is not answered by M4, and `backlog.md` is where that is sequenced.
- **`REMOTE` will often look like the strongest row** — the only one with no unresolved rules — and
  that must not be read as a recommendation. ADR-0026 forbids the ranking that would express it.

**Follow-up work.**

- The comparison shape carries a destination **class**, so the surface can tell a country from
  `REMOTE` without inferring it from a missing pathway.
- `countries.md` gains this decision beneath its existing `REMOTE` paragraph.
- Coverage verification includes a `not_applicable` case, per M4's gate.

**Reversal cost.** Low. Giving `REMOTE` real dimensions later is additive — the class already
distinguishes it, and the dimensions are named. Reversing the other way, after users have compared
against a fabricated remote row, is not.

## Non-goals

- **No `remote.*` pathway, ever**, and no connector for one.
- **No invented dimension values** to make the table symmetrical.
- **No new binding constraint member**, and no change to ADR-0022's pair.
- **No sub-classes of `REMOTE`** — that needs employer data, which is M4+.
- **No ranking**, and specifically no advantage for having fewer unresolved cells.

## Compliance

- **No pathway row with a `remote` jurisdiction exists**, asserted against seeded data.
- **`REMOTE`'s immigration cells are `not_applicable`**, never `unknown` or `unmodelled`, asserted
  in the comparison's tests.
- **`not_applicable` and `unknown` render differently**, asserted in the view layer — the same test
  shape ADR-0026 requires for a capped-and-unsourced quota.
- **`REMOTE` is grouped by binding constraint like any destination** and holds no reserved position,
  asserted by reordering the input and expecting the output unchanged.
- **The jurisdiction-free AST test in `ai/career-roadmap/tests/` keeps passing.** `REMOTE` needs no
  evaluator change; if implementing this requires one, it has been implemented wrongly.

## Related

- ADR-0026 (the comparison this completes — and the five cell states), ADR-0022 (viability is a
  pair), ADR-0027 (the other case where a fact belongs to the destination rather than the person)
- `.claude/context/countries.md` — `REMOTE` as first-class and not a country
- `.claude/context/business.md` — why it is often the correct answer
- `docs/roadmap/backlog.md` — where remote tax and contracting reality is sequenced
