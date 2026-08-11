# Luxembourg (`LU`)

> **Purpose:** Immigration reference model for Luxembourg. Defines which pathways exist, which
> rules constitute them, and which official sources are authoritative. **Values live in
> `knowledge-engine/immigration`, not here.**

_Status: authored 2026-08-11 from the consolidated statute. **No connector exists and no rule is
ingested** — this file is the model that a connector will be written against, which is the order
`README.md` prescribes. Everything below is either read from the statute text or marked `unknown`._

**This is M3's country** (`docs/roadmap/milestones.md`): adding it is meant to cost no code. Read
`de.md` first if you are new to these files — Germany is the one whose rules are actually ingested,
and the differences between the two are the substance of what M3 is testing.

---

## Official sources (tier 1 only)

| Source | Authoritative for | URL | Refresh window |
|---|---|---|---|
| Legilux — Journal officiel du Grand-Duché de Luxembourg | the immigration statute and its consolidations | `legilux.public.lu` (documents via `data.legilux.public.lu`) | on amendment; the consolidation chain is queryable, so a new consolidation *is* the trigger |
| Règlement grand-ducal fixing the Blue Card remuneration threshold | **the salary amount** | **not yet located** — see below | `unknown` until located |

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

**The salary figure is delegated and has not been found yet.** Art. 45 (1) 3. sets the condition as
*"une rémunération au moins égale à un montant à fixer par règlement grand-ducal"* — the statute
names **no percentage and no amount**, unlike § 18g which at least fixes the percentages. Until that
instrument is located and read, Luxembourg has a pathway whose salary rule cannot be written.

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
  threshold by règlement grand-ducal.

#### Constituent rules, as the statute states them

| Condition | Basis | Shape it would take |
|---|---|---|
| A valid contract for highly-qualified employment of **at least six months** | Art. 45 (1) 1. | `numeric-gte`, months |
| **High professional qualifications** for the occupation — or, for a regulated profession, the conditions for practising it | Art. 45 (1) 2. | `boolean`, with a recognition dimension for regulated professions |
| Remuneration **at least equal to an amount fixed by règlement grand-ducal** | Art. 45 (1) 3. | `monetary`, `numeric-gte` — **the amount is in another instrument** |
| The general entry conditions | Art. 34 (1)–(2), incorporated by Art. 45 (1) | travel document, visa or ETIAS authorisation |
| **Appropriate accommodation**, for the permit to issue | Art. 45-1 (1) | `boolean` |

**The likely modelling difference from Germany, and it is the interesting one.** § 18g creates three
populations and needed ADR-0024 before the third could be expressed. Art. 45 as read creates **one**:
there is no ISCO-08 occupation list, no reduced threshold, and no experience route in the statute.
If the règlement grand-ducal turns out to set a single amount, **`lu.eu-blue-card` is a routeless
pathway** — which ADR-0024 says behaves exactly as pathways did before routes existed, asserted by
test. That would make Luxembourg the additive case the ADR promised, and it is the single most
useful thing to confirm before writing a connector.

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

**`unknown` — no rule ingested.** Art. 45 (1) 2. splits the question in a way Germany's does not:
for a **non-regulated** profession it asks for high professional qualifications; for a **regulated**
one it asks whether the conditions for practising *that profession* are met. That is a recognition
rule in the statute's own text, and modelling it needs the body that assesses it — which is not on
this page.

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
