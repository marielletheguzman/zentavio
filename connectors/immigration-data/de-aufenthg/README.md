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

| Requirement | Basis | Shape |
|---|---|---|
| `de.eu-blue-card.employment-duration` | Abs. 3 | ≥ 6 months, `numeric-gte` |
| `de.eu-blue-card.qualification` | Abs. 1 S. 1 | academic qualification, `boolean` |
| `de.eu-blue-card.reduced-threshold-occupations` | Abs. 1 S. 2 | ISCO-08 groups, `set-member`, `kind: right` |

**Not extracted, on purpose:**

- **§ 19f rejection grounds** — the substance is in another provision.
- **§ 18g Abs. 2's experience route** — three years in seven for ISCO 133 and 25 without a degree.
  Recorded in the qualification row's `domainDetail` as `alternativeRouteNotModelled`, so that row
  is never read as *"no degree means no Blue Card"*.
- Dependent rights, residence and the job-change provisions — not eligibility.

A provision this cannot read produces **no row**, never a guessed one.

## The occupation list is a right, not a hurdle

`kind: 'right'`. It *lowers* the salary threshold. An evaluator treating it as something a person
can fail would reject exactly the people the statute is being generous to.

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
