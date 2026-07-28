# Knowledge Sources

> **Purpose:** Rank every data source Zentavio can read, so that confidence is computed from
> provenance instead of from how convincing an answer sounds. This ranking is what makes
> `high` / `medium` / `low` mean something.

## The tiers

### Tier 1 — Authoritative ⭐⭐⭐⭐⭐
- Government portals and statistical offices
- Official immigration and visa portals
- Official company career pages and their ATS feeds
- Official salary reports and collective agreements
- Regulator, university, and certification-body publications of record

Facts from tier 1 can be stated plainly, with a citation. **Immigration rules and salary
thresholds may come from nowhere else.**

### Tier 2 — Reliable ⭐⭐⭐⭐
- Major job boards and ATS aggregators
- University research and labor-market publications
- Established industry reports (with a named methodology)

Usable as a primary source for job postings and market signal. For rules and thresholds,
tier 2 is corroboration only — never the basis of a claim.

### Tier 3 — Indicative ⭐⭐⭐
- Professional networks (LinkedIn and similar)
- Developer ecosystems (Stack Overflow, GitHub)
- Named professional blogs and engineering write-ups

Good for demand signal, tooling trends, and "what teams actually use." Never for eligibility,
compensation figures, or requirements.

### Tier 4 — Anecdotal ⭐⭐
- Reddit, forums, community wikis
- Self-reported experiences (including interview reports)

Valuable precisely because it is experiential — interview formats, timelines people actually
saw, how a process felt. Always aggregated, always labeled as reported experience, always
`low` confidence, and never presented as a rule.

### Tier 5 — Generated ⭐
- LLM output not grounded in a retrieved fact
- Inferred or interpolated values

**Not a knowledge source.** Tier 5 may never be persisted as a fact in
`knowledge-engine/`. Model output belongs in the world as a *judgment* — labeled, with its
inputs — or not at all. If a pipeline is about to write a tier-5 value into a fact table,
the pipeline is broken.

## Tier decides confidence

| Inputs | Confidence |
|---|---|
| Tier 1, current, complete | `high` |
| Tier 2, or tier 1 stale beyond its refresh window | `medium` |
| Tier 3 or 4, wide variance, or incomplete | `low` |
| Nothing retrieved | `status: unknown` — not a claim |

**Confidence degrades to the weakest input.** A readiness score built from tier-1 salary
data and one tier-4 requirement is `low`.

## Conflict resolution

When two sources disagree, in order:

1. **Higher tier wins.** Always. A tier-1 threshold beats ten tier-3 posts.
2. **Within a tier, more recent wins** — but keep both versions; rules are historical facts.
3. **Within a tier and date, the more specific wins** (country + occupation beats country).
4. **Still unresolved:** store both, mark the fact `contested`, drop confidence to `low`, and
   surface the disagreement. Never average conflicting sources into an invented middle.

## Per-domain floors

| Domain | Minimum tier to state it |
|---|---|
| Immigration rules, thresholds, timelines | **1** |
| Salary figures and bands | **1**, or **2** with a named methodology |
| Job postings and requirements | 2 (or the posting itself) |
| Company facts (size, location, stack) | 2 |
| Skill demand and tooling trends | 3, aggregated |
| Interview formats and experience | 4, aggregated and labeled as reported |
| Learning resources | 2 (official course/provider pages) |

Below the floor, the fact is not stated. It may still be stored, tagged with its tier, and
used as a signal for what to go verify.

## What every stored fact carries

```text
sourceTier      1..4          — 5 is never stored as fact
sourceUrl       exact URL of the specific page
sourceId        the connector that fetched it
retrievedAt     UTC timestamp
effectiveFrom   when the fact became true (rules, thresholds)
supersedes      previous version id, if any
contested       boolean
```

A fact missing `sourceTier` or `sourceUrl` cannot be used by an AI service. That is
enforced, not encouraged.

## Adding a source

1. Assign the tier and write down why.
2. Check terms of service and rate limits. Record the legal basis in the connector README.
3. Declare which domains it may feed, given the floors above.
4. Set a refresh window — how long a fact from this source stays current before it is stale.
5. Let `reliability` be observed, not declared: validation pass rate plus outcome feedback.
   A tier-2 source that fails validation 30% of the time is treated as worse than its tier.

## Related

- `ai-principles.md` — rules 5, 6, 8, 9, 10 depend on this ranking
- Skills: `connectors`, `knowledge-engine`, `job-aggregation`, `immigration`
- `docs/architecture/connectors.md`, `docs/database/entities/connector-source.md`
