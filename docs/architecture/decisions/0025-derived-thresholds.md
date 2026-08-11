# ADR-0025: A threshold no authority publishes is computed by the connector and cites every instrument it came from

- **Status:** Proposed
- **Date:** 2026-08-11
- **Deciders:** project lead
- **Affects:** `packages/db` (schema, repositories), `connectors/immigration-data/*`,
  `services/ingestion`, `docs/database/entities/requirement.md`,
  `.claude/skills/immigration/references/countries/lu.md`

## Context

Luxembourg's EU Blue Card salary threshold is not published by anybody. It is a **product of two
instruments**, and no official act states the result:

```text
Loi du 29.08.2008, Art. 45 (1) 3.   delegates — names no percentage and no amount
        ↓
RGD du 26.09.2008 (consolidated)    a multiplier of the average gross annual salary,
                                     and a lower multiplier for listed occupations
        ↓
Règlement ministériel, annual        the average gross annual salary itself,
                                     from IGSS data as determined by STATEC
```

**Germany looked like this and is not.** § 18g fixes percentages of the Beitragsbemessungsgrenze,
so the rule is conceptually a product there too — but the German state performs the multiplication
and publishes the euro figure as an official act under § 18g Abs. 7. `de-bundesanzeiger` reads a
number an authority stated. `domain_detail.percentOfBeitragsbemessungsgrenze` records the
derivation as context, not as an input we used.

Luxembourg removes that convenience. If we want a comparable threshold, **something of ours has to
multiply**, and the number then originates with us rather than with an authority. That collides
with the platform's first principle — *knowledge before generation; a number with no provenance is
a bug* — so where the multiplication happens, and what is recorded about it, is not an
implementation detail.

**The constraint that makes this non-obvious is not the arithmetic.** It is that
`requirements` **assumes one authoritative source per rule**:

| Column | Shape | Consequence |
|---|---|---|
| `source_url` | `text NOT NULL` | one URL |
| `document_id` | single FK to `documents` | **one archived original** |
| `retrieved_at` | one timestamp | one fetch |

ADR-0021 made that archived original mandatory and enforced: `services/ingestion` rejects a rule
whose source could not be archived, and `unarchivedRequirements()` must return empty. A rule
derived from two instruments can satisfy that constraint while being **half-evidenced** — one
instrument archived, the other named nowhere retrievable. The rule would look compliant and be
unrecomputable.

**A note on trusting a restatement instead.** `guichet.public.lu` is an official state portal and
does state a figure, which would dissolve the whole question. It is not usable for this: its own
pages carry **inconsistent figures**, and a portal restatement lags the instruments it restates.
That is the same reason `de.md` refuses `make-it-in-germany.com`, arrived at independently.

## Options considered

### Option A — The connector computes the absolute threshold

The connector reads both instruments, multiplies, and stores the result in `value` exactly as
Germany's absolute figures are stored.

**Pros.** The evaluator stays a comparator and learns nothing about Luxembourg — the property
ADR-0020 and ADR-0024 both protect, and which an AST test in `eligibility.py` enforces by refusing
any hardcoded jurisdiction. `evaluation` needs no new member; its CHECK set is untouched. The
stored row is identical in shape to every existing threshold, so `services/`, `ai/`, the gateway
mapping and every surface are unaffected. Re-ingestion already works: when either instrument
changes, the computed value changes, and the existing `supersedes` / `version` / `effective_from`
machinery inserts a new row exactly as it does for a German annual announcement.

**Cons.** The number in the database was stated by no authority. Without more than today's
provenance columns it is unauditable — a reviewer can see one source URL and one archived document
and cannot tell that a second instrument contributed. **This is disqualifying on its own**, which
is why the decision below pairs it with a provenance change rather than adopting it as-is.

### Option B — The requirement stores the derivation and the evaluator resolves it

`value` holds an expression — an operation, and references to the two operand instruments — and
`ai/career-roadmap` resolves it at evaluation time.

**Pros.** The legal relationship survives in the data. Nothing computes a number until it is
needed, so a stale operand cannot silently persist as a stale product.

**Cons.** It moves composition into the layer that must not do legal reasoning. The evaluator would
need a new `evaluation` member, a resolution step, and a way to fetch an operand it was not handed
— which breaks its statelessness (ADR-0020: `ai/` owns no store and is handed everything it needs).
It would also be the **first** requirement whose meaning cannot be read off the row, so every
consumer — the gateway mapping, `not_applicable` handling, the surfaces that render a threshold —
gains a case for "a value that is not a value yet". And it buys nothing an audited computation does
not: both operands are tier-1 published figures, and the RGD states the formula, so applying it is
arithmetic rather than interpretation.

### Option C — Store the operands as separate requirements and let the pathway compose them

The multiplier and the average become their own rows; something joins them.

**Cons.** Neither operand is a requirement — a person cannot satisfy or fail "the average gross
annual salary". `kind` has no member for them and inventing one would put non-evaluable rows in a
table whose invariant is *one evaluable requirement per row*. The composition would then live
nowhere in particular.

### Option D — Do nothing, and refuse Luxembourg's salary rule

Model the pathway without a salary threshold, marking it unsourced.

**Pros.** Honest, and cheap. `lu.md` already says the pathway would support eligibility evaluation
and nothing resembling planning advice.

**Cons.** The salary threshold is the **binding condition** of this pathway for almost everybody it
applies to. A Luxembourg verdict that omits it would report `met` to people who do not qualify —
the exact false positive `de-aufenthg` was prioritised to eliminate. Rejected, and worth recording
as rejected: a country whose central rule we refuse to model is a country we should not launch.

## Decision

**The connector computes the threshold, and the stored requirement cites every instrument the
computation used — each archived, each dated — through a new `requirement_sources` relation.**

Precisely:

- **Where multiplication happens:** in the connector, at normalize time. It is arithmetic applying
  a formula the RGD itself states to a figure a ministerial regulation itself states. No
  interpretation is performed and none may be.
- **What is persisted:** the absolute threshold in `requirements.value`, in the same
  `{ amount, currency, period, basis }` shape as every existing monetary threshold.
- **What provenance is persisted:** a row in `requirement_sources` per contributing instrument,
  each carrying its `document_id` (so ADR-0021's archived original holds for **each** operand), its
  ELI or URL, its `retrieved_at`, and its **role** in the computation. The operand values
  themselves are recorded in `domain_detail.derivedFrom` so the arithmetic can be re-performed
  without re-fetching.
- **What the evaluator consumes:** an absolute number, exactly as today. `ai/career-roadmap` is not
  changed by this decision and must not be.
- **How source changes affect re-ingestion:** a change in **either** instrument produces a new
  computed value and therefore a new version of the requirement, through the existing
  `planIngest` / `supersedes` path. `refresh_after` is the **earliest** of the contributing
  instruments' windows — a rule is stale as soon as its soonest-changing input is.

`requirements.document_id` and `source_url` are **kept** and continue to mean *the primary
instrument* — for Luxembourg's threshold, the RGD that states the formula. Every existing rule
keeps exactly one source and needs no migration.

## Consequences

**Accepted costs.**

- **A new table and a migration**, and therefore M3's verification is not clean: adding Luxembourg
  costs a change in `packages/db`. It does **not** cost a change in `services/` or `ai/`, which is
  what M3's criterion actually names — but the honest reading is recorded in `milestones.md`
  rather than argued away.
- **Two sources of truth for provenance during the transition**: `requirements.source_url` and the
  new relation. Mitigated by making the relation authoritative when populated and by a test that
  the primary instrument appears in both.
- **The connector performs arithmetic on legal values**, which is a capability no connector had.
  The rounding rule must be stated in the connector and tested against the instruments' own
  wording; a threshold rounded the wrong way is a wrong threshold.
- **A computed number can be wrong in a way a read number cannot.** `validate` must carry a
  plausibility floor for it, as `de-bundesanzeiger` does for the €700 parse defect.

**Follow-up work.**

- `requirement_sources` migration, constraints violation-tested as every table here is.
- `services/ingestion` archival extended to archive **every** contributing instrument before the
  rule is accepted, and `unarchivedRequirements()` extended to mean "any contributing source
  unarchived".
- `docs/database/entities/requirement.md` gains the relation and the one-source assumption it
  replaces.
- `lu.md`'s open question is answered and the file updated.
- Germany is **not** retrofitted. Its figures are published, its provenance is complete, and
  changing it would be churn.

**Reversal cost.** Low while Luxembourg is the only user. The table is additive, no existing row
changes, and abandoning it means dropping a table nothing else reads.

## Non-goals

- **No general-purpose expression language.** One operation, multiplication, for one rule shape.
  A second arithmetic form should reopen this ADR rather than extend a grammar quietly.
- **The evaluator does not become a legal-source parser**, and does not resolve operands. It
  receives numbers.
- **`kind` and `evaluation` gain no members.** If a future rule cannot be expressed without one,
  that is a new decision.
- **No retrofit of published-figure countries.** Germany stays as it is.

## Compliance

- `unarchivedRequirements()` must return empty **and** must consider every contributing source, not
  only `document_id`. A rule with an unarchived operand is rejected by `services/ingestion`.
- A test asserts that a requirement carrying `domain_detail.derivedFrom` has a `requirement_sources`
  row **per operand**, each with a `document_id`.
- The jurisdiction-free AST test in `ai/career-roadmap/tests/` continues to pass unchanged — if this
  decision ever requires touching the evaluator, it has been implemented wrongly.
- `refresh_after` for a derived rule equals the minimum of its sources' windows, asserted in the
  connector's tests.

## Related

- ADR-0010 (six domains, one table), ADR-0020 (`ai/` reasons over curated knowledge),
  ADR-0021 (archived provenance), ADR-0024 (routes — the precedent for settling the model before
  the connector)
- `.claude/skills/immigration/references/countries/lu.md` — the source chain this decision is about
- `docs/database/entities/requirement.md`, `docs/architecture/immigration.md`
