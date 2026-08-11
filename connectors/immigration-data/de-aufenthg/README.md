# de-aufenthg

> **Purpose:** § 18g AufenthG — the statutory half of Germany's EU Blue Card rule.

`de-bundesanzeiger` reports the euro amounts BMI announces each year. This reports what the statute
itself fixes: who qualifies, which occupations attract the reduced threshold, and how long the job
must last.

## Why it exists

Until it did, eligibility checked the salary thresholds **and nothing else**, while the surface said
*"every rule we checked"*. Someone with a qualifying offer and no recognised degree was told
**"You qualify."** That is a false positive about a person's relocation.

## Legal basis

`gesetze-im-internet.de/robots.txt` is `Disallow:` — empty, permitting everything. Operated by the
Bundesamt für Justiz. German statutes are amtliche Werke, uncopyrighted under § 5 UrhG.

## What it extracts, and what it refuses to

Statute is not an announcement. § 18g has nested conditions and cross-references to § 18, § 18b and
§ 19f whose meaning is not on this page. Modelling all of it mechanically would produce rules that
look authoritative and are subtly wrong — the worst outcome available for immigration data.

**Extracted** — literal and self-contained:

| Requirement | Basis | Shape | Route |
|---|---|---|---|
| `de.eu-blue-card.employment-duration` | Abs. 3 | ≥ 6 months, `numeric-gte` | — pathway-wide |
| `de.eu-blue-card.qualification` | Abs. 1 S. 1 | academic qualification, `boolean` | `abs1-s1` |
| `de.eu-blue-card.qualification.abs1-s2` | Abs. 1 S. 2, incorporating S. 1 | the same condition, second row | `abs1-s2` |
| `de.eu-blue-card.reduced-threshold-occupations` | Abs. 1 S. 2 Nr. 1 | ISCO-08 groups, `set-member`, `kind: right` | `abs1-s2` |
| `de.eu-blue-card.recent-graduate` | Abs. 1 S. 2 Nr. 2 | ≤ 3 years since the degree, `numeric-lte`, `kind: right` | `abs1-s2` |
| `de.eu-blue-card.experience-route-occupations` | Abs. 2 | ISCO-08 groups **133 and 25 only**, `set-member`, `kind: right` | `abs2` |
| `de.eu-blue-card.professional-experience` | Abs. 2 Nr. 3 a) | ≥ 3 years, acquired within 7, `numeric-gte` | `abs2` |

**The duration is stored as `{ amount: 6, unit: 'months' }`, not `{ months: 6 }`.** The evaluator
compares `value.amount`; written the other way the rule parsed, stored, and then evaluated
`undetermined` forever — on file and impossible to satisfy, which is the quietest failure available.

**The qualification is stated once per route that requires it, and never pathway-wide.** Abs. 1 S. 2
incorporates the condition by reference — *"Fachkräften mit akademischer Ausbildung"* — so it
governs both Abs. 1 routes; Abs. 2 is precisely the route that does **not** require it. A row
carries one route, so a condition governing two is two rows with distinct ids. It was pathway-wide
while Abs. 2 was unmodelled, which was correct then and became a false positive the moment `abs2`
landed: it would have demanded a degree of exactly the population Abs. 2 exists to admit without
one. `normalize.test.ts` asserts the set of routes asking for a degree, and
`ai/career-roadmap/tests/test_routes.py` asserts the same scope from the evaluator's side.

**`abs1-s2` has two gates and either one opens it.** Nr. 1 is the occupation list, Nr. 2 is a degree
earned within three years, and the statute reads *"Nr. 1 oder Nr. 2"* — ADR-0024 rule 6, gates are
ANY. Requiring both would deny every recent graduate outside the listed groups.

**Abs. 2's ISCO list is anchored on Abs. 2's own sentence.** The statute repeats the ISCO-08
boilerplate, and reading Abs. 1's wording here would open the no-degree route to ten groups where
the provision names two. Asserted directly: the parsed list is exactly `['133', '25']`.

**Not extracted, on purpose:**

- **§ 19f rejection grounds** — the substance is in another provision.
- Dependent rights, residence and the job-change provisions — not eligibility.
- **The Bundesagentur für Arbeit's consent** (Abs. 1 S. 1 grants the Blue Card *ohne Zustimmung*;
  the S. 2 and Abs. 2 routes need it). Recorded as `domainDetail.requiresLabourMarketConsent`
  rather than made a rule: nobody can answer it in advance, so a rule would leave those routes
  permanently `undetermined`.

A provision this cannot read produces **no row**, never a guessed one.

## The occupation lists are rights, not hurdles

`kind: 'right'`. They *open* a route — Abs. 1 S. 2's list lowers the salary threshold, Abs. 2's
admits someone with no degree at all. An evaluator treating either as something a person can fail
would reject exactly the people the statute is being generous to. What a right does do is gate its
own route: `not_met` on every gate of a route makes that route `not_applicable`, never a blocker on
the pathway, because another route may carry it.

## Two traps

**The page is ISO-8859-1 and entity-encodes umlauts** (`&#228;`). A pattern anchored on `ä` never
fires against the raw bytes, and the connector reports no rules rather than failing — silent, and
the reason `validate` names the encoding in its error.

**The occupation list is anchored on its sentence, not on digits.** The page is full of numbers that
are section references and dates; matching bare digits produces an occupation list containing `2009`
and `292`. Tested.

## Known limitation: `effectiveFrom` is hardcoded

The page carries no machine-readable date for the provision's own entry into force — only a
site-wide "Stand" line for the whole statute. Using the fetch date would claim the rule began the
day we read it, which is false and corrupts any as-of query. `2023-11-18` is the amendment that
introduced the current § 18g, and **it must be updated by hand when the provision changes.**
`refresh_after` is what makes that visible.

## Related

- `../de-bundesanzeiger/README.md` — the other half of the same rule
- ADR-0002 (plugin model), ADR-0010 (six domains, one table), ADR-0021 (archived provenance)
- Fixture: `tests/fixtures/connectors/de-aufenthg/aufenthg-18g.json`
