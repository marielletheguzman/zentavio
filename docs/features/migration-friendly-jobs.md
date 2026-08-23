# Migration-Friendly Job Filter & Employer Sponsorship Intelligence

> **Purpose:** Filter and rank opportunities by immigration feasibility, and score employers on the
> migration support they actually provide.

A high-paying role with no sponsorship is not actionable for a non-EU applicant. Skill fit alone ranks
jobs the user cannot take, which is the failure this feature exists to prevent.

**User question:** *which of these jobs can I actually take, and will the employer help me get there?*

## The distinction the whole feature rests on

> **Employers sponsor. Governments grant.**

| Use | Never use |
|---|---|
| visa sponsorship · work permit sponsorship | "free citizenship" |
| relocation support · immigration assistance | "guaranteed visa" |
| permanent residency **pathway** | "employer provides citizenship" |
| citizenship **pathway** | "approval likely" |

An employer can sponsor an application. Only the destination government grants a permit, residency, or
citizenship, and only after its own requirements are met. Any phrasing that blurs this is a defect —
banned in prompts (`docs/prompts/matching/README.md`) and an eval case.

## Five separate questions, never merged

The feature's core discipline. Each is answered independently, with its own confidence:

| Question | Decided by | Source |
|---|---|---|
| **Job eligibility** — can I do this work? | skill fit | `skill-gap-analysis.md` |
| **Sponsorship** — will this employer sponsor? | the employer | posting text, registries, outcomes |
| **Visa eligibility** — do I meet the rules? | destination government | tier-1 immigration rules |
| **Professional recognition** — does my licence transfer? | destination authority + origin licence | origin-side rules (see gap below) |
| **PR / citizenship pathway** — what does this lead to? | destination government | tier-1 pathway rules |

Collapsing any two of these into one number is how a user ends up applying for a job they cannot hold.

## Design decision 1 — `unknown` is not `no`

**Most postings never state sponsorship.** At launch, `unknown` will be the dominant value, so the
filter semantics matter more than the filter:

| Value | Means |
|---|---|
| `stated_available` | the posting or employer says so, with the source |
| `stated_unavailable` | explicitly excluded ("no visa sponsorship") |
| `inferred_likely` | from registry membership or aggregated outcomes, labelled as inferred |
| `unknown` | nobody said. **The default, and not evidence of absence.** |

So "Only show jobs with visa sponsorship" is offered as two distinct controls, because they are two
different requests:

- **Hide jobs that state no sponsorship** — safe, small effect.
- **Show only jobs that state sponsorship available** — honest, and will hide most of the market. The UI
  says so at the point of toggling, with the count it would remove.

Treating `unknown` as `no` would silently hide most viable opportunities. Treating it as `yes` would
waste applications. It is shown, labelled, and ranked below stated sponsorship.

## What "the posting says so" actually means (ADR-0039)

`stated_available` above says the value comes from *"the posting or employer says so"*. That is not
self-defining, and getting it wrong is the most expensive error this feature can make — a false
`stated_available` tells somebody a job solves their immigration problem when it does not, and they
apply, plan a timeline, and possibly move. **The evidence contract, as implemented:**

**1. The benefit must be named in qualified form.** `visa sponsorship`, `work permit sponsorship`,
`relocation assistance`, `relocation package`, `immigration assistance` — never the bare noun.
`sponsorship` alone is stakeholder buy-in; `relocation` alone is a topic. Both appear in real postings
in exactly those senses:

> "…partnering with stakeholders across engineering and earning **executive sponsorship**."
> "…often involving complex compensation, negotiation, and **relocation strategies**."

Both are `unknown`, and both are permanent regression cases.

**2. The predicate must be about the benefit, not near it.** A qualified benefit must sit adjacent to
an availability or refusal predicate — `is available`, `is provided`, `we offer`, `we do not sponsor`
— with only a tiny closed set of bridging tokens permitted between them (`is`, `are`, `will`, `be`,
`also`, `may`, `can`, `not`). Conjunctions and intervening nouns break the link, which is what
disqualifies the one genuine span the corpus contains:

> "Company **visa sponsorship and relocation assistance details will be provided** during the
> interview process."

`and` is not a bridge, and `details` is a noun *about* the benefit rather than the benefit. Details
being provided is not the benefit being provided.

**3. A requirement placed on the candidate is not an employer offer.** *"contingent upon obtaining
valid US work authorization"* is an obligation, and obligations never produce `stated_available`.

**4. `inferred_likely` is never produced from prose at all.** It is reserved for sponsor registries
and aggregated outcomes — employer-level sources that have no table and, with `company_id` null on
every stored posting, no join key. A CHECK refuses the value outright until one exists.

### What this costs, measured

Run over 239 real postings from an employer board on 2026-08-23: **239 considered, 239 said nothing,
0 stated** — including the three postings whose text mentions the topic. The filter this feature
describes cannot yet be demonstrated on that corpus.

That is the designed outcome, not a defect. Demonstrating the filter needs a board where employers
state sponsorship plainly — an argument for choosing the next board deliberately, never for loosening
rule 1. Every posting is nonetheless **processed** rather than pending: `unknown` here means *we read
it and it says nothing*, which is a different row from *we have not read it*.

## Design decision 2 — how employer sponsorship is sourced

**Never by profiling the nationality of an employer's staff.** Inferring "has hired Filipinos" from
people's names, photos, or profiles would be discriminatory processing of personal data about
non-users, and we will not do it (`docs/architecture/privacy.md`).

Legitimate sources, in tier order:

| Tier | Source | Gives |
|---|---|---|
| 1 | Official sponsor registers, where a destination publishes one | sponsorship *licence* held — strong, verifiable |
| 2 | The employer's own posting or careers page stating sponsorship | stated availability, with the URL |
| 2 | Official occupation/shortage lists the role appears on | pathway relevance, not employer behaviour |
| 4 | **Our own recorded outcomes** — aggregated, minimum support | observed sponsorship, the best long-term signal |
| — | Third-party "we think they sponsor" listings | not used |

Outcomes are the asset here: once users report being sponsored by an employer, we know something no
scraper can tell us. Aggregated with `n` and a window, never per-person
(`outcomes-learning.md`).

## Migration-Friendly Employer Score

A **derived, per-employer** score. Not a company quality score, not a probability of visa approval —
see `docs/GLOSSARY.md`.

| Factor | Source | If unknown |
|---|---|---|
| Visa/work-permit sponsorship | registry, posting, outcomes | omitted, and lowers confidence |
| Sponsorship history | aggregated outcomes | omitted |
| Relocation support | posting or careers page | omitted |
| Immigration assistance | posting or careers page | omitted |
| Dependent/family support | posting, or destination rule if statutory | omitted |
| Employment stability | company facts | omitted |

**Rules that keep the number honest:**

- **Factors are omitted, never defaulted.** A missing factor is not a zero — a zero is a claim that the
  employer does *not* offer it.
- **The score reports how much of it is known.** `62/100 · 3 of 6 factors known · confidence low` is the
  honest form. A bare `87/100` built from two known factors is a fabrication with a decimal point.
- **Below a minimum number of known factors, no score is produced** — the factors are listed instead.
- **Country-dependent factors are labelled as such.** PR and citizenship pathways are *destination*
  properties and never contribute to an *employer's* score. The spec's example rows marked "country
  dependent" belong in the country comparison, not here.

## Ranking

Migration feasibility joins the ranking rather than replacing career fit:

```text
career fit  ·  immigration feasibility  ·  sponsorship support  ·  settlement pathway
```

- Each contributes a **named, visible factor** with its own weight — never a hidden multiplier
  (`.claude/skills/ai-matching/SKILL.md`).
- A **hard ineligibility** is a named binding constraint, not a score reduction. Silently down-ranking a
  job the user cannot hold is misleading.
- `stated_unavailable` sponsorship for a user requiring it is a binding constraint too.
- The Job Match Score itself stays "fit for this posting". Feasibility is reported alongside it, so a
  strong-fit / no-sponsorship job reads as exactly that rather than as a mediocre match.

## Migration preferences

Stored per user, changeable anytime, and recomputing rather than filtering a cached list
(`country-preferences.md`):

```text
Migration preferences
  ☐ Hide jobs that state no sponsorship
  ☐ Show only jobs with stated sponsorship            (will hide most results — count shown)
  ☐ Prefer employers offering relocation support
  ☐ Prefer employers with observed sponsorship history
  ☐ Prefer destinations with a permanent residency pathway
  ☐ Prefer destinations with a citizenship pathway
  ☐ Include roles that may support dependents
```

The last four are **destination** preferences and route to
`country-preferences.md`; keeping them on this screen would imply an employer controls them.

## Job detail: Immigration & Relocation

```text
Immigration & Relocation

Visa sponsorship        Stated available — employer careers page, retrieved 2026-07-14
Relocation support      Unknown — not stated in this posting
Immigration assistance  Unknown
Dependent support       Depends on the pathway, not the employer — see Germany pathways
Permanent residency     Pathway exists in Germany; conditions and clock apply
Citizenship             Pathway exists in Germany; granted by the government, not the employer
Relocation cost         Unknown — we do not estimate this
```

**On the spec's `$5,000–$8,000` relocation estimate:** not shown unless sourced. An invented cost range
on a decision this size is exactly the class of fabrication `ai-principles.md` rule 1 forbids. When we
have sourced cost data it appears with its source and date; until then, `unknown`.

Every row shows its source and date, or says `unknown`. No row is blank.

## Unknown path

The dominant path at launch, and therefore designed first:

- Sponsorship unknown → shown, labelled, ranked below stated sponsorship. Never asserted either way.
- Employer score unavailable → known factors listed instead of a number.
- Recognition unresolved → `unknown` with recognition named. **Regulated professions cannot currently
  receive an eligibility verdict at all** (`docs/architecture/immigration.md`), and this feature must not
  paper over that with a sponsorship signal — a sponsored job a nurse cannot be licensed for is not an
  opportunity.

## What it never does

- Never claims an employer provides citizenship or residency.
- Never guarantees or predicts immigration approval.
- Never infers sponsorship from silence.
- Never infers an employer's hiring history from individuals' nationalities.
- Never merges employer support with government decisions in one number.
- Never shows a composite score without stating how much of it is known.
- Never estimates a cost or timeline without a source.

## MVP scope

Germany only, four filters:

1. Visa sponsorship status — with the four-value semantics above
2. Relocation assistance — stated or unknown
3. Sponsorship history — from outcomes, once minimum support exists
4. Immigration pathway visibility — the destination pathway shown per job

Out of scope initially: family sponsorship as a filter, PR probability estimation, citizenship timeline
estimation, employer migration analytics. The first two are only honest with outcome data we do not have
(`docs/roadmap/backlog.md`).

## Dependencies

`job_postings` sponsorship fields · `companies` sponsorship facts · `knowledge-engine/immigration` ·
`knowledge-engine/outcomes` · `services/matching` · `docs/prompts/matching/`

## Related

- `job-matching.md`, `country-preferences.md`, `immigration-tracking.md`, `outcomes-learning.md`
- `docs/GLOSSARY.md` — the score definitions and banned phrasings
- `docs/architecture/immigration.md` — the origin-side gap that limits recognition answers
