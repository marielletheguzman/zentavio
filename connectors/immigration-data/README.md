# immigration-data

> **Purpose:** Government immigration information source plugins (visa rules, requirements).

**What is built:** six sources across four countries. This is the only connector domain with real
coverage, and the one the rest were modelled on.

| Source | Covers | State |
|---|---|---|
| [`de-bundesanzeiger/`](de-bundesanzeiger/README.md) | the BMI Bekanntmachung to § 18g AufenthG — Germany's annual EU Blue Card minimum gross salaries | **built** |
| [`de-aufenthg/`](de-aufenthg/README.md) | § 18g itself — the qualification condition, the ISCO-08 groups attracting the reduced threshold, Abs. 2's experience route, and the minimum employment duration | **built** |
| [`de-bayingg/`](de-bayingg/README.md) | BayIngG Art. 2 and Art. 3 — the protected title `Ingenieur` in Bavaria, and what a non-EU/EEA qualification must show | **built** |
| [`lu-legilux/`](lu-legilux/README.md) | Luxembourg's EU Blue Card threshold, computed from the two instruments that define it (ADR-0025) | **built** |
| [`nz-inz/`](nz-inz/README.md) | New Zealand's Accredited Employer Work Visa — INZ's Immigration Instructions plus MBIE's minimum wage | **built** |
| [`ch-sem/`](ch-sem/README.md) | Switzerland's third-country work admission — SEM's Weisungen AIG, Kapitel 4 | **built** |

## Germany's Blue Card rule needs both halves, and each source owns one

§ 18g AufenthG fixes the **percentage** of the Beitragsbemessungsgrenze and which category each
applies to; it never states a euro figure. § 18g Abs. 7 obliges the Bundesministerium des Innern to
announce the concrete amounts in the Bundesanzeiger by 31 December of the preceding year.

`de-aufenthg` owns the first half; `de-bundesanzeiger` owns the second. Neither alone is usable — a
percentage cannot be compared against a job offer, and a euro amount with no percentage cannot be
re-derived when the Beitragsbemessungsgrenze moves. Combining them is the knowledge engine's job; a
connector reports what its own source says.

**Coverage is still partial and says so.** § 19f's rejection grounds and the Bundesagentur's consent
stay unmodelled on purpose, because their substance is not on the pages these connectors read. Each
connector's README names what it leaves out, rather than letting the omission look like coverage.

## Three lessons these six paid for

**The statute is often the wrong place to look.** New Zealand's Immigration Act *empowers*; the
operative eligibility rules are the Immigration Instructions certified under it. Switzerland's AIG
and VZAE are law, but SEM's Weisungen bind the cantonal authorities who actually decide. A connector
pointed at either statute would find no rule to ingest.

**Bot protection closes routes and may not be worked around.** `legislation.govt.nz` answers every
path with an AWS WAF challenge; `fedlex.data.admin.ch` permits metadata but `robots.txt`-disallows
the `/filestore/` bytes ADR-0021 needs archived. Both are recorded rather than routed around — and
in both cases the operative layer was reachable elsewhere.

**A derived number needs more than one citation.** Luxembourg publishes no Blue Card threshold; it
is a règlement grand-ducal's multiple times a règlement ministériel's average. ADR-0025 placed that
arithmetic in the connector and paired it with `requirement_sources`, so every contributing
instrument is archived and cited. A number derived from two sources that names one is not evidence —
it is a figure that looks audited. That mechanism is **general**, not Luxembourg's: a second
country-specific provenance path would be a regression.

## Tier 1 only

Government portals, official immigration authorities, official gazettes. Not a law firm's blog, not
a relocation agency, not a forum, not the model's memory. `ck_req__tier_one` will not hold anything
else — the schema refuses it rather than trusting review.

## Sources ruled out

**`make-it-in-germany.com`** restates the same figures more conveniently and its `robots.txt` says
`Allow: /` — but the site answers with a **Radware bot-protection challenge**. Working around that
is bypassing a protection control, which `docs/architecture/connectors.md` forbids outright. Recorded
here because the next person will find that portal first.

**`data.govt.nz` and `mbie.govt.nz`** sit behind Imperva, and are equally out of scope for the same
reason.

## Related

- ADR-0002 (plugin model), ADR-0010 (origin-side requirements and professional recognition),
  ADR-0021 (archived provenance), ADR-0024 (alternative routes), ADR-0025 (derived thresholds),
  ADR-0029 (origin-scoped requirements)
- `docs/architecture/immigration.md` — the rules-as-data model these sources feed
- `.claude/skills/immigration/references/countries/` — the country models they support
