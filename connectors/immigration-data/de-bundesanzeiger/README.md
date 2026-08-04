# de-bundesanzeiger

> **Purpose:** The BMI Bekanntmachung to § 18g AufenthG — Germany's annual EU Blue Card minimum
> gross salaries, as published in the Bundesanzeiger.

## The rule is split across two sources, and this owns one half

§ 18g AufenthG fixes the **percentage** of the Beitragsbemessungsgrenze and which category each
percentage applies to. It never states a euro figure. § 18g Absatz 7 obliges the
Bundesministerium des Innern to announce the concrete minimum gross salaries in the Bundesanzeiger
**by 31 December of the preceding year** — that announcement is this source.

Neither half alone is usable. A percentage cannot be compared against a job offer, and a euro
amount with no percentage cannot be re-derived when the Beitragsbemessungsgrenze moves. Combining
them is the knowledge engine's job; a connector reports what its own source says.

## Legal basis

`bundesanzeiger.de/robots.txt` disallows only `/nlp` and `/construction_page.html` for `*`, and bans
AhrefsBot and MJ12bot by name. The publication path this connector reads is permitted. The documents
are amtliche Bekanntmachungen of a federal ministry.

**`make-it-in-germany.com` is deliberately not integrated.** It restates the same figures more
conveniently, and its `robots.txt` says `Allow: /` — but the site answers with a Radware
bot-protection challenge. Working around that is bypassing a protection control, which
`docs/architecture/connectors.md` forbids: *"If a source disallows automated access, the answer is
that we do not integrate it."* A permissive `robots.txt` is not sufficient evidence on its own.

## The extraction defect this connector exists to survive

The Bundesanzeiger publishes as a PDF whose font map does not round-trip. Extracted text arrives
with two defects, and the second one is dangerous:

1. **Umlauts and `§` are lost.** `Mindestgehälter` becomes `Mindestgeh?lter`. So nothing here
   anchors on a non-ASCII character.
2. **Spaces appear inside numbers.** In the real 2026 document, `45,3` extracts as `4 5,3` and
   `45 934,20` as `45 934 ,20`.

Run the obvious pattern against the real fixture and it returns a **€700 salary threshold**:
`/(\d+(?:,\d+)?) Euro/` matches `700` inside `50 700`, and `20` inside `45 934 ,20`. It fails to a
plausible wrong answer rather than to no answer, which is why `healNumericSpacing` runs first and
why `validate` rejects any amount below €10,000 as a probable parse defect. Both are tested against
the real document.

## What it emits

Two `SourcedRequirement` rows per announcement, one per category:

| `requirementId` | Basis | 2026 |
|---|---|---|
| `de.eu-blue-card.salary-threshold.general` | § 18g Abs. 1 S. 1 — 50 % | 50 700 EUR/year gross |
| `de.eu-blue-card.salary-threshold.reduced` | § 18g Abs. 1 S. 2, § 18g Abs. 2 — 45.3 % | 45 934,20 EUR/year gross |

Categories are matched **by percentage, not document order**, so a year in which BMI reorders the
paragraphs cannot silently swap the two thresholds. A percentage matching no known category is
dropped rather than emitted under a guessed id, and `validate` reports it.

`needsInput` is `expected_gross_annual_salary_eur` — the one person fact that converts an
`undetermined` verdict into a definite one.

## Deduplication

`requirementId` + `version`, where `version` is the calendar year the amounts apply to. That mirrors
`uq_req__id_version` in the schema, so re-ingesting the same announcement is idempotent. The year
comes from the document's own *"für das Jahr NNNN"*, **not** from the publication date — the 2026
rates were published in December 2025, so keying off publication would be wrong by one year, every
year.

## Known gap

`sourceDocument` is `null` because object storage is not provisioned. This is a real gap rather than
a formality: the Bundesanzeiger URL carries an opaque token, so it is not a durable citation for a
number people plan a relocation around. `validate` emits a warning for every row until that lands.

## Related

- ADR-0002 (plugin model), ADR-0010 (six domains, one table)
- `docs/architecture/immigration.md`, `docs/architecture/connectors.md`
- `packages/db/migrations/20260729120100-create-requirements.sql`
- Fixture: `tests/fixtures/connectors/de-bundesanzeiger/banz-at-18-12-2025-b3.json`
