# Luxembourg (`LU`)

> **Purpose:** Immigration reference model for Luxembourg. Defines which pathways exist, which
> rules constitute them, and which official sources are authoritative. **Values live in
> `knowledge-engine/immigration`, not here.**

_Status: authored 2026-08-11 from the consolidated statute and the two instruments the threshold
depends on. **`lu-legilux` is built and the salary rules are ingested and evaluated** as of the same
day (ADR-0025). Everything below is either read from a source or marked `unknown`._

**This is M3's country** (`docs/roadmap/milestones.md`): adding it is meant to cost no code. Read
`de.md` first if you are new to these files — Germany is the one whose rules are actually ingested,
and the differences between the two are the substance of what M3 is testing.

---

## Official sources (tier 1 only)

| Source | Authoritative for | URL | Refresh window |
|---|---|---|---|
| Legilux — Journal officiel du Grand-Duché de Luxembourg | the immigration statute and its consolidations | `legilux.public.lu` (documents via `data.legilux.public.lu`) | on amendment; the consolidation chain is queryable, so a new consolidation *is* the trigger |
| Règlement grand-ducal du 26 septembre 2008 (consolidated) | the **multiplier** that defines the threshold, and the occupation list that lowers it | ELI `eli/etat/leg/rgd/2008/09/26/n3` | on amendment — last modified by the RGD of 20 June 2024 |
| Règlement ministériel, annual | the **average gross annual salary** the multiplier applies to | ELI `eli/etat/leg/rmin/…` — most recent 23 February 2026 | **annual**, and it lags: the 2026 instrument states the average for 2024 |

### The source situation, which is not Germany's

**The statute page as served is not the document.** `legilux.public.lu` is an Angular application:
every ELI path — including `/fr/html`, `/fr/pdf`, `/fr/xml` — returns the same ~2.5 KB JavaScript
shell. Fetching it with an HTTP client gets you a page with no law in it, and **nothing about that
failure looks like a failure**.

**The documented machine channel is `data.legilux.public.lu`.** It is published as a dataset on the
national open-data portal under **CC-BY**, so this is a sanctioned route rather than a scraped one.

```text
data.legilux.public.lu/sparqlendpoint          ← the machine endpoint
                                                 (/sparql is the browser UI and returns the SPA)
  requires  Accept: application/sparql-results+json
  → jolux:ComplexWork   eli/etat/leg/loi/2008/08/29/n1
  → jolux:isMemberOf     each dated consolidation  (…/consolide/YYYYMMDD)
  → jolux:isRealizedBy   Expression (per language)
  → jolux:isEmbodiedBy   html · xml · pdf · docx
  → 303 redirect → /filestore/… → the document
```

Verified 2026-08-11: the 2024-09-08 consolidation returns ~1.5 MB of **genuine UTF-8** HTML, with
no bot challenge and none of the encoding trap that `gesetze-im-internet.de` has. Redirects must be
followed — the manifestation URL answers `303`, not `200`.

**Two things a connector must not assume.** A multi-line SPARQL query returned `500` from this
endpoint where the identical single-line query returned `200`; and `format=` as a query parameter
was ignored, so content negotiation has to go in the `Accept` header. Neither is documented.

### The salary threshold is three instruments deep

Found 2026-08-11, and it is the structural fact that matters most here. Germany's rule is two
sources; Luxembourg's is **three**, and no single one of them states a threshold:

```text
Loi 29.08.2008, Art. 45 (1) 3.   "une rémunération au moins égale à un montant à fixer
                                  par règlement grand-ducal"        ← delegates, states nothing
        ↓
RGD 26.09.2008 (consolidated)    a multiplier of the average gross annual salary,
                                  and a LOWER multiplier for listed occupations
        ↓
Règlement ministériel, annual    the average gross annual salary itself, from IGSS data
                                  as determined by STATEC
```

**The threshold is therefore a product, not a published figure.** This is the sharpest difference
from Germany, where BMI publishes euro amounts directly and a connector only has to read them.
Luxembourg publishes a multiplier in one instrument and a base in another, and something has to
multiply them.

**Settled by ADR-0025 (Accepted 2026-08-11).** The connector multiplies, and the stored rule cites
**every** instrument it came from through `requirement_sources`, each with its own archived
document. Storing a computed product is defensible only with that provenance — otherwise the number
is arithmetic nobody can audit. The operands and the multiplier are recorded in
`domain_detail.derivedFrom` so the result can be re-derived without re-fetching.

**The base figure lags by design.** The February 2026 ministerial regulation states the average for
**2024**. Which year's average applies to an application made today is a question the statute
answers and this file does not — read it before assuming.

Nothing below tier 1 may produce a rule for this country. See
`.claude/context/knowledge-sources.md`.

## Language

- **Official languages:** Luxembourgish, French, German. **The statute is published in French**, and
  the ELI Expression carries its language explicitly, so a connector selects rather than assumes.
- **Workplace reality by sector:** `unknown` — **not sourced.** Luxembourg is the market where this
  matters most of the four: a trilingual state with a large cross-border workforce is not
  self-evidently English-workable, and guessing either way would mislead somebody about a move.
- **Required level per pathway:** the Blue Card pathway as read imposes **no language requirement**.
  That is a property of Art. 45, not a gap in coverage.
- **English-only career viability:** `unknown` — unsourced.

## Pathways

### `lu.eu-blue-card` — Carte bleue européenne (Luxembourg)

Provisional pathway id, matching `de.eu-blue-card`'s shape. **Not yet seeded.**

- **Who it is for:** third-country nationals in *emploi hautement qualifié*, under
  **Art. 45 to 45-4** of the *Loi du 29 août 2008 sur la libre circulation des personnes et
  l'immigration*.
- **Legal basis:** Art. 45 (1) for the conditions; Art. 45-1 for the permit itself; the remuneration
  threshold through the RGD and the annual ministerial regulation, as above.

#### Constituent rules, as the statute states them

| Condition | Basis | Shape it would take |
|---|---|---|
| A valid contract for highly-qualified employment of **at least six months** | Art. 45 (1) 1. | `numeric-gte`, months |
| **High professional qualifications** for the occupation — or, for a regulated profession, the conditions for practising it | Art. 45 (1) 2. | `boolean`, with a recognition dimension for regulated professions |
| Remuneration at or above the threshold — the **general** multiplier | Art. 45 (1) 3. + RGD 26.09.2008 Art. 1er | `monetary`, `numeric-gte` |
| Remuneration at or above the **lower** threshold, for a listed occupation | RGD 26.09.2008 Art. 1er, derogation | `monetary`, `numeric-gte`, scoped to its route |
| The occupation being in **CITP (ISCO) group 1 or 2**, enumerated in the RGD itself | RGD 26.09.2008 Art. 1er | `set-member`, `kind: right` — a gate, not a hurdle |
| The general entry conditions | Art. 34 (1)–(2), incorporated by Art. 45 (1) | travel document, visa or ETIAS authorisation |
| **Appropriate accommodation**, for the permit to issue | Art. 45-1 (1) | `boolean` |

#### Two routes, and they are a shape the model already has

**Corrected 2026-08-11, the same day this file was written.** The first draft said Luxembourg was
*likely a routeless pathway* on the grounds that Art. 45 names no occupation list. **That was wrong,
and it was wrong for an instructive reason: the statute is not where Luxembourg puts its
occupation list.** The RGD's derogation sets a lower multiplier for professions in **CITP groups 1
and 2**, and enumerates them in its own text.

So `lu.eu-blue-card` has two routes, and they map onto Germany's almost exactly:

| Luxembourg | Germany | Shape |
|---|---|---|
| general multiplier | § 18g Abs. 1 S. 1 | the default route |
| lower multiplier, gated on the enumerated occupation groups | § 18g Abs. 1 S. 2 Nr. 1 | a `kind: right` gate opening a route with its own threshold |

**Nothing here needs a new rule shape.** `applies_to.route` and `kind: right` already express it,
and both arrived with ADR-0024 for Germany. That is a real answer to M3's question — but note what
it means: the model absorbed Luxembourg **because Germany had already forced the general case**. A
country arriving before ADR-0024 would have cost the same ADR.

**Two caveats before this is treated as settled.** The derogation's wording qualifies the list —
the lower threshold is for occupations *"pour lesquelles un besoin particulier de travailleurs
ressortissants de pays tiers est constaté par le Gouvernement"*. Whether that finding is a separate
published act, or is satisfied by the enumeration itself, is **not yet read**. And Germany's Abs. 2
equivalent — a route for people *without* the qualification — has no counterpart found in Art. 45,
which is a genuine difference rather than an unread gap.

#### Permit, and what it leads to

- **Validity:** four years, or the contract's duration plus three months where the contract is
  shorter. Renewable on the same terms while the conditions hold. Where the permit expires during a
  renewal procedure, the holder stays authorised as a highly-qualified worker (Art. 45-1 (2)).
- **Changing employer:** in the **first twelve months**, a change of employer — or any change
  affecting the Art. 45 admission conditions — requires **prior notification to the minister**
  (Art. 45-2 (1)).
- **Intra-EU mobility:** after twelve months' legal residence in the first member state, the holder
  may enter a second member state for highly-qualified employment on the strength of the Blue Card
  (Art. 45-4). **This has no German equivalent in what we model**, and it is a genuine product
  question rather than a rule: it is a *right the pathway confers*, not a condition on entry.
- **Refusal grounds:** Art. 45-3, which includes the salary falling below the threshold fixed by
  règlement grand-ducal. Unlike Germany's § 19f, **these are on the same page** and are therefore
  extractable rather than a documented omission.

#### Stages, dependent rights, permanent residency, citizenship

**`unknown` — not sourced.** *Regroupement familial* appears throughout the statute and is not read
yet; long-term residence and naturalisation are governed elsewhere. As with Germany, until these are
sourced the pathway would support **eligibility evaluation and nothing resembling planning advice**.

#### Quota

None found in Art. 45–45-4. Not asserted as "no quota" — no source has been read that says so.

## Qualification recognition

**Sourced 2026-08-20 from Art. 45 itself. No rule ingested for IT, and none is justified.**

**Art. 45 (1) 2. splits the question in a way Germany's does not**, and the split is now quoted
rather than characterised:

> *"présente des documents attestant qu'il possède les **qualifications professionnelles élevées**
> requises pour l'exercice de la **profession non réglementée** ou qu'il satisfait aux conditions
> requises pour l'exercice de la **profession réglementée** indiquée dans le contrat de travail"*

**The branch is keyed to the profession, not to origin.** Regulated and non-regulated are defined at
(2) h) and i) by reference to the **loi modifiée du 28 octobre 2016** on the recognition of
professional qualifications. **IT takes the non-regulated branch** — inferred from the statute's own
structure, since (2) f) i) below presupposes ICT professionals qualifying on experience alone. The
ministry's authoritative list was **not read**.

**The degree definition defers to the institution's own state.** Art. 45 (2) e) requires a programme
at an institution *"reconnu comme établissement d'enseignement supérieur ou équivalent **par l'État
dans lequel il se situe**"*, of at least three years and at least level 6 of the Luxembourg
qualifications framework. **This is Germany's shape**: one rule for everyone, whose answer depends on
the institution. **The variation is in the answer, not in the rule**, so under ADR-0029 the correct
representation is an **absent scope key**. Nothing here is origin-keyed.

### Two derogation routes, and one of them is Germany's

**Art. 45 (2) f) i)** — *"en ce qui concerne les professions de manager et de spécialiste des
technologies de l'information et de la communication qui ont acquis **au moins trois ans
d'expérience professionnelle pertinente au cours des sept années précédant la demande** …
appartenant aux groupes «**133**» ou «**25**» de la classification **CITP-08**"*.

**This is § 18g Abs. 2 AufenthG** — same groups, same three-in-seven window, both transposing
Directive 2021/1883. Germany's is already modelled as a **route** (ADR-0024, `abs2`), and this is the
precedent that settles how Switzerland's Art. 21 Abs. 3 should be read: **a derogation admitting a
distinguishable population is a route.**

**Art. 45 (2) f) ii)** — *"en ce qui concerne les autres professions : … une expérience
professionnelle d'**au moins cinq ans** d'un niveau comparable à des diplômes de l'enseignement
supérieur"*. **Luxembourg goes further than Germany here**, extending an experience route to every
profession. Germany has no equivalent.

**Neither is ingested.** `lu.eu-blue-card` currently carries the salary rules only, so a person
qualifying under either route is not yet answered — a **coverage gap, not a modelling gap**.

**Still `unknown`:** the regulated branch, which needs the assessing body and the 2016 law's own
provisions. Those may well be origin-keyed for regulated professions under Directive 2005/36/EC —
**not read, and not assumed.** It would not affect IT either way.

This is the same open boundary recorded in `de.md`: `user.md` places recognition in the unbuilt,
separately-encrypted `user_immigration_facts`, while a `credential`-domain requirement would read it
as an ordinary `person_facts` input. **Luxembourg will hit it sooner than Germany**, because the
regulated-profession branch is inside the pathway's own conditions rather than in a separate domain.

## Labor market

**`unknown` across the board — nothing sourced.** Demand, hiring difficulty, sponsorship prevalence,
typical timeline, preferred certifications. `adem.public.lu` (the public employment agency) is the
obvious first source and permits clean paths — its `robots.txt` disallows only query-string URLs —
but nothing has been read from it.

## Compensation

**Nothing sourced, and the statutory minimum is not even known yet** — it is delegated to a
règlement grand-ducal that has not been located. As with Germany, when that figure exists it is a
**floor for a permit, not a market rate**, and must never be rendered as a salary expectation.

Transparency rules and bonus/equity norms: `unknown`.

Figures live in `knowledge-engine`. Do not write bands here.

## Cost and living

**`unknown` — unsourced.** Luxembourg's housing costs and cross-border commuting pattern are
frequently decisive for exactly the people this product serves, which makes an unsourced guess here
more harmful than elsewhere, not less.

## Culture and process

**`unknown` — unsourced.** Interview norms, résumé conventions, notice periods, working hours.

## Gotchas

Each of these was verified against the live source on 2026-08-11.

**The statute page is an application, not a document.** Every ELI path returns the same JavaScript
shell with a `200`. A connector fetching `legilux.public.lu` directly gets a page that parses
cleanly and contains no law — the quietest possible failure. Fetch through
`data.legilux.public.lu` and follow the `303`.

**`/sparql` is the browser UI; `/sparqlendpoint` is the machine one.** The first returns the SPA
shell with a `200` and a `text/html` content type, which a naive client will treat as success.

**Content negotiation is by header, not by parameter.** `format=application/sparql-results+json`
was ignored; `Accept: application/sparql-results+json` worked.

**A multi-line SPARQL query returned `500`** where the same query on one line returned `200`.
Undocumented, and it fails as a Spring "Whitelabel Error Page" rather than as a SPARQL fault.

**The consolidation chain is the versioning model, and it is better than Germany's.** Consolidations
are dated resources (`…/consolide/20240908`) reachable by query, so "the law as it stood on a date"
is answerable from the source rather than reconstructed. Germany's statute page has no such thing —
its `effectiveFrom` is hardcoded to an amendment date and must be updated by hand. **Do not copy
that workaround here.**

## Related

- `.claude/context/countries.md` — the full country model
- `de.md` — the worked example, and the comparison M3 is measured against
- `docs/architecture/decisions/0024-alternative-routes.md` — why Germany needed routes, and why
  Luxembourg may not
- `docs/roadmap/milestones.md` — M3's verification
