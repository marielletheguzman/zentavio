# Milestones

> **Purpose:** Phased milestones: MVP, learning loop, multi-country scale.

A milestone is **verifiable by someone who did not build it** — a user path that works, not a set of
merged pull requests. Each one below states what a person can actually do when it is met.

No dates. Sequencing is by dependency, and a date attached to unbuilt work is a guess that becomes a
commitment.

---

## M0 — The skeleton enforces itself

*Phase 0.* Boundaries are held by tooling rather than by review; CI blocks on `main`; ADRs recorded.

**Verified by:** a deliberate cross-layer import fails the build with the ADR it breaks, and a red CI run
cannot merge.

**Both halves verified, 2026-07-31.**

*A red CI run cannot merge.* A branch with a deliberate type error was refused with
`HTTP 405: Required status check "CI" is failing.` while a green pull request read `CLEAN`. See ADR-0011's
Correction section.

*A deliberate cross-layer import fails the build with the ADR it breaks.* Three probes were written, run,
and deleted:

| Probe | Result |
|---|---|
| `packages/types` imports `@zentavio/config` | rejected — "packages/types is the innermost layer…" |
| `packages/config` imports `services/api-gateway` | rejected — "…A shared library that knows its consumers is not shared — ADR-0001" |
| `process.env` read inside `packages/db` | rejected — "Read configuration through packages/config…" |

The test found one defect, now fixed: the `package-types` message was the only `disallow` message in
`eslint.config.mjs` that named no ADR, so that violation failed the build without saying which decision it
broke — which is the criterion, not merely failing.

**Outstanding:** TypeScript project references, and graded evals in CI (deferred deliberately by ADR-0009,
so it does not gate Phase 0 exit).

---

## M1 — One honest answer exists

*Phase 1, first half.* A Filipino professional uploads a résumé and receives a readiness number for one
track with its remainder and its evidence.

**Verified by:** a real user reads the number, opens the evidence, disagrees with one extracted skill,
corrects it, and watches the number change for a reason they can see.

The correction path is part of the milestone, not a follow-up: a profile a user cannot fix is a profile
they will not trust.

### M1 in three slices

M1 is too large to build in one go and too easy to build in the wrong order. The split below is by
**user question**, never by layer — "build the parser, then the graph, then the scorer" would produce
nothing demonstrable until the end, and the end always slips (`.claude/skills/roadmap/SKILL.md`).

Each slice is demoable on its own, and each carries the full non-cuttable list at its own scale:
evidence, an honest `unknown`, provenance, privacy, and docs.

Chain position, from `docs/features/README.md`: **résumé → profile → skill gap → readiness.** The slices
follow that order because each genuinely needs the one before it.

---

#### M1a — "What does the system think about me?"

*The profile exists, and the user can fix it.*

Résumé (PDF/DOCX) → parsed profile → skills marked **evidenced** or **claimed**, each with the source
span it came from → the user disagrees with one, corrects it, and the correction sticks.

No score yet. That is the point: a profile is useful on its own, and a score built on a profile nobody has
checked is a confident wrong answer.

**Vertical:** `ai/resume-parser` · `packages/db` (profile, skills, corrections) · `services/api-gateway` ·
`apps/web` upload and profile surface.

**Progress (2026-08-01): steps 1–11 are built, and the stack was run end to end for real** — three
processes, a real PDF over HTTP, into PostgreSQL:

```text
POST /v1/resume/upload  →  200 {"stored":true,"version":1}
   kubernetes  evidenced  "Led a Kubernetes migration across 40 services"
   terraform   evidenced  "Wrote Go services and Terraform modules"
   go          evidenced  "Wrote Go services and Terraform modules"
scan.pdf       →  200 {"stored":false,"status":"unknown"}  and v1 survived
wrong type     →  400 VALIDATION_FAILED with a correlation id
```

**The correction path is now reachable by a person** (2026-08-01). `POST /v1/resume/corrections`
plus a control that sits **inside the evidence disclosure**, next to the sentence the claim came
from — disagreeing is only possible once you can see what the claim was based on, and putting the
two apart is how a correction path exists and never gets used.

Verified over HTTP against the running stack:

```text
upload                    → v1  terraform = evidenced (parser)
POST /v1/resume/corrections → v2  terraform = claimed   (self-reported)
v1 in the database         → still evidenced, byte-identical
unknown slug               → 400 "Unknown skill: not-a-real-skill"
bad payload                → 400 with field-level details
```

The route is keyed by **slug, not skill id**: the browser has no business holding database UUIDs,
and an unknown slug becomes a 400 naming it rather than a foreign key violation surfacing as a 500.

**Outcome recording is blocked on a schema question, found 2026-08-01.** `outcomes.kind` is a closed
set of application-lifecycle events — `applied`, `screened`, `interviewed`, `offered`, `rejected`,
`withdrawn`, `accepted`, `started`, `relocated`, `course_completed`, `assessment_passed`
(`docs/database/entities/outcome.md`). **None of them describes "a profile was created."** Forcing an
upload into one of these would corrupt the calibration data the table exists for — a `kind` that
means two different things cannot be aggregated.

The `outcomes` table also has foreign keys to `applications` and `companies`, neither of which
exists, so it cannot be migrated as documented yet.

**Resolved by ADR-0019 (Accepted 2026-08-03): outcome recording begins at M2.** M1a records none,
and that is now a decision rather than a gap. The original wording is kept below because it is the
reasoning the ADR was written against.

Resolving it
needs a decision: add a profile-lifecycle `kind`, add a separate table for profile events, or accept
that outcomes begin at M2 when there is an application to attach them to. Erasure — the other half of
this step — **is** implemented, because it could not wait: retrofitted privacy is a breach already
shipped.

**Done when:** an unparseable or image-only résumé returns an honest failure naming what is wrong rather
than an empty profile; every extracted skill shows its source span; a correction persists and is
attributed to the user rather than overwriting the parser's claim; retention and deletion for résumés
work **in this slice**, because this is where résumés first exist and retrofitted privacy is a breach
already shipped. **Outcome recording is not wired here** — ADR-0019 moves it to M2, where
`applications` exist to attach it to.

**Cuttable:** DOCX (PDF alone is a real answer), role/employer extraction beyond titles, any styling.
**Not cuttable:** source spans, the evidenced/claimed distinction, the correction path, retention.

**The authorization hole is closed; the mechanism is still open** (2026-08-01). `userId` used to
arrive in the request body, so any caller could read and correct any person's profile. It is gone
from every DTO: the subject now comes from `@CurrentSubject()`, established by a **global** guard —
deny by default, because opting a route *in* to protection is a list someone forgets, and the route
they forget is the one that leaks.

Verified by attempting the attack against the running gateway:

```text
no credential                        → 401 UNAUTHENTICATED
naming another user in the body      → 400 "property userId should not exist"
acting on your own profile           → 200, v3
victim's profile after the attempt   → untouched at v2
NODE_ENV=production + dev flag on    → 401, the flag is ignored
```

**ADR-0017 is Accepted: a hosted OIDC provider, verified generically.** The issuer, audience, and
JWKS endpoint are configuration, so Clerk, WorkOS, Auth0, or a self-hosted Keycloak are three
environment variables rather than a code change. Tokens are checked for signature, algorithm,
issuer, audience, and expiry; users are provisioned just-in-time on first valid token.

**What is left is provisioning a provider account** — `ZENTAVIO_OIDC_ISSUER` and
`ZENTAVIO_OIDC_AUDIENCE`. Until they are set the gateway falls back to deny-by-default, or to the
loudly-named `ZENTAVIO_INSECURE_DEV_AUTH` header, which is refused outright in production. Real
authentication wins whenever it is configured, so leaving the dev flag set cannot downgrade a
properly-configured environment.

**One behaviour worth knowing:** a person who erases their account and signs in again becomes a
**new** account with no data. Erasure clears `auth_subject`, so the tombstone cannot be matched —
deliberately, because refusing them forever would be a ban rather than an erasure.

**Two schema dependencies were found while planning M1a**, and they change the M1a/M1b boundary:

- `profile_skills.skill_id` references `skills(id)`, and the parser resolves phrases against a
  **closed set** of slugs. So the skill entity splits **by table, not by milestone**: M1a takes
  `skills` and `skill_aliases` (the closed set and its resolution), M1b takes `skill_edges` and
  `career_skills` (the graph and the target). M1a stays self-contained.
- `careers` was referenced by `user.md`, `skill.md`, and `outcome.md` and **defined by none**.
  Written as `docs/database/entities/career.md` before any migration touched it.

---

#### M1b — "How far am I from cloud / platform engineering?"

*The gap exists, and it is honest about what it does not know.*

Profile → seeded skill graph for the one track → weighted, dependency-ordered gap → each missing skill
shows why it is required and how far it sits from what the user already has.

**Vertical:** `packages/db/seeds/` (seeded, sourced edges only) and the `skills` · `skill_aliases` ·
`skill_edges` · `career_skills` tables · `ai/skill-gap` · `apps/web` gap surface.

*This line named `knowledge-engine/skills-graph` until 2026-08-03. It was never built there, and
ADR-0020 settles why: the graph is queried per request, so it lives in the database.*

**Done when:** a skill the graph does not cover returns `unknown` naming what is missing, never a zero;
every `requires` edge carries its source; the ordering is dependency-driven and reproducible — the same
profile and graph produce the same gap, asserted by a determinism test.

**Cuttable:** learning paths (`mvp.md` already names them first to cut — a gap without a plan is still a
useful answer), breadth of the seeded graph, any second track.
**Not cuttable:** sourced edges, the `unknown` path, determinism.

---

#### M1c — "Am I ready, and why that number?"

*The number exists, carries its remainder, and moves for a reason the user can see.*

Gap → readiness score + remainder + the evidence bundle that produced it → the correction from M1a
changes the number, and the change is explainable.

This slice is what M1's stated verification actually tests. It is small **only because M1a and M1b did
their work honestly** — which is the argument for this ordering.

**Vertical:** `ai/skill-gap` scoring · the evidence bundle contract in `packages/types` · `apps/web`
readiness surface with evidence disclosure.

**Done when:** every number is traceable to the evidence that produced it, reachable in the UI; confidence
is visible, not implied; a profile too sparse to score returns `unknown` with the one input that would
resolve it, rather than a low number; the full path — upload, correct, watch it change — works for a real
user.

**Cuttable:** comparison against `REMOTE`, charts, multiple score presentations.
**Not cuttable:** the evidence bundle, visible confidence, the `unknown` path, the correction loop.

---

**Why this order and not another.** Each slice makes the next one's answer more honest rather than merely
possible. Building the scorer first would mean scoring a profile nobody had checked; building the graph
first would mean a gap against skills the system had not confirmed the user has. The prioritization rule
is to finish a vertical, then deepen it — not to start three (`.claude/skills/roadmap/SKILL.md`).

---

## M2 — Germany is answerable

**Status: Met** (2026-08-11).

*Phase 1 complete.* DE pathway rules ingested from tier-1 sources, dated and versioned; per-rule
eligibility; viability with the binding constraint named.

**Verified by:** a user with an incomplete profile gets `undetermined` plus the one input that would
resolve it — and supplying it produces a definite answer.

That is the milestone's real test. A product that only works on complete profiles does not work.

**The verification passed in a browser on 2026-08-04** (`90dae86`, PR #68). `/eligibility` returned
`undetermined` naming `expected_gross_annual_salary_eur`; entering 60 000 and re-checking returned
`met` with the basis *"60000 against a threshold of at least 50700"*, the deciding authority, the
effective date, and a link to the source. CORS worked — which only a browser can prove, and which
M1c shipped without while every server-side check passed.

The path is real end to end: `BAnz AT 18.12.2025 B3` → `connectors/immigration-data/de-bundesanzeiger`
→ `planIngest` → `executePlan` → `requirements` → gateway → `ai/career-roadmap` → browser.

**The verification was re-run against the current rule set on 2026-08-11**, and it is a different
test now than it was on 2026-08-04: § 18g is modelled as three routes rather than two salary
thresholds. With no relevant facts answered, **all three routes returned `undetermined`, each
naming its own unanswered question** — `abs1-s2` asking when the degree was awarded, `abs2` asking
for experience in the last seven years. Supplying the facts produced a definite **`met` through
`abs2`**: the route that admits an ICT professional with no degree at all.

### Completed

Each of these was outstanding when this milestone was written and is now implemented:

- **Viability** — PR #75
- **§ 18g beyond the two salary thresholds** — PR #89
- **Typed person-fact controls** — PR #90
- **Outcome recording** — PR #91
- **Archived provenance** — built and enforced

What each one is, and the reasoning worth keeping:

- **Viability** (`f60f821`, PR #75). `ai/career-roadmap/viability.py` pairs the two
  axes and names the binding constraint; the gateway serves `GET /v1/viability` computing both
  halves in one call; `/eligibility` leads with the binding constraint rather than the eligibility
  status. Visa-eligible and unemployable at the threshold salary is caught — it renders as *"You
  qualify — the gap is readiness, not the rules"*. **No composite score**, per ADR-0022. *This
  bullet said only eligibility was built until 2026-08-11; the code landed on 2026-08-05 and the
  milestone was never updated.*
- **§ 18g beyond the two salary thresholds** (ADR-0024, PR #89). The statute is
  on file through `connectors/immigration-data/de-aufenthg`: the six-month employment duration
  (Abs. 3), the academic qualification (Abs. 1 S. 1, widened by S. 5), both gates on the reduced
  route (Abs. 1 S. 2 Nr. 1's ISCO-08 groups and Nr. 2's three-year graduate window), and the
  experience route (Abs. 2 — its own two ISCO-08 groups and three years' experience within seven).
  Three routes are evaluated, `abs1-s1` · `abs1-s2` · `abs2`, per ADR-0024.

  **Coverage is every requirement *ingested*, not every statutory requirement.** Still not on file:
  § 19f's rejection grounds, whose substance is on another provision; the Bundesagentur für Arbeit's
  consent, recorded as a note because nobody can answer it in advance; and the dependent, residence
  and job-change provisions, which are not eligibility. So "every rule we checked" remains a claim
  about what is ingested, not about § 18g entire — which is a scoping statement, not an unmet
  requirement. The country model is in
  `.claude/skills/immigration/references/countries/de.md`.
- **Outcome recording** (ADR-0019, PR #91). `packages/db/src/repositories/applications.ts`
  records an application with **what was predicted at that moment** and records outcomes against
  it; the gateway serves `POST /v1/applications`, `GET /v1/applications` and
  `POST /v1/applications/:id/outcomes`; `apps/web/app/applications` is the one-tap surface. The
  prediction is captured when the person acts rather than when the result arrives, because a score
  recorded late has already moved — that is ADR-0019's argument and the reason the column exists.
  Erasure detaches the outcome and deletes the application, asserted against rows the real write
  path produced.

  **What this does not yet do is read the data.** `CLAIMED_CREDIT` stays an assumption until enough
  outcomes accumulate to observe the rate, exactly as ADR-0019 says. A calibration reader with zero
  rows could only answer "not enough data yet", which is why it is not built here.
- **Archived provenance** (ADR-0021, phases 2–6). Every stored requirement cites an archived
  original; `unarchivedRequirements()` returns empty; a rule whose source could not be archived is
  **rejected** by `services/ingestion`, asserted against real MinIO in
  `tests/integration/db/ingestion-archival.test.ts`. *This was listed as unbuilt until 2026-08-11;
  it landed on 2026-08-05.* The production bucket is a deployment prerequisite and is recorded
  below rather than here.
- **Typed person-fact controls** (PR #90). An answer is validated against its catalogue
  `value_type` at the write boundary, so a `needsFromUser` question cannot be answered with a value
  the evaluator will misread. Found by a browser check: answering *"no"* to the degree question
  stored the string `'no'`, which read as `true` and reported the qualification rule **met** for
  somebody who had just said the opposite. M2's own verification statement depends on this — "the
  one input that would resolve it" is only true if supplying that input resolves it *correctly*.

### Verification limitations

**Two surfaces merged without a browser check** — the `/eligibility` typed-control surface (PR #90)
and `/applications` (PR #91) — because the browser extension was unavailable for the rest of that
session and did not reconnect across a restart.

**Both were loaded on 2026-08-12, and most of that gap is now closed.** `/eligibility` renders a real
verdict against the real evaluator; its integer question renders as a number control with its
rationale, and answering it moved the verdict from *"we cannot finish until you supply
`years_since_degree_awarded`"* to a named unmet requirement — the loop M2 is verified by, exercised
in a browser rather than over HTTP. `/applications` loads, hydrates, fetches `GET /v1/applications`
cross-origin and renders its empty state.

**Both remaining items closed on 2026-08-20** — the **boolean** control (rendered as a
`Choose… / Yes / No` select, answered **No**, stored as JSON `false`) and the `/applications`
**submit** (a title recorded, its stored prediction rendered). They are rows 2 and 3 of M4's evidence
gate below, and each carries what was observed.

They were recorded as verification limitations rather than waved through because this repository has
been caught by exactly this gap before — the gateway shipped with no CORS at all through the whole
of M1c while every server-side check passed.

**Outcome data is recorded and not yet read**, and that is deliberate rather than unfinished.
ADR-0019: a calibration reader with zero rows can only answer "not enough data yet", so
`CLAIMED_CREDIT` stays a stated assumption until enough outcomes accumulate to observe the rate.
Consumption is not an M2 requirement.

### Deployment prerequisite

**Cloudflare R2 is not provisioned** (ADR-0021). Archival is implemented and enforced against MinIO
locally and in CI, so this is **not an M2 completion requirement** — but production storage does not
exist, and nothing here should be read as deployment readiness.

```text
M2 milestone          → MET
Production deployment → still requires R2 provisioning
```

---

## M3 — Adding a country costs no code

**Status: Met** (2026-08-11).

*Phase 2 entry gate.* Luxembourg is added.

**Verified by:** the diff touches a reference file, connector coverage, ingested rules, and a registry
entry. **Nothing in `services/` or `ai/`.**

If the diff is larger, ADR-0002's central claim is false and the design is fixed before NZ and CH follow.
This is the cheapest possible moment to discover that.

**Germany's reference file exists as of 2026-08-11** (`.claude/skills/immigration/references/
countries/de.md`), which is what makes this milestone measurable: Luxembourg's diff can be compared
against a real one rather than against an idea of one. Note what Germany's own history says about
the claim being tested — § 18g needed **ADR-0024 and a change to `ai/career-roadmap`** before its
Abs. 2 route could be expressed at all. That was a genuine gap in the model rather than a country
detail, and the honest reading is that the first country to need a new *shape* of rule will always
cost code. Luxembourg tests whether a country needing no new shape costs none.

### Evidence

- Luxembourg connector implemented — `connectors/immigration-data/lu-legilux`.
- Luxembourg pathway seeded and registered — `lu.eu-blue-card`, `createRegistry`.
- Luxembourg rules ingested, with **multi-source provenance enforced**.
- Luxembourg eligibility evaluated end to end.
- **Live: ISCO group 2 at €80 000 → `met` via `citp-1-2`, `general` → `not_met`.**
- The evaluator, `ai/`, `apps/` and `services/api-gateway` required **zero changes**.

### The measured diff, 2026-08-11

Luxembourg's Blue Card rules are ingested and evaluated. **`ai/` and `apps/` are untouched, and so
is `services/api-gateway`** — the criterion's central claim holds where it matters most. The
evaluator absorbed a second country's two-route pathway with **no change at all**, which is the
thing ADR-0024 promised and this is the first evidence for it.

| Area | Files | What |
|---|---|---|
| `ai/` | **0** | the evaluator was not touched |
| `apps/` | **0** | no surface change |
| `services/api-gateway` | **0** | no gateway change |
| `packages/db` | 5 | ADR-0025's `requirement_sources` migration, schema, repository, pathway seed |
| `connectors/` | 6 | the new connector, the contract's optional `archivableSources`, the registry entry |
| `services/ingestion` | 2 | archiving every contributing instrument, not just the primary |

### Criterion deviation, recorded rather than hidden

> **M3's literal file-scope criterion was not met**, because Luxembourg exposed a previously
> untested single-source provenance assumption in the requirement model. The resulting change is
> isolated to persistence, provenance and ingestion. **No change was required in the evaluator,
> `ai/`, the web application, or the API gateway.**

The assumption was that a requirement has **one authoritative source**: `source_url` singular,
`document_id` a single foreign key. It held while every rule had one source, and nothing had tested
it. Luxembourg's threshold is a product of two instruments and no official act states the result
(ADR-0025), which makes this failure reachable:

```text
instrument A ── archived ── requirement ── enforcement passes
instrument B ── only named ── not archived
```

The rule looks enforceable and is **unrecomputable**. Correcting it was provenance infrastructure,
not country logic.

**This deviation is part of M3's value, not a caveat on it.** A milestone that had passed literally
would have told us nothing; this one found the single place the design was built for one case.

**What a country actually costs, on this evidence:** a reference file, a connector, a pathway seed,
a registry line — and nothing in the reasoning layers. The design claim ADR-0002 makes survives;
what M3 found instead is that the *provenance* model, not the rule model, was the one built for a
single case.

### `requirement_sources` is general infrastructure, not Luxembourg's

Describing it as "Luxembourg's provenance" would invite the next country to build a second one. The
abstraction it encodes is country-independent:

> **A legal requirement may depend on several authoritative instruments, each of which must be
> independently archived and attributable.**

Any future derived threshold reuses it. A second country-specific provenance mechanism would be a
regression, not a parallel solution.

### The architectural result

```text
country-specific complexity
        ↓
connector · ingestion · provenance
        ↓
normalized requirement + routes
        ↓
country-independent evaluator
```

The evaluator absorbed a second country's two-route pathway **without modification** — the first
evidence that ADR-0024's route abstraction generalises past the country it was written for.
**Nothing in future work may weaken this by adding a country-specific branch to the evaluator**; the
jurisdiction-free AST test in `ai/career-roadmap/tests/` is what keeps it honest.

### Three parser traps, kept permanently

Each protects against a **plausible but legally wrong value**, not against an error:

| Trap | Wrong reading it prevents |
|---|---|
| `une fois et demie`, split by consolidation markers | the rule discarded, or the digit `1` read as the multiplier |
| `65.652` — a French thousands separator | `Number()` giving sixty-five, a threshold almost anyone clears |
| a consolidation's year taken from the act rather than the consolidation | separate consolidations colliding under one object key |

Their tests assert the *incorrect* reading is not produced, which is the only form of this test that
catches a silent regression.

**Verified live**, not only by tests: ISCO group 2 at €80 000 evaluates `met` through the `citp-1-2`
route while the general route is `not_met` — the derogation doing exactly what it exists for,
computed from two instruments neither of which states that number.

---

## M4 — Four destinations, honestly compared

**Status: Met** (2026-08-12). **The evidence gate below closed on 2026-08-20** — all three owed
browser observations were made, and each cell records what was seen. **Two evidence boundaries
remain explicitly unproven** and are stated below rather than absorbed into the closure.

*Phase 2 complete.* DE, LU, NZ, CH, plus `REMOTE`, side by side.

**Comparison semantics are decided** — ADR-0026, Accepted 2026-08-11: destinations are compared,
grouped by binding constraint, and **never ranked by a score**.

**Verified by:** a user sees one market marked `unknown` on salary while another is complete, and
the comparison is still usable — partial coverage rendered as a designed state rather than a blank.

**That verification passed in a browser on 2026-08-12**, against the real gateway and the real
evaluator with all four countries' rules ingested. `/compare` rendered five destinations in two
groups: Luxembourg and `REMOTE` under *"You qualify — the distance is to the work itself"*,
Switzerland, Germany and New Zealand under *"The rules are what stand in the way"*. Switzerland
rendered `undetermined` with the questions that would move it, `REMOTE` rendered four dimensions
nobody has sourced beside an eligibility cell that **does not apply**, and the page stayed usable
with both on screen. That is the milestone's test: incomplete knowledge appeared as a designed
state and never as a mark against a destination.

### New Zealand cost less than Luxembourg, and that is the point

Ingested 2026-08-11. **`ai/`, `apps/`, `services/` and the schema were all untouched** — the diff is
the connector, its registry line, and two seed rows:

| Area | Files |
|---|---|
| `ai/` · `apps/` · `services/` | **0** |
| `packages/db` | 2 — a pathway row and two person-fact kinds, **no migration** |
| `connectors/` | the new connector, the registry entry |

Luxembourg cost a migration because it exposed the single-source provenance assumption. **New
Zealand reused that infrastructure unchanged**, which is what ADR-0025 claimed it would and the
first evidence for it. A third country whose rules come from two publishers now costs a connector.

New Zealand also exercises two things neither European country did: a rule the evaluator
**refuses to decide** (`market-rate`, `evaluation: 'manual'` — an immigration officer's judgement),
and a **routeless pathway**, which ADR-0024 said would behave exactly as pathways did before routes
existed. Both hold.

**Verified by:** a user sees one market marked `unknown` on salary while another is complete, and the
comparison is still usable — partial coverage rendered as a designed state rather than a blank.

### Coverage verification passed, 2026-08-11

The comparison shape and its composition are built, and **the verification is the test file** rather
than a claim beside it (`services/api-gateway/src/comparison/compose.test.ts`, 20 cases). All five
cell states are exercised against the destinations that actually produce them:

| State | Exercised by |
|---|---|
| `met` / `not_met` | a fully evaluated destination on both axes |
| `undetermined` | Switzerland — most of its conditions are an authority's judgement |
| `unmodelled` | a country with nothing ingested, saying **whose** gap it is |
| `not_applicable` | `REMOTE` — a fact about remote work, not about our coverage |

**`not_applicable` and `unmodelled` are produced by different branches with different sentences**,
because they look alike in a table and mean opposite things.

Every compliance clause ADR-0026 and ADR-0028 wrote down is asserted rather than described:
reordering the input leaves the output byte-identical; within-group order is alphabetical and
declared arbitrary **on the wire**; no `score`, `rank`, `position`, `weight` or `total` appears at
any depth; a group nobody is in is omitted rather than rendered empty; and the quota sits beside the
cells with no state, because no state is true of a capacity limit (ADR-0027).

### The surface, built 2026-08-12

`apps/web/app/compare` renders it. The decisions live in `apps/web/lib/comparison-view.ts`, which is
pure and tested; the component is markup and one fetch.

**Destinations are cards, not rows of one table**, and that is a correctness choice rather than a
layout preference. A table needs a column per dimension, and `REMOTE` declares four that no country
has — so every country would carry four empty cells, which is exactly the "empty means nothing"
reading ADR-0026 forbids. Columns are equal width for the same reason: a wider card is a ranking
expressed in pixels.

**Nothing on the page ranks.** No score, no position, no ordered list — a numbered list is a ranking
whatever the caption says. The wire's `orderingNote` is printed **above** the groups rather than in
small print beneath them, because by the time a reader reaches the bottom they have already assumed
the first row is the best one.

**The five states are distinguished three ways at once** — border style, label, and a sentence naming
whose statement the cell is. Measured in the browser rather than eyeballed:

| State | Border | Label | A statement about |
|---|---|---|---|
| `met` / `not_met` | solid, positive / negative | Met / Not met | **you** |
| `undetermined` | dashed, caution | Not answered yet | **the question** |
| `unmodelled` | **dotted on every edge** | We have not sourced this | **Zentavio** |
| `not_applicable` | no accent edge at all, muted | Does not apply here | **the destination** |

`unmodelled` and `not_applicable` differ in every rendered field, because they are both grey and mean
opposite things.

**`REMOTE` carries its non-recommendation sentence on every render**, not only when the row happens
to look complete, and it is marked with a dashed frame — *a different kind of thing*, never the
accent border that would read as *the best one*. ADR-0028 predicted it would usually be the row with
the fewest unresolved questions; it was, and the card says so in words.

**A quota with no figure renders as capped-and-unsourced.** Switzerland's cap has no number — the
annex is on a host whose `robots.txt` refuses the document — and the surface says that rather than
implying the pathway is open. New Zealand carries no quota at all and renders **no quota block**,
because an absent block is weaker than a sourced claim of "uncapped" and must not be upgraded into
one.

### What the real stack proved that the stub could not

The surface was first exercised against a throwaway stub gateway, then against the real one. Both
were used, and they are not interchangeable evidence:

| Established by the stub | Established only by the real stack |
|---|---|
| every cell state on one screen, including a numeric quota | CORS from the browser to the gateway |
| the five-state rendering and its measurements | grouping computed by `ai/career-roadmap` rather than hand-written |
| responsive layout at 356 px with no horizontal overflow | the 503 path from a genuinely dead evaluator, and recovery |
| | Switzerland's real quota reason and real `needs_from_user` question ids |
| | the evaluator's own disclaimer, emitted verbatim |

**A passing stub is evidence about a surface, never about wiring.** This repository has been caught
by the difference before: the gateway shipped with no CORS at all through the whole of M1c while
every server-side check passed.

**A destination that cannot be evaluated fails the whole comparison.** Killing the evaluator produced
the 503 card with **zero destination rows** — deliberately, because there is no cell state meaning
"we could not ask", and a quietly degraded row would turn a transport failure into a claim about a
country.

### The defect a browser found, again

**`<input type="date">` emits five-digit years.** Typing into the year segment in Chrome produces
`12025-08-12` — a legitimate value for the control, and not a date the gateway accepts. Both
`/compare` and `/eligibility` rendered the resulting 400 as *"Something went wrong on our side. This
is not a problem with your details."*, which is the right sentence for a 4xx we caused and a false
one here: the input is the cause, and a person told their own typing is our fault has nothing to do
next.

`apps/web/lib/as-of.ts` is the single guard, used by both surfaces. It is deliberately **not** a
second calendar implementation — the control cannot emit `2026-02-31`, the gateway parses the date
and is authoritative, and a second implementation would be a second thing to keep correct.

Reproduced in a browser on `/eligibility` **before** the fix. **Re-verified after it on
2026-08-20** — observation 1 below.

### Evidence gate — three browser observations, closed 2026-08-20

**Opened 2026-08-12 and closed 2026-08-20.** The gate was opened because the browser extension's
keyboard and mouse dispatch stopped reaching the page mid-session while screenshots and script
evaluation continued to work; a capture listener on `document` recorded zero events across a Chrome
restart, an extension reattach, three tabs and both windows. **Input dispatch worked on 2026-08-20**
— the same capture listener recorded `pointerdown`, `mousedown` and `click` on the first attempt, and
the tab reported `visibilityState: 'visible'` once clicked. Each cell below is **what was seen**, not
the word "passed".

| # | Observation | Result |
|---|---|---|
| 1 | `/eligibility` refuses a five-digit year with the guard's sentence and no retry button | **Observed 2026-08-20.** The year segment was typed to `12025-08-20`, which the control reported `valid`. `Check eligibility` rendered *"That date cannot be used. Use a four-digit year, as 2026-08-12."* — `asOfProblem`'s string verbatim. The page carried **one** button, `Check eligibility`; no retry control, and no *"Something went wrong on our side"*. **The gateway log recorded no request**, so the guard stopped it before the network |
| 2 | the recognised-degree question renders as a select, and answering **No** never reads as `met` | **Observed 2026-08-20.** The question rendered as a `<select>` with exactly `Choose… / Yes / No` (values `'' / true / false`), beside a salary question rendering as a free-text box on the same screen — the two control types are visibly different. Answering **No** stored JSON `false`, **not the string `'no'`**, and `de.eu-blue-card.qualification` and `.abs1-s2` both rendered **Not met**, basis *"has_recognised_academic_degree is False"*. No `Met de.eu-blue-card.qualification` appeared anywhere on the page |
| 3 | `/applications` records a title and shows the readiness prediction stored with it | **Observed 2026-08-20.** *"Cloud Platform Engineer at Testfirma GmbH"* was typed and recorded; the card rendered *"Applied 2026-08-20."* and *"We put your readiness at 15% when you applied."* The stored row carries `predicted_score = 0.1501` and `scorer_version = skill-gap/2026-08-03` — the rendered figure is the stored one, rounded |

Observations 2 and 3 were **M2's carried-over verification limitations**, not new M4 work; observation
1 was this milestone's own. All three are now closed against the real gateway, the real evaluator and
the real database.

**How observation 2 was exposed, and why it is not a stub.** The seeded user already carried
`has_recognised_academic_degree = false`, so the question was answered and its control was not
rendered. It was exposed by having the page's own `fetch` send a **different real user's** dev-auth
header — a user given a career track through `/gap`'s own chooser first, because the panel does not
render an eligibility result without a readiness to put beside it. **Nothing was stubbed**: every
response came from the gateway and the evaluator, and the answer was written through `POST
/v1/person-facts` by clicking *Save and re-check*. The seeded user's own facts were not modified.

### Two evidence boundaries that must not be overstated

**Closing the gate above did not touch either of these**, and the 2026-08-20 session did not attempt
them. They stay open, and a later session must not read the closed gate as covering them.

- **A numeric quota has only ever rendered against the stub.** No ingested pathway carries a figure,
  so the number-formatting path has no real-stack evidence. Switzerland's `null` and New Zealand's
  absent quota both do.
- **Switzerland's archived original in the dev database is a synthetic stand-in.** Its fixture ships
  no PDF bytes on purpose — the published directive carries SEM office addresses that the fixture
  privacy guard refuses, and the connector never parses a PDF anyway — so its own tests synthesise
  bytes and so did the dev ingest. It is evidence that the archival path runs; it is **not** evidence
  that a real Swiss PDF archives.

---

## M5 — Regulated professions get a real verdict

*Phase 3.* Origin-side rules modelled; recognition evaluated alongside the visa.

**Verified by:** a Filipino nurse or engineer receives a verdict that names recognition as the binding
constraint where it is, instead of the `unknown` that honesty currently requires.

**No longer blocked on a decision.** The origin-jurisdiction ADR was written and **Accepted on
2026-08-20 as ADR-0029** — origin scopes a requirement through `applies_to`, the person fact is where the
qualification was awarded rather than nationality, and a missing origin rule is `unknown` and never
`not_applicable`. This milestone carried "blocked on the origin-jurisdiction ADR" against three documents
that said no decision was outstanding; that disagreement is resolved, and this line records which side
was right.

**What remains is work, not a question:** ADR-0029's follow-up, and the per-profession recognition
research ADR-0010 already named. **No verdict changes until rules are ingested** — a licence-gated
profession still returns `unknown`, which is the honest answer and not a placeholder. Until it does, the
product cannot serve some of its largest user groups, which is why this is a named milestone rather than
a backlog item.

**One finding from writing it belongs here, because it is not an M5 dependency.** ADR-0010's safety
property — a licence-gated profession returns `unknown` rather than a visa-only verdict — is implemented
in `ai/career-roadmap` and **unreachable in production**: no caller passes `licence_gated`, and the
gateway retrieves requirements by pathway only, so no `recognition` row would reach the evaluator even if
one were ingested. Every document claiming that guard protects someone today is wrong. Fixing the wiring
needs no sourced data and no accepted ADR.

---

## M6 — Learning is verified, not claimed

*Phase 4.* Assessment and artifact verification promote a skill to `evidenced`.

**Verified by:** completing a course does **not** move readiness; passing the assessment does. Visible to
the user, so nobody optimizes for completions.

---

## M7 — The loop closes

*Phase 4–5.* Outcomes accumulate and begin changing what the platform says.

**Verified by:** a transition estimate whose basis reads `observed, n=40` rather than `assumed from
resource durations`. Same surface, different provenance — that shift is the milestone.

---

## M8 — Interview prep where support exists

*Phase 5.* Process models above minimum support; honest generic prep below it.

**Verified by:** a company with thin reports produces "we don't have enough reports yet" plus useful
role-generic prep — never fabricated stages.

---

## M9 — Prediction with a track record

*Phase 6.* Scores calibrated against recorded outcomes.

**Verified by:** a published calibration comparison — of the matches we scored above 0.7, what share
resulted in an interview. Whatever that number is, it is reported.

Willingness to publish it is the milestone. A platform that will not check its own predictions is not
predicting.

---

## Sequencing rules

- **Finishing beats starting.** Two half-milestones deliver nothing; one whole slice delivers a product.
- M3 is a **gate**, not a feature: it validates the plugin claim before three more countries depend on it.
- M5 is blocked by an ADR, not by effort. Unblocking it is a decision, and it should be made early
  because it affects the schema.
- M7 and M9 are gated on **data accumulating**, so outcome capture ships as early as it can hold —
  **M2**, not M1 (ADR-0019). Calibration data cannot be backfilled, so the window opens the moment
  the first prediction has a checkable result, which is an application.

## Related

- `phases.md`, `mvp.md`, `backlog.md`
- `.claude/skills/roadmap/SKILL.md` — definition of done
