# Country Preferences

> **Purpose:** Multi-country support and change-anytime behavior.

Where a user says which markets they are considering, and where the platform answers whether those
markets make sense. The primary user is deciding *between* countries, so comparison is the feature — not
a settings screen.

**User question:** *where should I go?*

## Change anytime, and what that implies

Preferences are not setup. Someone rules Japan out after seeing the language requirement, adds the
Netherlands because it is English-viable, and reorders twice more. That has consequences:

- **Nothing is cached as a verdict.** Changing a target recomputes viability, matches, and readiness
  against current knowledge (`docs/database/entities/match.md`).
- **A removed country is soft-deleted**, so an earlier answer stays explicable and re-adding is cheap.
- **Ranking is explicit.** `rank` is stored, not inferred from insertion order, because it drives which
  market leads every downstream surface.
- **No re-onboarding.** A preference change is one interaction, never a wizard.

## What a country target is

| Field | Why |
|---|---|
| `country_code` / `target_kind` | `remote` is a first-class target, not a country |
| `rank` | which market leads |
| `willing_to_relocate` | interest without willingness is a different answer |
| `earliest_move_at` | a timeline constraint that changes what is realistic |

**`REMOTE` is modelled differently, not partially.** No jurisdiction, no pathway; its constraints are
employer policy, time zone, contracting, and tax treatment. It never renders as a country with an empty
visa section — often it is the target a user *should* be pursuing.

## Comparison

Side by side, per market, each cell carrying its own confidence and source:

| Dimension | From |
|---|---|
| Eligibility | `immigration-tracking.md` — tier-1 rules only |
| Employability | readiness × market demand for the target track |
| Language reality | required level per sector, and English viability |
| Compensation | salary bands, tier 1 or tier 2 with a named methodology |
| Cost and taxation | cost of living by city where it differs materially |
| Hiring difficulty | and what specifically makes it hard |
| Sponsorship prevalence | do employers there actually sponsor? |

**Every viability verdict names its binding constraint.** Eligible but unemployable and hirable but
ineligible are both "no", and saying which one binds is the actionable part.

## Partial coverage is normal

A country can have complete visa rules and `unknown` salary data. The comparison shows `unknown` as a
designed state rather than a blank cell, and never fills it with a neighbouring country's figure — no
cross-jurisdiction inference, ever.

Unsupported markets say so plainly and record the request, which is the backlog for country coverage.

## States

| State | Shown |
|---|---|
| **Empty** | no targets yet — suggestions from the career graph and current profile, not an empty list |
| **Loading** | skeleton per country card |
| **Partial** | the dimensions available, with the rest marked unknown |
| **Unsupported** | not covered yet, request recorded |
| **Success** | ranked targets with viability and each binding constraint |

## The near-miss

The highest-value output this feature produces: *"two skills from a materially better market"*. Surfaced
where it exists, because it changes plans in a way a ranked list does not.

## Supported markets

`DE` · `CA` · `AU` · `NL` · `SE` · `NO` · `JP` · `SG` · `AE` · `REMOTE`

Adding one is a reference file, connector coverage, ingested facts, and a registry entry — **zero code
changes** (`.claude/context/countries.md`).

## Dependencies

`knowledge-engine/immigration`, `market-intel` · `ai/career-roadmap` ·
`user_country_preferences`

## Related

- `immigration-tracking.md`, `job-matching.md`
- `docs/database/entities/user.md`, `.claude/context/countries.md`
- `.claude/skills/career-intelligence/SKILL.md`
