# New Zealand (`NZ`)

> **Purpose:** Immigration reference model for New Zealand. Defines which pathways exist, which
> rules constitute them, and which official sources are authoritative. **Values live in
> `knowledge-engine/immigration`, not here.**

_Status: authored 2026-08-11 from the current Immigration Instructions. **No connector exists and
no rule is ingested** — this is the model a connector will be written against, the order
`README.md` prescribes. Everything below is read from an instruction or marked `unknown`._

**Read `de.md` and `lu.md` first.** Germany is the worked example of a country whose rules are
ingested; Luxembourg is the one whose threshold is computed. New Zealand is different from both in
a way that matters: **its operative rules are not in its statute.**

---

## Official sources (tier 1 only)

| Source | Authoritative for | URL | Refresh window |
|---|---|---|---|
| Immigration New Zealand — Operational Manual | **the operative immigration instructions** | `immigration.govt.nz/opsmanual/` | per section; each carries its own `Effective` date |
| Stats NZ | the median wage, where an instruction is pegged to it | `stats.govt.nz` | as published; **crawl-delay 10** |
| Employment New Zealand (MBIE) | **the adult minimum wage**, where an instruction is pegged to it | `employment.govt.nz/pay-and-hours/pay-and-wages/minimum-wage/` | annual — rates change on **1 April** |

### The statute is not where the rules are

This is the fact that shapes everything else.

```text
Immigration Act 2009        empowering — the framework
        ↓
Immigration Instructions    operative — certified under the Act, published by INZ
```

**A connector pointed at the Act would find no eligibility rule to ingest.** The instructions are
what an immigration officer applies, and INZ publishes them. That distinction is what makes New
Zealand tractable despite the next paragraph.

### `legislation.govt.nz` is off-limits, and it does not block us

Every path on `legislation.govt.nz`, `robots.txt` included, answers **`202` with
`x-amzn-waf-action: challenge`** — an AWS WAF bot challenge, which is an explicit anti-automation
control. `.claude/skills/connectors/SKILL.md` forbids working around one, so the Act is not
retrievable by us. The same applies to `data.govt.nz` and `catalogue.data.govt.nz`, which sit
behind Imperva and answer HTML where the CKAN API is documented to answer JSON.

**Neither blocks New Zealand**, because neither holds the operative rules. Recorded so nobody
re-discovers the challenge and concludes the country is unavailable.

### The Operational Manual serves flat HTML, and its viewer is not its delivery

`/opsmanual` returns a ~9 KB ExtJS shell, and so does every fragment path — which reads exactly
like Luxembourg's SPA and is **not** the same problem. The shell is a *viewer*. The content is
ordinary documents:

```text
/opsmanual/toc.htm      the real index — ~316 KB, ~1 550 section links
/opsmanual/<id>.htm     one instruction section, as flat HTML
```

`toc.htm` is the site's own published table of contents. `/opsmanual/` is **not** among the paths
INZ's `robots.txt` disallows (`/admin`, `/Security`, `/_search`, `/_visa-search`,
`/_list-collection-search`), and no challenge is served. **No browser is required and no control is
touched.**

`/opsmanual-archive/` holds superseded editions and says of itself *"This is not current policy"* —
useful for history, never for a current rule.

### Versioning is better than Germany's

Every section ends with **`Effective DD/MM/YYYY`** and links its own superseded editions with their
dates. So `effective_from` is read from the instrument rather than hardcoded to an amendment date,
which is the limitation `de-aufenthg` carries and documents.

## Language

- **Official languages:** English, te reo Māori, and New Zealand Sign Language. The instructions are
  published in English.
- **Required level per pathway:** the AEWV instructions carry **English language requirements**
  (WA4.12) — a real rule, not an absence, and unusually for our three countries it is *inside* the
  work pathway rather than a separate domain.
- **Workplace reality by sector · English-only viability:** `unknown` — unsourced, and the least
  pressing of the three markets: New Zealand is English-medium, which is a fact about the country
  rather than a sourced claim about employers.

## Pathways

Two are worth modelling, and they are different kinds of thing. **Neither is seeded.**

### `nz.aewv` — Accredited Employer Work Visa

A **work** visa, and the closest analogue to the EU Blue Card in what it asks.

- **Who it is for:** someone with an offer from an INZ-accredited employer for a job that has passed
  a Job Check.
- **Legal basis:** Immigration Instructions **WA** — `WA2` employer accreditation, `WA3` Job Check,
  `WA4` the visa itself.

**Its structure is three-sided, and only one side is about the applicant.** WA2 is about the
employer, WA3 is about the job, WA4 is about the person. A pathway model that assumes every
requirement is answerable by the applicant will mis-handle this: *"is your employer accredited?"*
and *"has this job passed a Job Check?"* are facts about someone else.

| Condition | Basis | Shape it would take |
|---|---|---|
| Generic work-visa requirements | `W2.10.1`, via `WA4.10` | several, mostly `document-present` |
| An offer meeting the employment requirements | `WA4.10.1` | `boolean` |
| Suitably qualified by training and experience | `WA4.10.5` | `manual` — an officer decides |
| Minimum skills threshold | `WA4.10.6` | `unknown` until read |
| Remuneration at or above the **adult minimum wage** | `WA3.15.5` | `monetary`, `numeric-gte` — **derived, see below** |
| Not less than the **market rate** for the occupation | `WA3.15.5` | **`manual`** — a judgement, not a number |
| Maximum continuous stay not exceeded | `WA4.11.1` | `numeric-lte` |
| English language requirements | `WA4.12` | `unknown` until read |

**The market-rate test is the interesting one.** *"Not less than the market rate for that
occupation"* is an immigration officer's assessment, not a threshold. `evaluation: 'manual'` exists
for exactly this and the evaluator deliberately declines to decide it — which is the honest outcome
and must not be quietly turned into a number.

### `nz.skilled-residence` — Skilled Residence

A **residence** pathway (`SR` instructions), and where the median wage actually appears — for
example `SR5.20 Work in New Zealand earning at least twice the median wage`.

Not modelled here beyond naming it. It is a different question from *"can I work there?"* and
mixing the two into one pathway would produce a verdict about neither.

## The derived thresholds, and how they differ from Luxembourg's

**Both NZ thresholds are derived, and ADR-0025 already covers the shape** — every contributing
instrument archived and cited through `requirement_sources`. No new architectural decision is
needed.

**The AEWV rule needs no arithmetic at all**, which is a case ADR-0025's vocabulary turns out to
cover without stretching. The instruction states the rule and MBIE states the figure, so the
instruction is `role: primary` and MBIE is `role: operand`; there is no `formula` row because
nothing is multiplied. Luxembourg needed one because its RGD supplies a multiplier.

**And the figure is hourly**, which removes a step both European rules have. `WA3.25` assesses
remuneration as *guaranteed payment per hour*, so there is no annualisation to get wrong — the
threshold and the answer are in the same unit as published.

What differs between the two NZ pathways is the *operand*:

| Pathway | Instruction says | Operand comes from |
|---|---|---|
| AEWV | at or above the **adult minimum wage** | **MBIE** (`employment.govt.nz`) — located 2026-08-11 |
| Skilled Residence | at least **twice the median wage** | **Stats NZ** |

**The AEWV operand was located on 2026-08-11 and the gap is closed.** The legal instrument — the
Minimum Wage Order — is made under the Minimum Wage Act and published on `legislation.govt.nz`,
which we cannot reach. **MBIE publishes the rate itself** on `employment.govt.nz`, and MBIE
administers that Act: this is the responsible authority stating its own figure, structurally the
BMI/Bundesanzeiger case rather than the `guichet.public.lu` case.

It passes the test `guichet` failed. **Three MBIE pages state one figure** — the rates table, the
change announcement, and the historical table — and the historical table carries an `In force from`
date for every rate back to 1997, which is a supersession chain neither Germany nor Luxembourg
hands over so readily.

**The honest caveat, recorded so it can be overruled:** the Bundesanzeiger *is* the official gazette
and publication there is the legal act; `employment.govt.nz` is the ministry's website. Weaker in
that one respect, and treated as tier 1 on the strength of *whose* figure it is.

**Also checked and ruled out:** `mbie.govt.nz` itself serves an Incapsula challenge — off-limits,
like `data.govt.nz`. `gazette.govt.nz` permits `/notice/` paths but disallows `*/pdf`, and a
Minimum Wage Order is a legislative instrument rather than a Gazette notice, so it is not the
channel regardless.

**A note for whoever picks this up.** The AEWV pay rule was pegged to the **median wage** until
recently and is now pegged to the **minimum wage** (`WA3.15 Effective 08/12/2025`). Anything
written from memory, from a guide, or from a search summary will very likely state the old rule.
Read the instruction.

## Qualification recognition

**`unknown` — no rule ingested.** *"Suitably qualified by training and experience"* (`WA4.10.5`) is
an officer's assessment rather than a recognition rule, and New Zealand's regulated occupations are
licensed by separate bodies not read here. Same open boundary as `de.md` and `lu.md`: `user.md`
places recognition in the unbuilt `user_immigration_facts`, while a `credential`-domain requirement
would read it as an ordinary input.

## Labor market

**`unknown` — nothing sourced.** Demand, hiring difficulty, sponsorship prevalence, timelines,
preferred certifications.

One structural fact *is* sourced and belongs here rather than in a guess: the **Job Check** includes
a **labour market test** (`WA3.20`), so for many roles the New Zealand labour market is not
background context but a **condition of the visa**. That is a difference from Germany and
Luxembourg worth modelling carefully when the data exists.

## Compensation

**Nothing sourced beyond the statutory floor**, which is not yet retrievable. As with the other two
countries: when the figure exists it is a **floor for a visa, not a market rate**, and rendering it
as a salary expectation would mislead somebody about the offer they should be negotiating.

## Cost and living

**`unknown` — unsourced.** Cost of living by city, housing, tax residency, and healthcare
entitlement for new arrivals.

## Culture and process

**`unknown` — unsourced.** Interview norms, CV conventions, notice periods, working hours.

## Gotchas

**Dates are `DD/MM/YYYY`.** `09/10/2023` is 9 October, not 10 September. A parser reading it the
American way produces a **valid date that is wrong**, which is the same failure class as the German
font map and the French thousands separator: no error, no empty result, just a rule that takes
effect in the wrong month. A test must assert the wrong reading is not produced.

**The viewer is not the delivery.** `/opsmanual` and every fragment path return the same ExtJS
shell with a `200`. A connector pointed there fetches a page that parses cleanly and contains no
instruction. Fetch `toc.htm` and the numbered section files.

**A section's id is not its section code.** `77807.htm` is `SR2.5`. The id is stable and the code is
what a person cites, so both belong in provenance — the id to fetch, the code to explain.

**`/opsmanual-archive/` is superseded policy** and says so about itself. Reading it for a current
rule would produce a confidently wrong answer with a real citation attached.

**The rules move.** The AEWV pay threshold changed instrument within the last year. `Effective`
dates per section make this visible; nothing else does.

## Related

- `.claude/context/countries.md` — the full country model
- `de.md` — the worked example · `lu.md` — the derived-threshold example
- ADR-0025 (derived thresholds and multi-source provenance), ADR-0024 (routes)
- `docs/roadmap/milestones.md` — M4's verification, and ADR-0026's comparison semantics
