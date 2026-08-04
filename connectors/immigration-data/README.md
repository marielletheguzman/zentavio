# immigration-data

> **Purpose:** Government immigration information source plugins (visa rules, requirements).

**What is built:** `de-bundesanzeiger`, the first real source in the repository. Everything else
here is still a placeholder.

| Source | Covers | State |
|---|---|---|
| [`de-bundesanzeiger/`](de-bundesanzeiger/README.md) | the BMI Bekanntmachung to § 18g AufenthG — Germany's annual EU Blue Card minimum gross salaries | **built** |
| `de-aufenthg` | § 18g itself — the qualifying percentages, ISCO-08 groups, and minimum employment duration | not built |

## Germany's Blue Card rule needs both, and only one exists

§ 18g AufenthG fixes the **percentage** of the Beitragsbemessungsgrenze and which category each
applies to; it never states a euro figure. § 18g Abs. 7 obliges the Bundesministerium des Innern to
announce the concrete amounts in the Bundesanzeiger by 31 December of the preceding year.

`de-bundesanzeiger` owns the second half. The first half — the statute — is **not ingested**, so
eligibility today checks the salary thresholds and nothing else in § 18g. Combining the two is the
knowledge engine's job; a connector reports what its own source says.

## Tier 1 only

Government portals, official immigration authorities, official gazettes. Not a law firm's blog, not
a relocation agency, not a forum, not the model's memory. `ck_req__tier_one` will not hold anything
else — the schema refuses it rather than trusting review.

## Sources ruled out

**`make-it-in-germany.com`** restates the same figures more conveniently and its `robots.txt` says
`Allow: /` — but the site answers with a **Radware bot-protection challenge**. Working around that
is bypassing a protection control, which `docs/architecture/connectors.md` forbids outright. Recorded
here because the next person will find that portal first.

## Related

- ADR-0002 (plugin model), ADR-0010 (six domains, one table), ADR-0021 (archived provenance)
- `docs/architecture/immigration.md` — the rules-as-data model these sources feed
