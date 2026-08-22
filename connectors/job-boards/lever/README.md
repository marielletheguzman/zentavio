# lever

> **Purpose:** Lever ATS source plugin — published postings from employer boards somebody configured.

## Why it exists

The first connector under `job-boards/`, and the first job data this product has had at all. Every
job-shaped feature so far — matching, applications, outcomes — has been built against a person's own
records rather than against openings.

## Legal basis, quoted rather than inferred

Lever's Postings API documentation states that *"all job postings in the `published` state are
publicly viewable. These jobs may be scraped by third parties. All other jobs are completely hidden
from the jobs API."* That is an explicit permission from the source, which is a stronger footing than
"the endpoint answered" — the basis most connectors have to settle for.

It also settles scope **structurally**: the API cannot return an unpublished posting, so "published
only" is enforced by the source rather than by us remembering.

`api.lever.co/robots.txt` is `Allow: /` with `Crawl-delay: 1`, read 2026-08-22. The documented `429`
applies to application *POST* requests, not to reads, so nothing states a GET rate limit. The crawl
delay is what this connector honours (`minIntervalMs: 1000`, 60 requests a minute) and it is a
**courtesy floor rather than a published ceiling** — a job board changes daily at most.

## Tier 2, not tier 1

The employer wrote the posting, but Lever hosts and renders it. This is the platform's rendering of
the employer's words, not the employer's own page, and `sourceTier: 2` says so
(`.claude/context/knowledge-sources.md`).

## Configured boards, not discovery

A board is read because somebody put it in the configuration. **Nothing here discovers boards**,
guesses organisation slugs, or enumerates Lever's customers — `fetch` returns `null` for a board
nobody configured, whatever the caller asks.

That keeps coverage curated and honest about what it is: this is not a global search index, and
Lever does not offer one. The API exposes one company's published postings at a time.

## What it refuses to infer

**Salary.** Lever publishes no structured pay, so every row carries `salaryIsStated: false` and null
amounts. A number parsed out of a description would be a guess with a currency attached, and every
score derived from it would inherit the guess. Validation rejects a row claiming otherwise
(`salary-invented`) — the guard against the failure this connector is most likely to grow.

**Remote scope.** `workplaceType` says whether a role is remote; nothing says whether that means
worldwide, a country, or a region. The scope stays `null` rather than becoming a plausible guess,
because "remote (worldwide)" is the most consequential thing to be wrong about for somebody choosing
where to live. Validation rejects an invented one (`remote-scope-invented`).

**A country from the location text.** `country` is an ISO-3166-1 alpha-2 field the source states
properly. Parsing `"Arlington, TX"` into one would be inventing a fact the source already answers,
and would be wrong exactly where it matters. The free-text location is carried verbatim for display
and **never mined**.

## What it drops

A posting missing an id, a title, or **both** its hosted URL and its apply URL produces no row. A job
we cannot link to is a job somebody cannot apply for, and listing it would waste the one thing this
feature is supposed to save them. One broken posting does not take the rest of the board with it.

## Health

**An empty board is healthy.** A company with nothing open is a real state, and treating it as a
fault would make every quiet employer look like a broken integration. A board that is no longer
served is `degraded`; so is having no boards configured at all.

## Where its postings go

`job_postings` and `job_posting_sources` exist as of ADR-0034, and this connector's records reach them
through `packages/db/src/repositories/jobs.ts`. What the connector supplies is **source identity** —
`(lever, <board slug>, <posting id>)` — and never a deduplication key: a Lever board publishes no
employer, and a key derived from a board slug would be an employer identity we invented.

A posting from here therefore stores `dedup_basis = 'source-identity'`, which matches nothing by
construction. That is the honest state, and it is recorded rather than hidden: when a source does
supply an employer, the same posting would carry `employer-title-location` instead.

Still not mapped here, by decision rather than omission: `commitment` stays Lever's own vocabulary in
`commitment_raw`, and `department` / `team` are stored raw. `company_id` and `company_name_raw` stay
null, because a board slug is a namespace and resolving it to a company would be the invention this
connector exists to refuse.

## Related

- `docs/database/entities/job.md` — the shape `normalize` targets
- `.claude/context/knowledge-sources.md` — source tiers and what tier 2 means for confidence
- `.claude/skills/connectors/SKILL.md` — the contract this implements
- ADR-0033 — the tier, and what a posting may state
- ADR-0002 — the registry as the only module that names a connector
- ADR-0021 — why the board as served is archived
