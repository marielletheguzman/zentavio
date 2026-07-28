# Connector Guide

> **Purpose:** Step-by-step: build and register a new connector.

Adding a source is one folder plus one registry line (ADR-0002). If your diff touches anything else, stop
— the design is being violated, not extended.

`connectors/core` does not exist yet, so steps 3 onward describe the intended shape. Steps 1–2 apply
today.

## Step 1 — Check you are allowed to

**Before writing anything:**

- Read the source's terms of service. If automated access is disallowed, **the answer is that we do not
  integrate it.** Not "we scrape carefully".
- Check `robots.txt`.
- Find the stated rate limit, or infer a conservative one.
- Record the **legal basis** — it goes in the connector's README and in
  `connector_sources.legal_basis`.

No bypassing rate limits. No scraping behind a login wall. This is not negotiable and it is not a
performance tradeoff.

## Step 2 — Capture real payloads first

```bash
mkdir -p tests/fixtures/connectors/<id>
# save three real responses: a normal record, one missing fields, one malformed
```

Write `normalize` against real data, not against the API documentation. Documentation lies; payloads do
not. Scrub credentials and any personal data before committing — fixtures are permanent.

## Step 3 — Scaffold

```bash
cp .claude/templates/connector.template.md connectors/<kind>/<id>/README.md
```

`<kind>` is one of `job-boards` · `salary-data` · `company-data` · `immigration-data` ·
`learning-resources` · `market-trends`. `<id>` is kebab-case, **permanent, and never reused** — it is a
foreign key, a config namespace, and a fixture path.

## Step 4 — Implement in this order

**`normalize` first**, because it is pure and testable and it forces you to understand the data:

```typescript
normalize(raw: GreenhouseJob): JobPosting {
  return {
    externalId:  raw.id.toString(),
    sourceId:    this.meta.id,
    title:       raw.title.trim(),
    companyName: raw.company?.name ?? null,   // resolution happens downstream
    salaryMin:   raw.salary_min ?? null,      // absent stays absent
    sponsorshipStatus: detectSponsorship(raw.content),  // stated | unknown, never inferred to no
    raw,                                       // kept for provenance
  };
}
```

Three rules, each with a test:

| Rule | Test |
|---|---|
| **Pure** — no clock, no network, no randomness | called twice with the same fixture, identical output, clock and network stubbed to throw |
| **Total** — every payload maps to a record or a validation error | never throws |
| **Honest** — absent fields are `null` | the expected fixture has `null`, not a default |

Company and location resolution happen later in the knowledge engine, because `normalize` has no I/O and
therefore no registry access.

Then `validate` (accept / flag / reject **with reasons**), then `search` (cursor-paginated), then
`fetch`, then `healthCheck` (cheap, no credentials burned).

## Step 5 — Dedup key

Derive it, document it in the README, and keep it stable:

```text
sha256(norm(company) + '|' + norm(title) + '|' + norm(location) + '|' + coarse(postedAt))
```

`norm()` is casefold, strip punctuation, collapse whitespace. Alias mapping happens during
reconciliation, not here.

## Step 6 — Use the shared helpers

Rate limiting, retry with jitter, circuit breaking, and cursor persistence come from `connectors/core`.
**Hand-rolled retry logic inside a connector is a defect** — it means one source retries differently
from the rest, and nobody finds out until a source is being hammered.

Retry only `429`, `502`, `503`, `504`, and network errors. Never `400`, `401`, `403`, `422` — those are
bugs or auth problems, and retrying hides them.

## Step 7 — Register

One line in the `connectors/core` registry. Config keys under `connectors.<id>.*` in
`packages/config`; credentials from the secret store, never in the repository.

## Step 8 — Prove it was additive

```bash
git diff --name-only
```

Expected, and nothing else:

```text
connectors/<kind>/<id>/...
connectors/core/registry.ts
packages/config/...
tests/fixtures/connectors/<id>/...
```

**Any file under `services/` in that diff means ADR-0002 was violated.** The lint rule catches the import
case; this check catches the rest.

```bash
pnpm lint:all
```

## Step 9 — Sponsorship fields, for job boards

Job-board connectors extract sponsorship signal where the posting states it
(`docs/features/migration-friendly-jobs.md`):

- Stated available or stated unavailable → record it **with the verbatim sentence**.
- Nothing said → `unknown`. **Never infer absence from silence.**
- Never infer sponsorship from company size, industry, or location.

## Checklist

- [ ] Terms of service checked; legal basis recorded
- [ ] Real payloads captured as fixtures, scrubbed
- [ ] `normalize` pure, total, honest — with the purity test
- [ ] `validate` returns reasons
- [ ] Cursor resumable after a crash
- [ ] Shared retry, rate limit, breaker — nothing hand-rolled
- [ ] Dedup key documented
- [ ] Golden-file tests exact, absent fields `null`
- [ ] Registered; config namespaced
- [ ] Diff touches only the four paths above
- [ ] README states what this source is authoritative for, and its tier

## Related

- `docs/architecture/connectors.md` — the contract and its reasoning
- `.claude/skills/connectors/SKILL.md`, `.claude/skills/job-aggregation/SKILL.md`
- `docs/database/entities/connector-source.md`, `entities/job.md`
- ADR-0002, `.claude/templates/connector.template.md`
