# Countries

> **Purpose:** Which markets Zentavio supports and the **shape** every country's knowledge
> must take. This file defines structure and scope only. Actual values — thresholds, salaries,
> timelines — live in the knowledge engine with provenance, and in
> `.claude/skills/immigration/references/countries/<code>.md` as the reference model.
> **Never state a country fact from this file or from memory.**

## Origin market

**The Philippines (`PH`) is the primary origin**, and that is a structural fact, not a marketing
segment. Filipino professionals and students face an **origin-side** regulatory layer that
destination-only platforms ignore: overseas employment regulation, professional-licence and
qualification recognition, and document authentication.

So a country target has two jurisdictions in play — where the person is coming *from* and where they
are going. The rule model expresses this: see "Origin-side rules" below.

## Launch markets

| Code | Market | Primary language(s) | Why it is in the launch set |
|---|---|---|---|
| `DE` | Germany | German | Large demand, structured and documented pathways |
| `LU` | Luxembourg | Luxembourgish, French, German | Multilingual working reality; small, high-value market |
| `NZ` | New Zealand | English | English-medium; occupation-list driven |
| `CH` | Switzerland | German, French, Italian | High compensation; third-country-national access is the constraint to model carefully |

## Future markets

`NL` · `IE` · `AU` · `CA` · Nordics (`SE`, `NO`, `DK`, `FI`)

Not built yet, and deliberately not half-built. Depth before breadth
(`.claude/skills/roadmap/SKILL.md`): each is a reference file, connector coverage, ingested rules, and a
registry entry — never a code change.

## Remote

`REMOTE` is a first-class target but modelled differently: no jurisdiction, no pathway. Its constraints
are employer policy, time zone overlap, contracting and tax treatment, and payment mechanics. For a
Philippines-based user it is often the *correct* answer and the fastest one, so it never renders as a
country with an empty visa section.

**How it compares (ADR-0028, Accepted 2026-08-11).** Its **eligibility axis is `not_applicable` by
construction** — a statement about `REMOTE`, never `unknown` or `unmodelled`, which would claim we
failed to source something that does not exist. Its **employability axis is exactly the one every
country uses**, because readiness against a career track has no jurisdiction in it; for many users
it will be the only complete row on screen, and that must not read as a recommendation.

**Its own constraints are not a coverage gap.** Employer policy, time zones, contracting, tax and
payments are properties of **an employer and a contract, not of a place** — no authority publishes
them because there is no authority. They are named and left unsourced with that reason stated,
never invented to make a table symmetrical. `backlog.md` sequences the tractable piece.

**No `remote.*` pathway, ever**, and no connector for one.

## Origin-side rules

A Filipino applicant's viability depends on requirements that are **not** destination rules:

| Domain | Why it is structural |
|---|---|
| Overseas employment regulation | processing and clearance requirements imposed by the origin state |
| Professional licence recognition | regulated professions (nursing, engineering, teaching) are licensed at origin and re-assessed at destination |
| Academic credential evaluation | destination bodies assess origin qualifications against their own frameworks |
| Document authentication | apostille and authentication chains for civil and academic documents |
| Language certification | which test and which level a destination accepts |

**These are tier-1-sourced rules like any other**, and every value must come from the responsible
authority with a date. Nothing above asserts a specific requirement — it names the domains that must be
modelled and sourced.

**The schema expresses this, and the gap this file used to describe is closed.** ADR-0010 generalized
`immigration_rules` into `requirements` with `domain`, `imposed_by` (`origin` | `destination` |
`bilateral`), and `authority` — so `jurisdiction` names the country whose authority imposes a rule,
and `imposed_by` names which side of the move that authority sits on. A Philippine employment-clearance
requirement and a German salary threshold are both rows in one table, distinguishable and separately
evaluable.

*Until 2026-08-04 this section read "Open design gap: `requirements.jurisdiction` currently assumes
the destination". It has not assumed that since the table was created on 2026-07-29.*

**Still blocked on data, not schema.** No recognition, credential, authentication, or
employment-clearance rule is ingested. Until a profession's rules exist and are dated, a licence-gated
profession returns `unknown` with recognition named — never a visa-only verdict that reads as an
answer.

## The country model

Every supported country is described by these fields. A field with no sourced value is
`unknown` — never inferred, never carried over from a similar country.

**Identity and language**
`code` · `officialLanguages` · `workplaceLanguageReality` (what teams actually use, by
sector) · `requiredLanguageLevel` (per pathway, CEFR where applicable) ·
`englishAvailability` (how viable an English-only career is, by sector, with basis)

**Immigration** — tier 1 sources only
`pathways[]` — each with `name`, `eligibility[]`, `salaryThreshold`, `occupationLists`,
`documents[]`, `stages[]`, `typicalTimeline`, `quota`, `dependentRights`,
`permanentResidency` (conditions and clock), `citizenship` (conditions and clock),
`effectiveFrom`, `sourceUrl`, `retrievedAt`, `version`

**Labor market**
`demandBySkill` · `demandByCareer` · `hiringDifficulty` (with what makes it hard) ·
`typicalHiringTimeline` · `sponsorshipPrevalence` (do employers actually sponsor?) ·
`preferredCertifications` · `commonSkillStacks` · `seasonality`

**Compensation** — tier 1, or tier 2 with a named methodology
`salaryBands` by career and seniority, with `currency`, `period`, `sourceUrl`, `asOf` ·
`salaryTransparencyRules` · `bonusAndEquityNorms`

**Cost and living**
`costOfLiving` (by city where it differs materially) · `housingReality` ·
`taxation` (brackets, social contributions, treaties) · `healthcare` (access model, cost,
waiting period for new arrivals)

**Culture and process**
`interviewNorms` · `resumeConventions` (photo, length, personal details — these differ
sharply and getting them wrong costs interviews) · `noticePeriodNorms` · `workingHoursNorms`

**Sources**
`officialSources[]` — the tier-1 portals this country's rules come from, with what each one
is authoritative for.

## Rules

1. **Immigration rules and salary thresholds are tier 1 only.** Government or official portal,
   dated, versioned, linked. See `knowledge-sources.md`.
2. **Rules are versioned, never overwritten.** A threshold that changed is two rows with
   `effectiveFrom` dates — a person's plan was made against the old one.
3. **Stale is visible.** Every country fact carries `retrievedAt` and a refresh window. Past
   the window, confidence drops and the UI says so.
4. **Never generalize across countries.** Nothing about Sweden may be inferred from Norway,
   nothing about the EU may be applied to a member state without its own source.
5. **Information, never advice.** Zentavio reports sourced rules and their implications, and
   names who to consult. No "you should apply for X."
6. **Language reality is part of viability.** Visa-eligible and linguistically unemployable is
   not an opportunity — say which constraint binds.
7. **Adding a country is additive.** A reference file, knowledge-engine rows, connector
   coverage, and a registry entry. Zero changes to services or AI code. If code must change,
   the design is wrong.

## Adding a country

1. Create `.claude/skills/immigration/references/countries/<code>.md` from the country model
   above.
2. Identify the tier-1 official sources and record what each is authoritative for.
3. Add or extend an `immigration-data` connector for those sources.
4. Ingest rules with `effectiveFrom`, `version`, `sourceUrl`, `retrievedAt`.
5. Add labor-market and salary coverage, or mark those domains `unknown` — partial coverage is
   acceptable and honest; invented coverage is not.
6. Set refresh windows per domain (rules change on legislative timelines; salaries annually).
7. Verify the honest-unknown path renders correctly before launching the country.

## Related

- `knowledge-sources.md` — tiers and per-domain floors
- `ai-principles.md` — rules 8, 9 (never fabricate salaries or immigration rules)
- Skills: `immigration` (+ `references/countries/`), `knowledge-engine`, `connectors`
- `docs/architecture/immigration.md`, `docs/features/country-preferences.md`,
  `docs/features/immigration-tracking.md`, `docs/database/entities/requirement.md`
