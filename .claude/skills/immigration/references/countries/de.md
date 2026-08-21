# Germany (`DE`)

> **Purpose:** Immigration reference model for Germany. Defines which pathways exist, which
> rules constitute them, and which official sources are authoritative. **Values live in
> `knowledge-engine/immigration`, not here.**

_Status: authored 2026-08-11. One pathway modelled (`de.eu-blue-card`), sourced end to end. Most
sections below are **explicitly unsourced** and say so — that is the honest state, not an omission
to be filled in from memory._

**Read this before adding to it.** Germany is the only market whose rules are actually ingested, so
this file is also the worked example of what a country model looks like when it is real. Every
claim here is either traceable to a statute, to a published announcement, or to a file in this
repository. Anything that would require asserting a fact no source has been read for is marked
`unknown` and left that way (`.claude/context/countries.md` — *"partial coverage is acceptable and
honest; invented coverage is not"*).

---

## Official sources (tier 1 only)

| Source | Authoritative for | URL | Refresh window |
|---|---|---|---|
| Bundesamt für Justiz — AufenthG | eligibility categories, qualifying percentages, ISCO-08 groups, minimum employment duration | `gesetze-im-internet.de/aufenthg_2004/__18g.html` | reviewed annually; a statute changes on legislative timelines and the page carries no machine-readable date |
| Bundesministerium des Innern — Bekanntmachung in the Bundesanzeiger | the concrete minimum gross annual salaries, per calendar year | `bundesanzeiger.de/pub/de/amtlicher-teil` | **31 December of the preceding year** — the statute itself sets this |

**The refresh window for the salary figures writes itself.** § 18g Abs. 7 requires BMI to publish
the following year's minimums in the Bundesanzeiger by 31 December. So `refresh_after` is that
date, `version` is the calendar year, and the year's bounds are `effective_from` / `effective_to`.

**One rule, two sources.** The statute gives the *percentage and the category*; the announcement
gives the *euro figure for one year*. Neither alone is a usable requirement row, which is why
`connectors/immigration-data/` holds two German connectors rather than one.

### Sources deliberately not used

| Source | Why not |
|---|---|
| `make-it-in-germany.com` | Serves a **Radware bot-protection challenge**. Its `robots.txt` says `Allow: /`, and that is not the whole answer — working around an anti-automation control is forbidden by `.claude/skills/connectors/SKILL.md`. Fetch a page and see what it actually serves before trusting `robots.txt`. |
| `bamf.de` | No `robots.txt` at all (404), and not yet probed with a valid URL. Unassessed, not rejected. |

Nothing below tier 1 may produce a rule for this country. See
`.claude/context/knowledge-sources.md`.

## Language

- **Official language:** German.
- **Workplace reality by sector:** `unknown` — **not sourced.** This is a real gap: for a Filipino
  professional deciding between Germany and an English-medium market, it is often the deciding
  fact. It needs a named source with a methodology, not an impression.
- **Required level per pathway:** **the EU Blue Card pathway as modelled imposes no language
  requirement**, and that is a property of § 18g rather than an absence in our coverage. A language
  rule for another pathway would be a `language`-domain requirement with its own authority.
- **English-only career viability:** `unknown` — unsourced.

Language is part of relocation viability, not a footnote. Where the level is unknown, the surface
says so rather than implying none is needed.

## Pathways

### `de.eu-blue-card` — Blaue Karte EU (EU Blue Card, Germany)

The statute's own term, untranslated: the row names the thing an authority would recognise.

- **Who it is for:** qualified employment under § 18g AufenthG. Three distinct populations, which
  is why it is modelled as three routes rather than one rule set.
- **Legal basis:** § 18g AufenthG, with the annual minimums under § 18g Abs. 7.

#### Routes (ADR-0024)

A pathway can have more than one way in. **The pathway is met when any route is**, and the verdict
names the route it used. Route ids are opaque, stable strings scoped to the pathway — the citation
lives in `domain_detail.legalBasis` where it can be reworded freely.

| Route | Provision | Who it admits |
|---|---|---|
| `abs1-s1` | § 18g Abs. 1 S. 1 | a Fachkraft mit akademischer Ausbildung, at the general salary minimum, **without** Bundesagentur consent |
| `abs1-s2` | § 18g Abs. 1 S. 2 | the same qualification at a **reduced** salary minimum, opened by either of two gates |
| `abs2` | § 18g Abs. 2 | ICT and IT professionals with experience and **no degree at all** |

**Gates are ANY; conditions are ALL.** A gate (`kind: right`) answers *may this person attempt this
route*; a condition answers *do they satisfy it*. `abs1-s2` has two gates and the statute reads
*"Nr. 1 **oder** Nr. 2"* — a listed occupation **or** a degree earned within three years. Requiring
both would deny every recent graduate outside the listed groups; letting neither decide would hand
the reduced threshold to every occupation. Both errors were made and corrected during
implementation, and both are recorded in ADR-0024 rule 6.

`abs2` is the sharpest case in the whole model: it opens *"Einem Ausländer, der die Voraussetzungen
nach Absatz 1 nicht erfüllt"* — its precondition is **another provision not applying**. A
conjunctive requirement list cannot express that, which is why routes had to exist before Abs. 2
could be modelled at all.

#### Constituent rules

| Requirement id | Route | Basis | Shape |
|---|---|---|---|
| `de.eu-blue-card.employment-duration` | — pathway-wide | Abs. 3 | minimum months, `numeric-gte` |
| `de.eu-blue-card.qualification` | `abs1-s1` | Abs. 1 S. 1, widened by S. 5 | `boolean` |
| `de.eu-blue-card.qualification.abs1-s2` | `abs1-s2` | Abs. 1 S. 2, incorporating S. 1 | the same condition, second row |
| `de.eu-blue-card.reduced-threshold-occupations` | `abs1-s2` | Abs. 1 S. 2 Nr. 1 | ISCO-08 groups, `set-member`, `kind: right` |
| `de.eu-blue-card.recent-graduate` | `abs1-s2` | Abs. 1 S. 2 Nr. 2 | years since the degree, `numeric-lte`, `kind: right` |
| `de.eu-blue-card.experience-route-occupations` | `abs2` | Abs. 2 | a **narrower** ISCO-08 list, `set-member`, `kind: right` |
| `de.eu-blue-card.professional-experience` | `abs2` | Abs. 2 Nr. 3 a) | years of experience within a window, `numeric-gte` |
| `de.eu-blue-card.salary-threshold.general` | `abs1-s1` | Abs. 1 S. 1 | `monetary`, `numeric-gte` |
| `de.eu-blue-card.salary-threshold.reduced` | `abs1-s2` | Abs. 1 S. 2 | `monetary`, `numeric-gte` |
| `de.eu-blue-card.salary-threshold.reduced.abs2` | `abs2` | Abs. 2 | the same announced figure, second row |

**A rule needed by two routes but not a third has no single-route home**, so it is stated once per
route with distinct ids. The qualification and the reduced salary figure are both in that position.
Written pathway-wide, the qualification would demand a degree of exactly the population Abs. 2
exists to admit without one — a false negative about somebody's relocation.

**A requirement with no route is pathway-wide** and is evaluated as part of every route. Abs. 3's
minimum employment duration is the only one.

#### Occupation lists

Both lists are **in the statute**, not in a separate regulation, which is why they are extractable
at all. They are ISCO-08 group codes.

**Abs. 2's list is narrower than Abs. 1 S. 2's**, and the difference is the point of the provision.
The statute repeats the ISCO boilerplate, so a parser anchored on the wrong sentence silently opens
the no-degree route to groups the statute never put on it. `de-aufenthg`'s parsers are anchored per
sentence and the fixture asserts the exact lists.

#### Stages, dependent rights, permanent residency, citizenship

**`unknown` — not sourced, and this is a real gap rather than a formality.**
`docs/database/entities/requirement.md` says these "are what make it a pathway rather than a visa
type in isolation — they are what people actually plan around". The seeded pathway row leaves them
empty on purpose. Until they are sourced this pathway supports **eligibility evaluation and nothing
that resembles planning advice**.

#### Quota

None known for this pathway. Not asserted as "no quota" — no source has been read that says so.

#### Known ambiguities and deliberate omissions

| Not modelled | Why |
|---|---|
| § 19f rejection grounds | The substance is in another provision, not on the § 18g page. |
| Bundesagentur für Arbeit consent | Abs. 1 S. 1 grants the card *ohne Zustimmung*; the S. 2 and Abs. 2 routes need it. Recorded as `domainDetail.requiresLabourMarketConsent` rather than as a rule: **nobody can answer it in advance**, so a rule would leave those routes permanently `undetermined`. |
| Dependent, residence and job-change provisions | Not eligibility. |

No rule for this pathway is currently marked `contested`.

## Qualification recognition

**Sourced 2026-08-20 for IT and software occupations. Still `unknown` for regulated professions.**

**For IT and software work there is no professional-recognition requirement, because the occupation
is not regulated.** BIBB, which operates the federal recognition portal, states that *"recognition is
not required for working in non-regulated professions"*, and the portal's profession finder returns
an IT occupation as *"nicht reglementiert"*. **This is an answer, not a gap** — *"recognition does not
apply to you"* is a better response to a software engineer than `unknown`, and it costs no rule to
give.

**Do not turn § 18g's degree condition into a recognition rule.** It is immigration eligibility.
§ 18 Abs. 3 Nr. 2 AufenthG defines the term § 18g relies on, and its three limbs are disjunctive:

> *"…einen **deutschen**, einen **anerkannten ausländischen** oder einen einem deutschen
> Hochschulabschluss **vergleichbaren ausländischen** Hochschulabschluss besitzt (Fachkraft mit
> akademischer Ausbildung)."*

**Which body, and prerequisite or parallel.** Comparability is assessed by the **Zentralstelle für
ausländisches Bildungswesen (ZAB)**, issuing a *Statement of Comparability* for the Länder under the
Lisbon Recognition Convention. ZAB: *"When applying for a visa or an EU Blue Card, you have to show
that your university degree is comparable to a German qualification. You can use a Statement of
Comparability to do so."* It is a **prerequisite for the residence title and not for the work** — the
same page states it *"does not … entitle its holder to … work in a regulated profession."*

**Origin does not scope this rule.** The statute's split is `deutsch` versus `ausländisch`, a
domestic/foreign binary — Germany does not publish per-origin-country variants. **The variation is in
the answer, not in the rule**: one rule applies to everyone, and what differs is the outcome of
assessing a particular institution and degree. Two Philippine applicants can be answered differently
by it. Under ADR-0029 the correct representation is therefore **an absent scope key**, which already
means "applies regardless of counterpart".

**What must not be written from this section.** `anabin`'s **H+ / H+- / H-** institution ratings and
the ZAB fee are described only by relocation firms, blogs and forums in everything read so far. They
are **not sourced** and repetition is not evidence. `anabin.kmk.org` redirects cross-host and was not
followed. `make-it-in-germany.com` stays off-limits — Radware bot protection, ruled out in M2.

**The narrow real exception: "Ingenieur" is a protected title, regulated per Land.** The federal
portal returns it as *reglementiert* in Berlin, Baden-Württemberg and Bayern, and a foreign engineer
applies for *"a licence to hold or use the German professional title of 'Engineer'"*. **It gates the
title, not the activity** — software work is done under other titles.

**Sourced and modelled for Bavaria on 2026-08-21, and the inference is gone.** A Landesingenieurgesetz
has now been read: BayIngG, promulgated 12 July 2016 (GVBl. S. 156), on the Free State's own
BAYERN.RECHT portal.

| Provision | What it states |
|---|---|
| **Art. 2 Abs. 1 Nr. 1** | the title may be used by someone holding a German degree in a technical-scientific field, with a *"Regelstudienzeit von mindestens sechs Semestern in Vollzeit"* and at least 180 ECTS points, in which mathematics, computer science, natural sciences and technology predominate |
| **Art. 2 Abs. 1 Nr. 2** | or by someone who, *"nach Ausbildung im Ausland die Genehmigung hierzu erhalten hat"* |
| **Art. 3 Abs. 1** | that permission is granted where the foreign qualification is recognised as equivalent under BayIngG and the **BayBQFG** |
| **Art. 3 Abs. 4** | evidence from outside the EU/EEA must confirm *"ein den Anforderungen gemäß Art. 2 Abs. 1 Nr. 1 entsprechendes Studium"* — which is what makes Art. 2's numbers the test a Philippine degree is measured against |

Modelled by `connectors/immigration-data/de-bayingg` as three `recognition` rows —
`jurisdiction: DE`, `subdivision: BY`, `profession: ingenieur-protected-title`, no pathway — scoped
to `applies_to.origin_jurisdiction: ["PH"]` under ADR-0029. The permission itself is
`document-present`, which the evaluator answers `undetermined`, because only the authority knows.

**Bavaria is one Land of sixteen.** Nothing here generalises to Berlin or Baden-Württemberg: their
Ingenieurgesetze have not been read, and assuming Bavaria's terms would be exactly the invented
coverage this file exists to avoid.

**Still `unknown`, and deliberately:** nursing, teaching, and the licensed engineering *activities*
(the title is modelled above; the activities reserved to Kammer members are not). Until a profession's rules are ingested a **licence-gated profession returns
`unknown` with recognition named** rather than a visa-only verdict that reads as an answer.

What the model already accounts for: § 18g Abs. 1 S. 5 widens what *counts* as the qualification —
an equivalent tertiary programme of at least three years at ISCED 2011 or EQF level 6. That widening
lives in the qualification question's wording and its `domainDetail`, **not** as a separate rule,
because it changes what the question means rather than adding a hurdle.

**The open modelling question is closed.** `user.md` placed qualification recognition in the unbuilt,
separately-encrypted `user_immigration_facts`, while a `credential`-domain requirement would read it
as an ordinary `person_facts` input. ADR-0029 split it along the line the table already drew: where a
qualification was **awarded** is circumstance and is an ordinary `person_facts` kind
(`qualification_awarded_in`, flagged sensitive); whether a licence has been **granted** is status and
belongs in `user_immigration_facts`. `entities/person-fact.md` records it.

## Labor market

**`unknown` across the board — nothing sourced.** Named here so the gap is visible rather than
looking like an oversight:

- demand by career or skill · hiring difficulty · sponsorship prevalence · typical hiring timeline ·
  preferred certifications.

This matters more than it looks: **viability is eligibility *and* employability** (ADR-0022), and
the employability half for Germany currently comes from a person's own readiness against a career
track, not from German market data. A verdict that says "you qualify" is saying something about the
rules and nothing about whether anyone is hiring.

## Compensation

**Where salary data comes from:** for eligibility, the BMI Bekanntmachung — and that is a
**statutory minimum, not a market rate**. Nothing in this repository sources what German employers
actually pay.

**Do not read the Blue Card threshold as a salary expectation.** It is the floor at which a permit
is possible. Treating it as a market figure would mislead someone about the offer they should be
negotiating.

Transparency rules and bonus/equity norms: `unknown` — unsourced.

Figures live in `knowledge-engine`. Do not write bands here.

## Cost and living

**`unknown` — unsourced.** Cost of living by city, housing reality, taxation (brackets, social
contributions, the Philippines–Germany treaty position), and healthcare access for new arrivals are
all unmodelled. Each needs a named authority and a date before it is written anywhere.

## Culture and process

**`unknown` — unsourced.** Interview norms, résumé conventions (Germany's differ sharply from
Philippine and US conventions and getting them wrong costs interviews), notice-period norms and
working-hours norms are all unwritten. **This is exactly the section where a plausible-sounding
guess would be most harmful and least detectable**, so it stays empty until sourced.

## Gotchas

Traps that have already cost time in this repository, each verified here:

**The Bundesanzeiger PDF's font map does not round-trip.** Umlauts and `§` are lost, and **spaces
appear inside numbers**: a five-figure amount extracts with a space before its decimal comma, and
a percentage with a space after its first digit. A naive `/(\d+(?:,\d+)?) Euro/` against the real
document therefore captures only the **tail** of each amount — a three-digit "threshold" where a
five-digit one was published. **It fails to a plausible wrong answer**, which is the worst possible
shape for a number somebody plans a relocation around: no exception, no empty result, just a figure
low enough that almost anyone would appear to qualify.

`de-bundesanzeiger`'s parser rejoins split digit runs, `validate` rejects any amount below a
plausibility floor, and a test asserts the naive parse really does produce the truncated value — so
nobody "simplifies" the healing away. **The figures themselves are in the ingested rows, not here**
(the actual values are in `tests/fixtures/connectors/de-bundesanzeiger/` and the `requirements`
table, both dated).

**Never anchor a pattern on a non-ASCII character in these documents.**

**`gesetze-im-internet.de` serves ISO-8859-1 with entity-encoded umlauts** (`&#228;`). A pattern
anchored on `ä` never fires, and the connector reports *no rules* rather than failing — silent, and
the reason `validate` names the encoding in its error message.

**A summarising fetch is not good enough for a tier-1 legal value.** WebFetch paraphrases both
sources and could not read the compressed PDF at all. Extract with `pypdf` (ADR-0016) and read the
text. A paraphrase that happens to match is not a method.

**The statute page has no machine-readable date for the provision's own entry into force**, only a
site-wide "Stand" line. `effectiveFrom` is therefore **hardcoded to the amendment date and must be
updated by hand** when § 18g changes; `refresh_after` is what makes that visible.

**These rows are born closed.** The Bekanntmachung is explicitly for one calendar year, so
`effective_to` is 31 December and nothing is ever `effective_to IS NULL`. Consequence:
`uq_req__current` is partial on that column and **enforces nothing for annually bounded rules** —
what keeps one rule applicable per date is that year ranges do not overlap, and no constraint checks
that. **Any query filtering `effective_to IS NULL` to mean "current" is wrong for this source.**

## Related

- `.claude/context/countries.md` — the full country model
- `.claude/skills/immigration/SKILL.md` — the rules that govern this data
- `docs/architecture/immigration.md`, `docs/database/entities/requirement.md`
- `docs/architecture/decisions/0024-alternative-routes.md` — why this pathway has routes
- `connectors/immigration-data/de-aufenthg/README.md`, `../de-bundesanzeiger/README.md`
