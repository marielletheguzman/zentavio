# Person facts

> **Purpose:** The facts a requirement needs about a person — what `needsFromUser` asks for, and
> where the answer goes.

`requirements.needs_input` names what a rule must know. The EU Blue Card salary threshold needs
`expected_gross_annual_salary_eur`; a recognition rule will need a qualification level. That array
produces `needsFromUser` in an eligibility response, which is the most actionable field this product
returns: it converts an `undetermined` verdict into a definite one with a single input.

**Until these tables existed there was nowhere to put the answer**, so the promise could be made and
never kept. M2's milestone test — *"an incomplete profile gets `undetermined` plus the one input
that would resolve it, and supplying it produces a definite answer"* — is unreachable without them.

## Two tables

| Table | Holds | Personal? |
|---|---|---|
| `person_fact_kinds` | the closed catalogue of facts that may be asked, and how to ask | no — shared by every user |
| `person_facts` | what one person answered, versioned | **yes** — hard-deleted on erasure, all versions |

## The boundary with `user_immigration_facts`

`user.md` designs a separate, still-unbuilt `user_immigration_facts` — citizenship, residence,
permits, recognition status — **isolated on purpose**: column-level encrypted at rest, separate
access, separate audit, never joined into a general profile read. `ai-memory-policy.md` depends on
that isolation.

These are not the same table, and merging them would be a privacy regression rather than a
simplification — it would move citizenship out of an encrypted, separately-audited store into a
general one.

The line is **status versus circumstance**:

| | `person_facts` | `user_immigration_facts` |
|---|---|---|
| Holds | what a rule compares against — expected salary, qualification level, language level | what a person's legal position *is* — citizenship, residence, permits |
| Discloses | pay expectations, education | nationality, legal precarity, family circumstance |
| At rest | plain, `sensitive` flagged per kind | column-level encrypted |
| Access | general evaluation read | isolated, separately audited |

A rule may need facts from both. The evaluator reads them through separate repositories, and only
`user_immigration_facts` carries the encryption boundary.

> **This boundary was drawn when `person_facts` was built (2026-08-04) and is worth confirming.**
> The ambiguous case is qualification recognition, which `user.md` lists under
> `user_immigration_facts` as `qualification-recognition` while a `credential`-domain requirement
> would naturally read it as an ordinary input.

### Why a catalogue rather than a `CHECK` constraint

A `CHECK` holds the closed set but has nowhere to put the value type, the unit, or the question to
ask. That metadata would then live in the web app — duplicated, and free to drift from the rules
that depend on it. The catalogue is the same shape `skills` already uses: a closed set as rows, so
the evaluator stays generic and adding a fact is data rather than a branch.

### The invariant the pair exists to protect

**A key named in `needs_input` must be suppliable.** A rule asking for a fact the catalogue does not
define produces a `needsFromUser` nobody can answer, and the verdict then stays `undetermined`
forever with no action available to the user — a dead end that looks like a working feature.

`fk_person_facts__kinds` enforces it on the answer side, and
`tests/integration/db/person-facts-constraints.test.ts` asserts it across every ingested rule.

> That cross-check is **vacuous today**, because nothing writes ingested requirements to the
> database yet. It is written now because it becomes load-bearing the moment ingestion lands, and
> adding it afterwards means adding it after the first violation.

### A fact is typed at the write boundary

**`value_type` is enforced when the answer is written, not interpreted when it is read.**
`recordFact` loads the kind, checks the value against it with `validatePersonFactValue`
(`packages/types`), and refuses anything that does not satisfy it. The evaluator therefore receives
values that are already what they claim to be, and coerces nothing.

This was not true until 2026-08-11, and the failure is worth keeping written down. The catalogue
held six kinds; the eligibility panel carried its own map of prompts and units that knew about
**one**. Every question added after it rendered as a free-text box, so answering *"no"* to *"do you
hold a recognised degree?"* stored the **string** `'no'` — and `bool('no')` is `True`, so the
qualification rule evaluated **met** for somebody who had just said they had no degree. Four layers,
each assuming another had checked: no control type, no client shaping, no write validation, and a
read that coerced.

What the invariant costs, and why it is worth it:

- **A boolean is `true` or `false`.** `'true'`, `'yes'`, `1` are refused, not coerced. A string that
  means yes to a reader means nothing to a comparison.
- **A monetary answer carries the currency and period its `unit` declares.** The evaluator's own
  unit check only catches a *declared* mismatch; an undeclared one passes as if it agreed.
- **An unknown `value_type` fails closed.** If this table's CHECK constraint gains a type the
  validator does not know, the answer is refused rather than stored unchecked.
- **A surface renders from the catalogue** — served by the gateway at `GET /v1/person-fact-kinds`.
  A prompt, a unit, or a permitted-value list restated in a component is a second source of truth,
  and the drift is silent.

The evaluator refuses a non-boolean for a boolean rule as well, returning `undetermined` rather than
guessing. That is **defence in depth, not the fix**: it exists so a row written before this boundary
did cannot be reinterpreted into a verdict.

## Versioned, never updated in place

The same rule `user_profiles` follows, for the same reason. An eligibility verdict computed against
a salary of 52 000 must remain reproducible after the person corrects it to 48 000. An in-place edit
makes every prior verdict unexplainable while its recorded version is unchanged — worse than having
no history at all, because the record still looks intact.

- `uq_person_facts__current` — exactly one live answer per person per fact. Two current rows would
  make the evaluator pick whichever the query returned first, the same non-determinism
  `uq_req__current` prevents on the rule side.
- `uq_person_facts__version` — dense per `(user, kind)`, never reused, **including after a soft
  delete**. "The salary as it stood at v2" is what an explained verdict is built from; reusing a
  number makes that phrase ambiguous.

## `basis` — how we know

| Value | Means |
|---|---|
| `self_reported` | the person told us. The honest default |
| `derived` | computed from something else on file |
| `verified` | evidenced by a document, with `verified_at` set |

**A self-reported salary is an intention, not a fact**, and a verdict that treats it as evidence is
overconfident in a way that costs someone a relocation. `ck_person_facts__verified` refuses to call
a row verified without a date — a claim about evidence with no evidence. The reverse is allowed: a
verified answer can be superseded by a self-reported correction, and the earlier verification date
remains a true statement about the earlier row.

## Expiry

`valid_until` exists because facts go stale. An expected salary from two years ago is not evidence
about today, and a language certificate may carry its own validity period. Null means no known
expiry; `idx_person_facts__expiry` makes finding the stale ones cheap, so the UI can say a fact needs
refreshing rather than quietly answering from it.

## Retention and erasure

Hard delete, **all versions**, on erasure — `docs/database/data-retention.md`. A superseded salary is
exactly as personal as the live one, and keeping history would make the erasure claim false for
precisely the answers a person most regretted giving.

`person_fact_kinds` is untouched by erasure: it is a catalogue of what may be asked, shared by every
user, and holds nobody's answer.

Foreign keys are `RESTRICT`, not `CASCADE`, like every other user-owned table — deletion order is a
decision recorded in `erasure.ts`, not an emergent property of the schema.

## Invariants

- Every `requirements.needs_input` value has a `person_fact_kinds` row.
- **Every stored value satisfies its kind's `value_type`**, checked at the write boundary. A
  `boolean` kind holds `true` or `false`, never a string that reads like one.
- One live answer per `(user_id, kind_key)`.
- Versions dense per `(user_id, kind_key)`, never reused.
- Never `UPDATE` a value — new version, `is_current` moved.
- `verified` requires `verified_at`.
- An `enum` kind has permitted values; a non-enum has none.
- A `monetary`, `integer`, or `decimal` kind has a unit.
- `person_facts` is hard-deleted on erasure and audited by `hasPersonalData`.

## Related

- `requirement.md` — `needs_input`, and the rules that ask
- `user.md` — the versioning pattern this follows
- `../data-retention.md` — the schedule
- `docs/architecture/immigration.md` — where `needsFromUser` is produced
