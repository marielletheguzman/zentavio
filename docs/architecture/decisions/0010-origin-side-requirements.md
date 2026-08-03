# ADR 0010: Origin-side requirements and professional recognition

- **Status:** Accepted
- **Accepted:** 2026-07-28
- **Date:** 2026-07-28
- **Deciders:** project lead
- **Affects:** `knowledge-engine/immigration`, `packages/db`, `ai/career-roadmap`, `connectors/immigration-data`, `docs/database/entities/immigration-rule.md`

## Context

Zentavio's primary users are professionals and students from the Philippines
(`docs/roadmap/vision.md`). `immigration_rules.jurisdiction` assumes a single jurisdiction — the
destination — so the model cannot express a requirement imposed by the origin state or by a destination
body that is not the immigration authority.

The consequence is not cosmetic: **nursing, engineering, and teaching cannot be given an eligibility
verdict at all** and must return `unknown`. Those are among the largest Philippines→Europe flows, so the
gap excludes a large share of the intended users from the product's central answer.

### The modelling question underneath

An earlier note in `docs/architecture/immigration.md` suggested a `jurisdiction_role` column
(`origin | destination | bilateral`). That is the smallest change, and it conflates four different things
under a table whose name says "immigration":

| Requirement | Decided by | Not immigration because |
|---|---|---|
| Work permit eligibility | destination immigration authority | — |
| **Professional licence recognition** | destination **regulatory body** (e.g. a nursing board) | a different authority, a different process, a different timeline |
| **Academic credential evaluation** | destination **evaluation body** | assesses an origin qualification against a national framework |
| **Overseas employment clearance** | **origin** labour authority | imposed by the country being left, not entered |
| Document authentication | origin authorities (apostille chain) | a precondition to the others |

They share a *structure* — tier-1 sourced, dated, versioned, one requirement per row, evaluable to
`met` / `not_met` / `undetermined`, with `needs_input` — and they differ in *who decides*. The decision is
whether that shared structure justifies one table, and if so, what it is honestly called.

**The recognition case is the sharp one:** a destination can be visa-accessible while a licence is not
transferable without re-assessment. Reporting eligibility without recognition would be actively
misleading to exactly the users least able to absorb a wrong answer.

## Options considered

### Option A — Add `jurisdiction_role` to `immigration_rules`

**Advantages.** Smallest diff. One table, one evaluator, one provenance model. No rename, so no other
document changes. Ships fastest.

**Disadvantages.** The table's name becomes false: it would hold requirements set by a nursing board and by
an origin labour authority, neither of which is immigration. That matters because the name is what the next
contributor reasons from — and a mis-named table is how a recognition rule ends up evaluated as a visa
rule. It also has no place to record *which* authority decides, so "who do I contact?" is unanswerable, and
that is one of the most useful things this feature could tell someone.

### Option B — Separate tables per domain

`immigration_rules`, `recognition_rules`, `credential_evaluations`, `origin_clearances`.

**Advantages.** Each table is honestly named and can hold domain-specific columns. Clear ownership.

**Disadvantages.** Four tables with near-identical structure means four provenance implementations, four
versioning implementations, and four evaluators — and the thing users actually need, *which constraint
binds*, would have no home, because it is a comparison across all four. Adding a fifth domain later means a
fifth table. The duplication is the problem, not the separation.

### Option C — One `requirements` table, generalized and renamed

Rename `immigration_rules` → `requirements`, and add:

```text
domain      immigration | recognition | credential | authentication | language | employment_clearance
imposed_by  origin | destination | bilateral
authority   the body that decides, with its official source
```

**Advantages.** One structure, because the structure genuinely is shared: sourcing, dating, versioning,
one-requirement-per-row, and `needs_input` are identical across all five domains. One evaluator, so
"which constraint binds" is a single ordered pass. `authority` makes "who decides, and who do I contact?"
answerable — currently impossible. `domain` preserves the distinction that matters for display and for the
disclaimer wording. A sixth domain is a new enum value, not a new table.

**Disadvantages.** A rename touching roughly six documents. The table becomes broader, so a reviewer must
read `domain` to know what a row means. Some domain-specific fields end up nullable or in `jsonb` —
recognition needs a re-assessment route, credential evaluation needs a framework level, and neither
applies to a visa threshold.

### Option D — Full requirement supertype with per-domain child tables

**Advantages.** Normalized: shared columns in the parent, domain-specific columns typed in children.

**Disadvantages.** Every read becomes a join, and the evaluator must know which child to load per row.
Substantially more schema for a product with no code yet, and the domain-specific columns are few enough
to sit in `jsonb` with a documented shape. Right answer at ten domains; over-engineered at five.

### Option E — Do nothing; keep returning `unknown` for regulated professions

**Advantages.** Honest today, and costs nothing. The interim rule is already documented and correct.

**Disadvantages.** Permanently excludes nursing, engineering, and teaching from the product's central
answer. It also pushes the decision behind the first migration, and once `immigration_rules` exists with
data in it, a rename stops being free — which is the specific reason to decide now rather than later.

## Decision

**Option C — one `requirements` table, generalized and renamed, with `domain`, `imposed_by`, and
`authority`.**

Two reasons decide it.

**The shared structure is real, and the differences are small.** All five domains need tier-1 sourcing,
effective dating, version chains, one evaluable requirement per row, and `needs_input`. That is the
expensive machinery, and duplicating it four times (Option B) is how the four copies drift.

**Renaming is free exactly now and never again.** No migration exists, no code reads the table, and the
only cost is editing documents. Option A's smaller diff buys nothing durable and leaves a table whose name
misleads the next contributor.

Evaluation composes across domains in one ordered pass, and **the binding constraint is named**:

```text
authentication → credential → recognition → immigration → employment_clearance → language
```

Ordered by what blocks what: an unrecognised qualification makes a visa threshold moot, so recognition is
reported before the visa. `undetermined` in any domain keeps the overall verdict `undetermined` — it never
collapses to a yes or a no.

## Consequences

**Accepted costs.**

- A rename across roughly six documents, done in one change so nothing is left describing
  `immigration_rules`.
- The table is broader, so `domain` must be read to interpret a row. Mitigated by the `CHECK` on `domain`
  and by an index per domain.
- Domain-specific fields live in a documented `jsonb` shape rather than typed columns — accepted as the
  Option D tradeoff, and revisited if a domain grows its own real structure.
- **`authority` must be sourced per domain per country**, which is research, not schema. It is the
  expensive part of this decision and it does not go away.
- Regulated professions stay `unknown` until the rules are actually ingested. Accepting this ADR unblocks
  the schema; it does not create the data.

**Follow-up work.**

- ~~Migrate the documents: `docs/database/entities/immigration-rule.md` becomes `requirement.md`;
  `docs/architecture/immigration.md`, `schema-overview.md`, `relationships.md`,
  `data-retention.md`, and `.claude/skills/immigration/SKILL.md` follow.~~ **Done** — all five
  followed, and `requirements` is a live table. The old name survives above and in Related as the
  record of what was renamed; it is deliberately not a working link.
- Define the `jsonb` shape per domain, documented in the entity file.
- Extend the evaluator to the ordered pass above, with the binding constraint named.
- **A `ph.md` origin reference file**, listing which authority is authoritative for each origin-side
  domain — sourced, not assumed.
- Per-profession recognition research for the launch destinations, starting with whichever track the MVP
  chooses.
- Lift the interim `unknown` rule for a profession only once its recognition rules are ingested and dated.

**Reversal cost.** Low while there is no data: the rename reverses as another rename. Once rules are
ingested, splitting `requirements` into per-domain tables would be a real migration — which is the
argument for deciding the shape before the first ingest rather than after.

## Compliance

- **No row without `domain`, `imposed_by`, and `authority`.** `CHECK` constraints on the first two; `NOT
  NULL` on the third.
- **`source_tier = 1` stays exact**, for every domain. A recognition rule from a forum is not a recognition
  rule.
- **No verdict for a regulated profession without a recognition row.** Asserted by a test: a profession
  flagged as licence-gated with no recognition requirement returns `unknown` with recognition named — never
  a visa-only answer.
- **The binding constraint is always populated** when the overall status is not `met`, asserted generically
  across the evaluator.
- `undetermined` never collapses — the existing test rule extends to all five domains.
- Grep check: no document references `immigration_rules` after the rename.

## Related

- `docs/architecture/immigration.md` — the gap this closes, and the interim rule
- `docs/database/entities/immigration-rule.md` — the table being generalized
- `.claude/context/countries.md` — origin-side domains listed per country
- `docs/roadmap/phases.md` — Phase 3 is gated on this
- ADR-0004 (provenance model this reuses), `.claude/context/knowledge-sources.md`
