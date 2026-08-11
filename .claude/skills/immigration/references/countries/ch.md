# Switzerland (`CH`)

> **Purpose:** Immigration reference model for Switzerland. Defines which pathways exist, which
> rules constitute them, and which official sources are authoritative. **Values live in
> `knowledge-engine/immigration`, not here.**

_Status: authored 2026-08-11 from the SEM directives. **No connector exists and no rule is
ingested** — this is the model a connector will be written against, the order `README.md`
prescribes. Everything below is read from a source or marked `unknown`._

**Switzerland is the country whose rules are least like a threshold.** Germany, Luxembourg and New
Zealand all pivot on a salary figure. Switzerland pivots on **quotas, priority for domestic workers,
and judgements an authority makes** — which makes it the hardest to model and the most useful test
of whether the product can say *"we cannot tell you"* without saying nothing.

---

## Official sources (tier 1 only)

| Source | Authoritative for | URL | Refresh window |
|---|---|---|---|
| SEM — Weisungen AIG, Kapitel 4 | **the operative admission rules** for residence with gainful employment | `sem.admin.ch/.../weisungen-aig-kap4-d.pdf` | on revision; the document states its own `Stand` date |
| Fedlex — AIG (SR 142.20), VZAE | the Act and the ordinance the directives implement | `fedlex.data.admin.ch` | **metadata only — see below** |
| SECO — Nationaler Lohnrechner | the customary-wage comparison the directives point at | referenced from Kapitel 4 § 4.3.4 | `unknown` |

### Fedlex publishes the law and forbids us the documents

This is the finding that shapes the connector, and it is unlike any other country here.

`fedlex.data.admin.ch` runs the **same JOLux ontology and the same "Casemates" platform as
Legilux** — the SPARQL walk `lu-legilux` already performs works unchanged:

```text
/sparqlendpoint  → eli/cc/2007/758  (AIG)
  → isMemberOf → dated consolidations
  → isRealizedBy → isEmbodiedBy → html · xml · pdf-a · docx, in de/fr/it/en
  → isExemplifiedBy → https://fedlex.data.admin.ch/filestore/…
```

And `fedlex.data.admin.ch/robots.txt` says:

```text
User-agent: *
Disallow: /filestore/*
```

**The metadata is permitted; the document bytes are not.** A manifestation URL `303`s to a metadata
page — itself an Angular application — and the only route to the file is the disallowed path.

Under our own rules that is a full stop for Fedlex documents, not an inconvenience:
`.claude/skills/connectors/SKILL.md` forbids evading a robots restriction, and **ADR-0021 requires
the original archived** before a rule is accepted — no fetch, no archive, no ingestion. Metadata
alone is not a rule.

`www.fedlex.admin.ch` allows `/` but serves an Angular shell with no law text, so it is not an
alternative route.

### SEM's directives are the way in, and they are the operative layer anyway

The same lesson New Zealand taught: the statute is not necessarily where the operative rules live.
**SEM's Weisungen bind the cantonal authorities who actually decide Swiss permits**, and SEM
publishes them as PDFs on a host that declares no restriction at all — `sem.admin.ch/robots.txt`
returns `404`, a plain error page rather than a challenge.

**No stated restriction is not an invitation.** Rate-limit conservatively, and treat the 167-page
PDF as one fetch per refresh rather than one per rule.

Verified 2026-08-11: `weisungen-aig-kap4-d.pdf`, 167 pages, ~1.5 MB, **extracts cleanly with
`pypdf`** — none of the font-map damage the Bundesanzeiger PDF has. The page states the document's
date beside the link, and the document states its own `Stand`.

## Language

- **Official languages:** German, French, Italian, Romansh. The directives are published in German,
  French and Italian; Fedlex adds English for many acts, and **the English is not authoritative**.
- **Required level per pathway:** the directives carry *"Kenntnisse der am Arbeitsort gesprochenen
  Landessprache"* (§ 4.3.5.5) — knowledge of the language spoken **at the place of work**, which is
  a per-canton question rather than a national one. That is a real rule and a genuinely hard one to
  model, because the required language depends on where in Switzerland the job is.
- **Workplace reality · English-only viability:** `unknown` — unsourced, and more consequential here
  than in the other three markets for the reason above.

## Pathways

### `ch.third-country-worker` — Aufenthalt mit Erwerbstätigkeit (third-country nationals)

**Not yet seeded.** Provisional id.

- **Who it is for:** third-country nationals — the population `countries.md` flags as *"the
  constraint to model carefully"*. EU/EFTA nationals move under the free-movement agreement and are
  a different question entirely.
- **Legal basis:** AIG art. 18–23, VZAE, as implemented by **Weisungen AIG Kapitel 4**.

#### What the directives actually require

| Condition | Basis | Shape it would take |
|---|---|---|
| **Höchstzahlen** — the quota is not exhausted | § 4.2, art. 20 AIG, art. 19–21 VZAE | **`quota`** — see below |
| **Gesamtwirtschaftliches Interesse** — the job serves the wider economic interest | § 4.3.1, art. 18 AIG | **`manual`** |
| **Vorrang** — no suitable domestic or EU/EFTA worker was found | § 4.3.2, art. 21 AIG | **`manual`** |
| **Stellenmeldepflicht** — the vacancy was reported, where the duty applies | § 4.3.3, art. 21a AIG | `boolean`, **conditional on the occupation** |
| **Orts-, berufs- und branchenübliche Lohn- und Arbeitsbedingungen** | § 4.3.4 | **`manual`** — customary for place, profession and sector |
| **Persönliche Voraussetzungen** — qualified worker | § 4.3.5, art. 23 AIG | `boolean` plus `manual` |
| Knowledge of the language spoken at the place of work | § 4.3.5.5 | `unknown` until read in full |

**Most of this pathway is `manual`, and that is the honest reading rather than a modelling
shortfall.** *"Customary for the place, profession and sector"* is a comparison an authority makes,
assisted by SECO's national wage calculator; *"wider economic interest"* and *"priority"* are
judgements. Turning any of them into a number would be inventing a rule nobody wrote — the same
refusal New Zealand's market-rate test earns.

**The consequence for a verdict is worth stating in advance:** a Swiss verdict will be largely
`undetermined`, with the reasons named. That is a correct answer to *"can I work in Switzerland?"*
for a third-country national, because the true answer genuinely is *"a cantonal authority decides,
and here is what they weigh."* Anything more definite would be false confidence.

#### The quota, and why its number is out of reach

`Höchstzahlen` are set by the Federal Council in **VZAE Anhang 1 und 2** (§ 4.2.1) — an ordinance
annex, published on Fedlex, behind the `/filestore/` disallow. So:

- **the rule that a quota exists** is in SEM's directives and is ingestible;
- **the quota's value** is not currently retrievable.

A `kind: 'quota'` row with no value is not evaluable, so this is a real gap rather than a
formality. It is also the one gap that ADR-0025's provenance model cannot paper over: a missing
operand is a missing operand.

**A quota is also not a per-person condition.** It is a capacity limit on the canton, not something
an applicant satisfies or fails, and `docs/database/entities/requirement.md`'s invariant is *one
evaluable requirement per row*. How a quota is expressed without becoming a rule the applicant
appears to fail is **an open question this file does not answer** — and it should be settled before
a connector emits one, on the ADR-0024 and ADR-0025 pattern.

#### Exceptions worth modelling

§ 4.2.2 exempts short stays from the quota — work of at most four months in any twelve, and artists
for at most eight. Those are durations, which are the one genuinely numeric thing in the chapter.

#### Stages, dependent rights, permanent residency, citizenship

**`unknown` — not sourced.** Swiss permits are graded (L, B, C) and the progression to settlement
and naturalisation is long, cantonal and outside Kapitel 4.

## Qualification recognition

**`unknown` — no rule ingested.** Art. 23 AIG's *"Persönliche Voraussetzungen"* asks for managers,
specialists and qualified workers, and § 4.3.5.3 makes a separate case for holders of **Swiss**
tertiary qualifications — which implies a recognition question for foreign ones that this chapter
does not answer.

## Labor market

**The labour market is a condition of the permit, not background.** `Vorrang` requires that no
suitable domestic or EU/EFTA worker was found, and the **Stellenmeldepflicht** applies in occupations
where national unemployment reaches a stated threshold — so a Swiss verdict depends on the state of
an occupation's labour market at the time of application.

Demand, hiring difficulty, sponsorship prevalence and timelines: `unknown` — unsourced. The list of
occupations subject to the reporting duty is published and **would be ingestible**; it is not read
here.

## Compensation

**No statutory minimum exists to source.** Switzerland has no national minimum wage, and the
directives require *customary* pay rather than a floor — assessed against SECO's national wage
calculator. So unlike the other three countries there is **no threshold figure to ingest at all**,
and the honest model has none.

## Cost and living

**`unknown` — unsourced.** Cost of living varies sharply by canton, as do tax and health-insurance
obligations, and health insurance is mandatory and privately purchased — a material cost a new
arrival meets immediately.

## Culture and process

**`unknown` — unsourced.**

## Gotchas

**Fedlex's documents are disallowed while its metadata is not.** A connector that walks the SPARQL
graph will reach a file URL it must not fetch. Recorded so nobody writes that fetch and discovers
the policy afterwards.

**The AIG's English translation is not authoritative.** Fedlex publishes English for many acts;
Switzerland's authoritative languages are German, French and Italian. A rule parsed from the English
is a rule parsed from a convenience.

**`sem.admin.ch` has no `robots.txt`** — a `404`, not a challenge. Absence of a stated restriction
is not permission to hammer it.

**The directives are one large PDF with a `Stand` date, not per-section dates.** Unlike New Zealand's
per-section `Effective` lines, every rule extracted from one edition shares one date, so a revision
re-dates everything at once and `supersedes` chains a whole chapter rather than a rule.

**Most conditions are judgements.** A connector that finds no number in a 167-page chapter has not
failed — that is the chapter.

## Related

- `.claude/context/countries.md` — the full country model, and its note that Swiss third-country access is the constraint to model carefully
- `de.md`, `lu.md`, `nz.md` — the three countries whose rules are thresholds
- ADR-0026 (comparison semantics — Switzerland is its hardest case), ADR-0025, ADR-0024, ADR-0021
- `docs/roadmap/milestones.md` — M4's verification
