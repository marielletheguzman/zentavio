# Countries

> **Purpose:** Which markets Zentavio supports and the **shape** every country's knowledge
> must take. This file defines structure and scope only. Actual values — thresholds, salaries,
> timelines — live in the knowledge engine with provenance, and in
> `.claude/skills/immigration/references/countries/<code>.md` as the reference model.
> **Never state a country fact from this file or from memory.**

## Supported markets

| Code | Market | Primary language(s) | Notes |
|---|---|---|---|
| `DE` | Germany | German | Large market, structured pathways |
| `CA` | Canada | English, French | Points-based system |
| `AU` | Australia | English | Points-based, occupation lists |
| `NL` | Netherlands | Dutch, English | High English availability |
| `SE` | Sweden | Swedish, English | |
| `NO` | Norway | Norwegian, English | |
| `JP` | Japan | Japanese | Language is often the binding constraint |
| `SG` | Singapore | English | Employer-driven pathways |
| `AE` | United Arab Emirates | Arabic, English | Sponsorship-based, no PR path in the usual sense |
| `REMOTE` | Remote worldwide | English | Not a jurisdiction — see below |

`REMOTE` is a first-class target because it is what many users should actually pursue, but it
is modeled differently: no immigration pathway, and its constraints are employer policy, time
zone, contracting and tax treatment, and payment mechanics. Never render it with an empty
visa section — it has a different shape, not a missing one.

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
  `docs/features/immigration-tracking.md`, `docs/database/entities/immigration-rule.md`
