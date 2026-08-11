# nz-inz

> **Purpose:** New Zealand's Accredited Employer Work Visa — Immigration Instructions plus MBIE's minimum wage.

**The first connector that reads instructions rather than a statute.** New Zealand's Immigration Act
2009 *empowers*; the operative eligibility rules are the **Immigration Instructions** certified
under it and published by INZ. A connector pointed at the Act would find no rule to ingest.

That distinction is what makes New Zealand available at all: `legislation.govt.nz` answers every
path — `robots.txt` included — with `x-amzn-waf-action: challenge`, an AWS WAF bot challenge that
may not be worked around. **It does not need to be**, because it does not hold the operative rules.
`data.govt.nz` and `mbie.govt.nz` are behind Imperva and equally out of scope.

## Legal basis

INZ's `robots.txt` disallows `/admin`, `/Security`, `/_search`, `/_visa-search` and
`/_list-collection-search`. **`/opsmanual/` is not among them**, and no challenge is served.

**The Operational Manual's ExtJS shell is a viewer, not the delivery.** Every fragment path returns
the same ~9 KB shell; the content is ordinary documents:

```text
/opsmanual/toc.htm      the site's own index — ~1 550 sections
/opsmanual/<id>.htm     one instruction section, flat HTML
```

`/opsmanual-archive/` is superseded policy and says so about itself. Never read it for a current
rule.

## What it emits

| `requirementId` | Basis | Shape |
|---|---|---|
| `nz.aewv.remuneration` | WA3.15.5 + MBIE | `monetary`, `numeric-gte`, **per hour** |
| `nz.aewv.market-rate` | WA3.15.5 | **`manual`** — no value, decided by an officer |
| `nz.aewv.approved-job-offer` | WA4.10.1 | `boolean` |

**No routes.** As read, the AEWV creates one way in — no alternative threshold, no occupation
derogation — so it is a **routeless pathway**, which ADR-0024 says behaves exactly as pathways did
before routes existed. New Zealand is the case that shows routes stayed additive.

## Two publishers, one rule, no arithmetic

The instruction states the rule; **MBIE** states the figure. That is an ADR-0025 derived requirement
and both instruments are archived and cited — but a simpler one than Luxembourg's: the instruction
is `role: primary`, MBIE's rate is `role: operand`, and **there is no `formula` row because nothing
is multiplied.**

**The figure is hourly.** `WA3.25` assesses remuneration as *guaranteed payment per hour* and MBIE
publishes hourly, so no annualisation happens on either side — one fewer place to be wrong than
either European rule.

**MBIE is a different authority from INZ**, and `derivedFrom` records it. `requirements.authority`
names INZ because INZ imposes the requirement; a reader asking *who set this number?* gets MBIE.

### Why MBIE and not the Order

The legal instrument is the Minimum Wage Order, published where we cannot reach it. **MBIE
administers the Minimum Wage Act and publishes the rate itself** — the responsible authority
stating its own figure, which is the BMI/Bundesanzeiger case rather than the `guichet.public.lu`
case. It passes the test `guichet` failed: **three MBIE pages state one figure**, and the historical
table dates every rate back to 1997.

The honest caveat: the Bundesanzeiger *is* the official gazette and publication there is the legal
act, whereas this is the ministry's website. Recorded in `nz.md` so it can be overruled.

## What this deliberately does not decide

*"Not less than the market rate for that occupation"* (WA3.15.5) is an **immigration officer's
assessment**. It is stored with `evaluation: 'manual'`, which the evaluator reports and refuses to
decide. A number here would be a threshold nobody wrote.

## The rule whose subject is not the applicant

`nz.aewv.approved-job-offer` depends on the **employer** holding accreditation (WA2) and the **job**
holding an approved Job Check (WA3) — neither of which is a fact about the person. It is still an
ordinary `person_facts` question, because the applicant can answer it: they know who is hiring them,
and INZ publishes the accredited-employer list. **The subject differs from the answerer**, and
`domainDetail.aboutTheEmployer` records that.

## Traps

**Dates are `DD/MM/YYYY`.** `09/10/2023` is 9 October, not 10 September. Read month-first it
produces a **valid date eleven months early**, with no error anywhere — the same silent-wrong-value
class as the German font map and the French thousands separator. Tested by asserting the wrong
reading is not produced.

**Every instruction page carries its viewer's JavaScript inline**, above the text. A naive
extraction reads `function printWindow()` before it reaches a word of law, so scripts are stripped
before any pattern runs.

**The minimum-wage page is a whole government website** — ~545 KB of navigation around one table.
The rate is anchored on the table's own row (`Adult $x $y $z`), never on the first dollar figure,
and the **second figure in that row is the 8-hour day**: taking it yields a threshold eight times
too high, which rejects everybody.

**A section's id is not its section code.** `77177.htm` is `WA3.15`. The id fetches and is stable;
the code is what a person cites and an amendment can reword. Both are recorded — the id slugs the
archive, the code appears in `legalBasis`.

**The rules move.** The AEWV pay threshold was pegged to the median wage until `WA3.15 Effective
08/12/2025` and is now the minimum wage. Anything written from a guide or from memory will state
the old rule. Per-section `Effective` dates make this visible; nothing else does.

## Related

- `.claude/skills/immigration/references/countries/nz.md` — the country model
- ADR-0025 (multi-source provenance), ADR-0024 (routes — and why this pathway has none), ADR-0002
- Fixture: `tests/fixtures/connectors/nz-inz/aewv-instructions.json` — three sections and the rates page, as served
