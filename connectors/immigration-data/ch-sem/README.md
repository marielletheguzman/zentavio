# ch-sem

> **Purpose:** Switzerland's third-country work admission — SEM's Weisungen AIG, Kapitel 4.

**The connector that finds almost no numbers, and that is the country.** Germany, Luxembourg and New
Zealand all pivot on a salary figure. Switzerland pivots on judgements a cantonal authority makes,
and has **no national minimum wage** to compare anything against.

## Why the directives and not the law

`fedlex.data.admin.ch` publishes the AIG and VZAE on the **same JOLux ontology and Casemates
platform as Legilux**, so `lu-legilux`'s SPARQL walk works unchanged — right up to
`isExemplifiedBy`, which points into `/filestore/`, which its `robots.txt` **disallows**. Metadata
permitted, document bytes not; ADR-0021 needs the original archived before a rule is accepted, so
that route is closed.

**SEM's Weisungen are the way in and are the operative layer anyway** — they bind the cantonal
authorities who actually decide these permits. The New Zealand lesson, twice over: *the statute is
often the wrong place to look.*

`sem.admin.ch` declares **no `robots.txt` at all** — a `404`, not a challenge. **Absence of a stated
restriction is not permission**, so this connector carries the most conservative rate limit here
(10/min, 5s minimum interval) and treats the 167-page chapter as one fetch per refresh.

## What it emits

| `requirementId` | Basis | Shape |
|---|---|---|
| `ch.third-country-worker.economic-interest` | AIG art. 18; Ziff. 4.3.1 | **`manual`** |
| `ch.third-country-worker.priority` | AIG art. 21; Ziff. 4.3.2 | **`manual`** |
| `ch.third-country-worker.customary-pay` | AIG art. 22; Ziff. 4.3.4 | **`manual`** |
| `ch.third-country-worker.vacancy-reporting` | AIG art. 21a; Ziff. 4.3.3 | `boolean` |
| `ch.third-country-worker.personal-qualification` | AIG art. 23; Ziff. 4.3.5 | `boolean` |

**Three of five are decided by an authority.** The evaluator reports them and refuses to decide, so
a Swiss verdict is largely `undetermined` **with its reasons named** — the true answer for a
third-country national, because a cantonal authority decides. A number for any of them would be a
threshold nobody wrote.

**No routes.** Kapitel 4 creates one way in; § 4.2.2's exemptions are exemptions from the *quota*,
which is not a requirement here at all.

## The quota is not emitted, deliberately

**ADR-0027**: Höchstzahlen are a cap on a canton, not a condition a person satisfies.
`requirements.kind` no longer permits `'quota'`, so a row for one is a database error — and
`validate` rejects it at the connector boundary too, where the mistake would actually be made.

`quotaBasis()` reports the cap **outside `normalize`**, so it cannot be mistaken for a rule. It goes
on `immigration_pathways.quota`, seeded with **`places: null`** and a stated reason: the figures are
in VZAE Anhang 1 und 2, on the host that disallows its documents. **`null` renders as
capped-and-unsourced, never as uncapped.**

## Traps

**PDF extraction breaks words at line ends** — `Zulassungsvo raussetzungen`, `A rbeitslosigkeit` —
and there is no knowing in advance which words break. Phrase matching runs against `compactText`,
with every space removed on both sides.

**Rejoining words by heuristic was tried and was worse.** A rule joining a lower-case letter to a
long following word also joins *"vorhandener persönlicher"*, destroying phrases that were never
broken — and it failed **silently**, by making patterns stop matching intact text. There is a test
for that, because the wrong fix looked right.

**The table of contents repeats every heading**, hundreds of pages before the rule. Every pattern
anchors on **operative wording**, never a heading; a heading match finds dot leaders.

**Dates are `DD.MM.YYYY`** — the third format across four countries (`de` hardcoded, `lu` ELI
`YYYYMMDD`, `nz` `DD/MM/YYYY`). `06.07.2026` is 6 July.

**The document dates itself and the page linking it does not.** The landing page prints a date
beside each link, and for this chapter the two differ — the page's date belongs to a *different* PDF
in the same list. Read `(Stand …)` from the document.

**One date for the whole chapter.** Unlike New Zealand's per-section `Effective` lines, a revision
re-dates every rule at once, so `supersedes` chains a chapter rather than a rule. `version` carries
the edition.

## The fixture, and what is deliberately not in it

`weisungen-aig-kap4.json` holds the extracted text with email addresses replaced by
`[address redacted]`. They are SEM office contacts printed in the published directive — not personal
data — but the fixture privacy guards permit no address outside a reserved test domain, and **that
guard is worth more without exceptions than with one**. No parser anchor involves an address.

**The PDF is not committed.** This connector does not parse PDFs — extraction happens in the fetch
half, before `normalize` — so the bytes only ever flow to archival, and a committed copy would test
nothing while carrying those same addresses. The archival test synthesises bytes, which is all
`archivable` needs: it passes them through untouched.

Both guards caught this independently, which is worth recording: the TypeScript invariant flagged
the JSON, and its **Python mirror flagged the PDF** by extracting its text first — exactly the
division of labour the TypeScript test's own comment describes.

## Related

- `.claude/skills/immigration/references/countries/ch.md` — the country model
- ADR-0027 (quotas), ADR-0021 (archived provenance), ADR-0024 (routes — and why this pathway has none), ADR-0002
- Fixture: `tests/fixtures/connectors/ch-sem/` — the chapter's text and the PDF it came from
