# ADR 0029: Origin scopes a requirement through `applies_to`, and an origin with no rule is `unknown`, never `not_applicable`

- **Status:** Accepted
- **Accepted:** 2026-08-20
- **Date:** 2026-08-20
- **Deciders:** project lead
- **Affects:** `packages/db` (`requirements`, `person_fact_kinds`), `services/api-gateway/src/eligibility`, `ai/career-roadmap`, `connectors/immigration-data`, `docs/database/entities/requirement.md`, `.claude/skills/immigration/references/countries/`

## Context

ADR-0010 generalized `immigration_rules` into `requirements` so that recognition, credential
evaluation, authentication, language, and origin employment clearance could be expressed at all. It
was accepted on 2026-07-28, the rename is done, and `docs/architecture/immigration.md`,
`.claude/context/countries.md`, and `phases.md` all now say the same thing: **the schema is no
longer the blocker; research is.**

That is true of the *domains*. It is not true of the **origin**, and M5 has been carrying
"blocked on the origin-jurisdiction ADR" against three other documents that say no decision is
outstanding. This ADR resolves that disagreement by naming what ADR-0010 did not decide.

### What ADR-0010 settled, and what it left open

`requirements.jurisdiction` is documented as *"the country whose authority imposes it"*
(`docs/database/entities/requirement.md`). `imposed_by` records which side of the move that
authority sits on. Together they answer **who decides**.

Neither answers **who the rule is about**. A recognition rule is not a property of one jurisdiction;
it is a relation between two — a destination regulator assessing a qualification awarded somewhere
else. Germany's nursing board does not have *a* recognition rule. It has one for qualifications
awarded inside the EU/EEA and a different one for qualifications awarded outside it, and those are
different rules with different processes and different outcomes.

In today's schema both would be:

```text
domain = 'recognition'   jurisdiction = 'DE'   profession = 'registered-nurse'
```

Identical on every column that scopes retrieval. Nothing distinguishes them, and
`uq_req__current` — `UNIQUE (requirement_id) WHERE effective_to IS NULL` — permits only one of them
to be live. The model cannot hold both, which means it cannot hold the one our primary users need.

**The mirror case is worse.** An origin-imposed rule — a Philippine overseas-employment clearance —
has `jurisdiction = 'PH'`, `imposed_by = 'origin'`, and belongs to no pathway and no profession.
`ck_req__scope` explicitly permits that: `employment_clearance` requires neither `pathway_id` nor
`profession`. But retrieval is `requirementsAsOf(db, scope, asOf)`, whose scope keys are
`pathwayId`, `profession` and `jurisdiction`, **AND-ed together**
(`packages/db/src/repositories/requirements.ts:130`). A row with both scope columns null is
reachable only by a jurisdiction-only query, and no caller makes one.

### What the code actually does today, measured rather than assumed

| Claim | Verified on 2026-08-20 |
|---|---|
| The gateway retrieves requirements by **pathway only** | `requirementsAsOf(this.#db, { pathwayId }, asOf)` — `services/api-gateway/src/eligibility/eligibility.service.ts:149` |
| Therefore **no** `recognition`, `credential`, `authentication`, `language` or `employment_clearance` row would ever reach the evaluator, however well sourced | follows from the above; every such row has a null `pathway_id` |
| The evaluator **does** implement ADR-0010's ordered pass | `DOMAIN_ORDER` and the sort at `ai/career-roadmap/src/career_roadmap/eligibility.py:387` |
| The evaluator **does** implement the licence-gated guard | `eligibility.py:412` — returns `unknown` with `binding_domain='recognition'` |
| **No production caller ever passes `licence_gated`** | it defaults `false` in `eligibility.service.ts:182`; only tests set it true |
| `careers.licence_gated` and `careers.profession` exist and are seeded | `docs/database/entities/career.md`, `packages/db/src/seed.ts` |
| Every ingested requirement is `immigration` / `destination` | 21 rows, one group, dev database |
| **No person fact expresses origin** | 10 kinds in `person_fact_kinds`; none is nationality or country of qualification |

So ADR-0010's central safety property — *a licence-gated profession with no recognition row returns
`unknown`* — is implemented in the evaluator and **not reachable in production**, because the flag
that triggers it is never sent and the rows it looks for are never fetched. That is not a bug to
file separately; it is the shape of the gap this ADR has to close.

### The constraint that makes this non-obvious

The obvious move is a second jurisdiction column. It is wrong for a reason that only shows up on the
second example: for a destination recognition rule the counterpart jurisdiction is the **origin**,
and for an origin clearance rule the counterpart is the **destination**. One column would hold
different things depending on `imposed_by`, and a reviewer would have to read two columns to know
what the third means. That is the `jurisdiction_role` mistake ADR-0010 already rejected, wearing a
different name.

### The honesty question underneath, which is the real stake

If Germany's recognition rules are ingested for EU-awarded qualifications only, and a Filipino nurse
asks, the system finds **no matching recognition rule**. There are exactly two things it can mean by
that, and they are opposite:

- **recognition does not apply to this person** — a claim about the world.
- **recognition applies and we have not sourced it** — a claim about **us**.

**These are said in two different vocabularies, and this ADR is binding on both.** They are separate
enums at separate layers, and conflating their words is how a compliance test ends up asserting
against a status that does not exist:

| Layer | Enum | The word here |
|---|---|---|
| the verdict — `ai/career-roadmap` | `Status = met \| not_met \| undetermined \| unknown` | **`unknown`**, with `binding_domain = 'recognition'` |
| a single requirement — `ai/career-roadmap` | `Result = met \| not_met \| undetermined \| not_applicable` | `not_applicable` only where a rule genuinely does not apply |
| the comparison cell — `services/api-gateway/src/comparison/compose.ts` | adds `unmodelled` | **`unmodelled`**, the cell derived from that verdict |

**`unmodelled` is a cell state, never a verdict status.** A verdict returns `unknown`; the cell
rendered from it reads `unmodelled`. ADR-0026 and ADR-0028 already treat the
`unmodelled` / `not_applicable` distinction as a correctness property rather than a wording
preference, and `compose.test.ts` asserts the two are produced by different branches with different
sentences. Here the cost of collapsing them is higher than anywhere else in the product: a nurse
told her licence is fine, by a system that never looked, acts on it.

## Options considered

### Option A — Encode origin in `requirement_id`

`de.nursing.licence-recognition.ph`, `de.nursing.licence-recognition.eu`.

**Advantages.** No migration, no schema change, works today. Consistent with `requirement_id` already
being a namespaced hierarchy.

**Disadvantages.** Origin becomes a **naming convention rather than data**: unqueryable, unindexable,
and unenforceable. Nothing stops a connector omitting the suffix, and the row that omits it silently
becomes the rule for everybody. The one thing we need to ask the database — *is there a rule for
this person's origin?* — is the one thing a string suffix cannot answer without `LIKE`. It also
cannot express "applies to any origin", which most immigration rules genuinely do.

### Option B — A second typed column, `origin_jurisdiction char(2)`

**Advantages.** Typed, indexable, symmetric with `jurisdiction`, and obvious to a reader.

**Disadvantages.** It is only right for destination-imposed rules. For `imposed_by = 'origin'` the
scoping dimension is the **destination**, so either the column means different things per row — the
rejected `jurisdiction_role` shape — or a third column appears for the mirror case and both are null
on the 21 immigration rows that need neither. It also forces a migration and a backfill decision for
every existing row before a single recognition rule is sourced.

### Option C — Origin as a scope key inside `applies_to`

```jsonc
applies_to: { "origin_jurisdiction": ["PH"] }        // a DE recognition rule for PH qualifications
applies_to: { "destination_jurisdiction": ["DE"] }   // a PH clearance rule that varies by destination
applies_to: { }                                       // applies whatever the counterpart is
```

**Advantages.** `applies_to` is already documented as *"occupation lists, qualification levels, age
bands — explicit, never implied"* — that is, **who the rule applies to**, which is exactly what an
origin is. **ADR-0024 set the precedent**: `route` lives there, the evaluator reads
`applies_to.get("route")` (`eligibility.py:98`), and a requirement declaring none is pathway-wide —
"absent means broader, not narrower", the conservative reading. Origin behaves identically. No
migration. Both directions expressed by two keys with unambiguous names, neither of which changes
meaning per row. An absent key means the rule applies regardless of counterpart, which is the
correct default for the 21 rules already ingested — so **no backfill**.

**Disadvantages.** A jsonb key is not enforced by a `CHECK`, so a typo produces a rule that silently
matches nobody. Querying it needs an expression or GIN index rather than a b-tree on a typed column.
Both are real, and both are the same costs ADR-0024 already accepted for `route`.

### Option D — A separate `requirement_origin_scopes` join table

**Advantages.** Fully normalized; a rule can name many origins with referential integrity.

**Disadvantages.** A join on every eligibility read, for a cardinality that is almost always one or
zero. `requirement_sources` (ADR-0025) earned its table because provenance is genuinely many-per-rule
and carries its own columns; an origin scope carries nothing but a country code. This is Option D of
ADR-0010 again — right at ten dimensions, over-engineered at one.

### Option E — Do nothing; keep returning `unknown` for regulated professions

**Advantages.** Honest today, costs nothing, and the interim rule is already documented.

**Disadvantages.** It is not actually honest today, and that is the finding that removes this option.
`licence_gated` is never sent, so the guard never fires; a licence-gated career would receive a
**visa-only verdict**, not the `unknown` every document promises. Doing nothing preserves a claim
that is already false rather than a limitation that is already safe.

## Decision

**Option C — origin scopes a requirement through `applies_to.origin_jurisdiction`, mirrored by
`applies_to.destination_jurisdiction` for origin-imposed rules; an absent key means the rule applies
regardless of counterpart; and a licence-gated profession with no recognition rule *matching the
person's origin* is a verdict of `unknown` with recognition named — rendered as `unmodelled` in the
comparison, never `not_applicable`, and never a visa-only verdict.**

Three parts, and the third is the one that matters most.

**1 — Scope, not identity.** Origin variants get distinct `requirement_id`s, exactly as route
variants already do (`de.eu-blue-card.qualification` and `.abs1-s2` are separate ids under one
pathway). `uq_req__current` stays untouched, because the two German nursing rules are two
requirements rather than two versions of one.

**2 — The person fact is the qualification's country, not the passport.** A new
`qualification_awarded_in` person fact, ISO 3166-1 alpha-2, marked `sensitive`. This is deliberately
**not** nationality: a Filipino citizen holding a German nursing degree has no recognition problem,
and a German citizen holding a Philippine one does. Recognition follows the qualification.
Nationality is a different fact for a different purpose — it decides whether a Blue Card is needed at
all — and it is **not introduced here**, because no ingested rule reads it yet and this repository
does not declare a thing before its first reader.

**3 — Retrieval widens, and the guard gets wired.** `requirementsAsOf` gains an origin scope and the
gateway stops asking for one pathway's rules: it gathers the pathway's `immigration` rules, the
career's `profession` rules, and the origin's rules, and passes `licence_gated` from
`careers.licence_gated`. Until that is true, ADR-0010's ordered pass has nothing to order.

The evaluator matches a rule to a person when the scope key is absent, or present and containing the
person's value — the same rule `route` already follows. **A missing `qualification_awarded_in` makes
recognition `undetermined` and names the question**, which is the existing `needs_input` mechanism
and needs no new concept.

## Consequences

**Accepted costs.**

- **A jsonb key is not `CHECK`-enforceable.** A misspelled `origin_jursidiction` matches nobody and
  fails silently. Mitigated by validation in `assertValid` at insert and by the connector golden
  tests, not by hoping — see Compliance.
- **Retrieval gets more expensive.** One scoped query becomes a union across pathway, profession and
  origin. Acceptable at current row counts and indexed per domain already; revisit if an eligibility
  read exceeds its budget.
- **A new sensitive person fact.** Where a qualification was awarded is close enough to origin and
  ethnicity to deserve the flag, and `person-fact.md` already routes `sensitive` kinds to
  column-level encryption in the production posture.
- **`unknown` will be the common verdict for a long time**, rendering as `unmodelled` on the
  comparison. Every regulated profession, in every destination, until its rules are sourced. That is
  the correct answer and it will look like a broken product. It must not be softened.
- **This ADR creates no data.** Same caveat ADR-0010 carried and worth repeating: accepting this
  unblocks the model; the research is still the expensive part.

**Follow-up work.**

- Add `qualification_awarded_in` to `person_fact_kinds`, with its prompt and rationale, `sensitive`.
- ~~**Extend `requirementsAsOf` with an origin scope; change the gateway to gather across domains**~~
  **Done** — 2026-08-21. The scope gained `imposedBy` and `includeProfessionless`, and the gateway
  now runs three reads instead of one: the pathway's rules, the destination's rules for the career's
  profession, and the origin state's own duties, merged by row id. `licence_gated` was already
  passed from `careers.licence_gated` by #109. **Retrieval does not filter on `applies_to`** and
  must not: an absent origin key means the rule applies regardless, so a SQL predicate on it would
  drop exactly the rules that apply to everybody. Held by four repository tests on the compiled SQL,
  six gateway tests on which rules reach the evaluator, and eight integration tests against real
  PostgreSQL. **A recognition row now reaches the evaluator** — which does not yet know how to match
  one to a person's origin. That is the next item, and until it lands a licence-gated profession
  still returns `unknown`.
- ~~**Teach the evaluator `applies_to.origin_jurisdiction` / `destination_jurisdiction`, with the
  same absent-means-broader rule as `route`**~~ **Done** — 2026-08-21. Three answers, not two: a
  rule applies, is `not_applicable` because it was written for other origins, or is `undetermined`
  because we cannot place it until the person says where they qualified. **The licence-gated guard
  now counts only recognition rules that are not excluded**, which is the safety property this ADR
  exists for — a recognition rule for qualifications from elsewhere is not a recognition rule for
  this person, and counting it would hand a nurse the visa answer. An unreadable scope is read as
  absent, so a typo makes a rule broader rather than silently applying it to nobody. The evaluator
  gained a `destination` input, supplied from the pathway row rather than parsed out of its id.
  Held by 18 pytest cases and two gateway tests. **No rule declares either key yet**, so no stored
  verdict changes.
- ~~**Wire and test the licence-gated guard end to end**~~ **Done** — #109. `licence_gated` is read
  from the person's target rather than accepted as an optional argument, held by two unit tests and
  six integration tests against real PostgreSQL. **Retrieval is still pathway-only**, which is the
  half that waits on this ADR: no `recognition` row reaches the evaluator, so a licence-gated
  profession returns `unknown`. That is now the guard firing rather than an accident.
- ~~**Document both keys in `requirement.md`'s `applies_to` section and in `immigration.md`**~~
  **Done** — 2026-08-21. `requirement.md` gained an `applies_to` scope-key section covering all four
  keys the evaluator reads, the absent-means-broader rule and why it is the conservative direction,
  the three placement outcomes, and why retrieval never queries these keys. `immigration.md` gained
  the same semantics against its evaluation contract, and its numbered pass now has nine steps
  rather than eight — placement is step 2, before evaluation. The licence-gated invariant is
  restated as needing a recognition row **that could be about this person**.
- ~~**A `ph.md` origin reference file (ADR-0010 follow-up), naming the authority per origin-side
  domain — sourced, not assumed**~~ **Done** — 2026-08-21. See ADR-0010's follow-up for what is
  sourced and what stays `unknown`. It establishes the **Philippine** side only: PRC decides who is a
  registered nurse in the Philippines, and says nothing about whether a destination recognises that
  registration. **That is the remaining item**, and it is destination-side evidence.
- Per-profession recognition research for one destination and one profession, as the vertical slice
  that proves the model before it is repeated.

**Reversal cost.** Low. Nothing is ingested outside `immigration`/`destination`, so there is nothing
to migrate: reversing means deleting two jsonb keys nobody has written yet. The signal to reverse is a
domain growing real per-origin structure — a bilateral recognition agreement with its own terms,
dates and carve-outs — at which point the scope key becomes a foreign key and Option D becomes right.
That is the same revisit trigger ADR-0010 set for `domain_detail`, and it should be taken the first
time an origin scope needs a second column.

## Compliance

- **An origin scope is a list of ISO 3166-1 alpha-2 codes, or absent.** Validated in
  `assertValid` (`packages/db/src/repositories/requirements.ts`) — an unknown key beginning
  `origin_` or `destination_` is rejected at insert, so a typo fails loudly instead of matching
  nobody.
- **A rule never scopes itself by the side that imposes it.** `imposed_by = 'origin'` implies no
  `origin_jurisdiction` key; `imposed_by = 'destination'` implies no `destination_jurisdiction` key.
  Asserted in the repository tests. Stated as two implications rather than as "and vice versa",
  which would have claimed that a rule with no `origin_jurisdiction` key is origin-imposed — false
  of all 21 rows already ingested, every one of them `imposed_by = 'destination'` with no origin
  scope.
- **No licence-gated career is evaluated without `licence_gated: true` reaching the evaluator.**
  Asserted at the gateway, not only in `ai/` — the current gap is precisely that the evaluator's test
  passes while production never triggers it.
- **A licence-gated profession whose recognition rules exist but do not match the person's origin
  returns the verdict `unknown` with `binding_domain = 'recognition'`, and the origin named.** Two
  tests, one per layer: the verdict in `ai/career-roadmap`, and the `unmodelled` cell it produces in
  `compose.test.ts`. Asserted separately because they are separate enums — a test written against
  "returns `unmodelled`" at the verdict layer would assert a status that does not exist. This is the
  exact case where a wrong answer is most harmful and hardest to notice: rules are present, so
  nothing looks empty.
- **`unmodelled` and `not_applicable` are produced by different branches with different sentences**,
  extending the rule `compose.test.ts` already enforces for the comparison (ADR-0026, ADR-0028).
- **The jurisdiction-free AST test still passes.** Origin is data; no `if (origin === 'PH')` may
  appear in `services/` or `ai/`.
- Grep check: no document describes `jurisdiction` as "the destination".

## Related

- ADR-0010 — the generalization this completes; its `authority` research is still the expensive part
- ADR-0024 — the `applies_to.route` precedent this follows, including absent-means-broader
- ADR-0025 — why `requirement_sources` earned a table and an origin scope does not
- ADR-0026, ADR-0028 — `unmodelled` versus `not_applicable` as a correctness property
- `docs/database/entities/requirement.md` · `career.md` · `person-fact.md`
- `.claude/context/countries.md` — the origin-side domains, and PH as the primary origin
- `docs/roadmap/milestones.md` — M5, which this unblocks
