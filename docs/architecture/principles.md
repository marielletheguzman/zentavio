# Design Principles

> **Purpose:** Design tenets: plugin-first, learning loop, privacy-by-default, multi-country.

Four tenets, each with the architectural consequence it forces. These are not values statements —
each one costs something specific, and the cost is stated so nobody trades it away by accident.

---

## 1. Plugin-first

**Tenet.** Coverage grows by adding a plugin, never by editing the pipeline that consumes it.

Coverage growth is the permanent condition of this product: more job boards, more salary sources,
more immigration portals, more countries. If adding source twenty requires editing shared code,
then the cost of the next source rises with the coverage already present — exactly backwards.

**Consequences.**

- Every external source implements one contract — `search` / `fetch` / `normalize` / `validate` /
  `healthCheck` — and registers in `connectors/core` (ADR-0002).
- `services/ingestion` iterates the registry and never references a source by name. Enforced in
  `eslint.config.mjs`, not by review.
- `normalize` is a **pure function**: no clock, no network, no database. Which pushes entity
  resolution (company aliases, location canonicalization) downstream into the knowledge engine,
  where the alias registry lives.
- Failures isolate per source: rate limiting, retry with jitter, and circuit breaking live in shared
  `core` helpers. One dead source degrades one source's freshness, not the run.
- A cross-source feature cannot be a shared code path. It becomes a knowledge-engine reconciliation
  step.

**What it costs.** Five methods is ceremony for a source with one endpoint. The contract must be
designed before the sources are well understood, and a bad contract makes every connector work
*around* it. That is a signal to change the contract, not to cast.

**The test.** Adding a source produces a diff touching only `connectors/<kind>/<id>/`, the registry,
config, and tests. Anything else in the diff is a violation.

---

## 2. The learning loop

**Tenet.** The system records what actually happened and gets better because of it. Outcomes are
first-class data, not analytics.

Zentavio's long-term claim is prediction — which transitions actually succeed, from which starting
points, in which markets, and how long they really take. That is only reachable if outcomes are
captured from the beginning, including before anything reads them.

**Consequences.**

- `knowledge-engine/outcomes` exists before any feature needs it. Applied, interviewed, offered,
  rejected, relocated, course completed — all recorded.
- Career-graph `transition_path` edges carry **observed frequency**, so a proposed transition can
  prefer a route people actually took over one that is merely adjacent.
- Source `reliability` is observed, never declared: validation pass rate plus outcome feedback. A
  tier-2 source failing validation 30% of the time is treated as worse than its tier.
- Scores are versioned (`scorerVersion`, `promptVersion`, `knowledgeAsOf`) so a past prediction can
  be compared against its outcome. An unversioned score cannot be calibrated, only replaced.
- Time estimates state their basis and move from assumed to observed as outcomes accumulate.

**What it costs.** Storage and instrumentation for data with no immediate reader, and the discipline
to keep recording it when nothing depends on it yet.

**The test.** For any feature: what outcome does it produce, and is that outcome recorded?

---

## 3. Privacy by default

**Tenet.** Collect the minimum, state retention at table creation, never log it, and support
erasure. Resumes, immigration status, and salary history are among the most sensitive data a person
holds.

**Consequences.**

- Retention is designed when a table is created, not after the first request
  (`docs/database/data-retention.md`). A table with no retention policy is unfinished.
- No PII in a log line, ever — including inside an error, a prompt trace, or an exception message.
  `packages/logger` carries a correlation id; the correlation id is not the person.
- No PII in a fixture, example, or document. Synthetic profiles only, even scrubbed.
- Prompts carry the minimum the task needs. Chain-of-thought is never persisted or shown as
  evidence — evidence is computed factors.
- Soft deletes for anything a user can remove; hard deletes reserved for erasure requests and
  expired ephemera.
- The vector store holds only derived, rebuildable embeddings, so an erasure request has a bounded
  blast radius.
- Self-hosted inference (Ollama) rather than a third-party API by default, so resume content does
  not leave our infrastructure as a side effect of scoring it.

**What it costs.** Debugging is harder without user data in logs. Some analytics are unavailable by
construction. Erasure paths must be built and tested rather than assumed.

**The test.** For any change: what PII does it touch, where does that land, when is it deleted, and
is any of it in a log line?

---

## 4. Multi-country by construction

**Tenet.** A country is data. Adding one is a reference file, connector coverage, ingested rules,
and a registry entry — never a code change.

The product's primary user is deciding *between* countries. A design where the first country is
special makes the tenth expensive and the comparison impossible.

**Consequences.**

- No country-specific branch in service or AI code. If code must change to add a country, the design
  is wrong (`.claude/context/countries.md`).
- Immigration rules are individually modeled, **versioned, dated, and tier-1 sourced**. A change is
  a new version superseding the old, never an update in place — someone planned against the old one.
- Nothing generalizes across jurisdictions. Sweden is not inferred from Norway; an EU-level rule does
  not settle a member state's implementation without that state's own source.
- Partial coverage is honest and shippable: labor-market data may be `unknown` for a country whose
  visa rules are complete. Invented coverage is not.
- Language is part of viability, not a footnote. Visa-eligible and linguistically unemployable is
  not an opportunity.
- `REMOTE` is a first-class target with a different shape — no jurisdiction, constraints are employer
  policy, time zone, contracting, and tax treatment.

**What it costs.** Per-country reference files and connector coverage to maintain, refresh windows to
honour, and the discipline to ship "we don't know yet" for a market rather than a plausible number.

**The test.** What code changes when a country is added? If the answer is anything but "none", stop.

---

## How these interact

The tenets are not independent, and where they meet is where the design gets decided:

- **Plugin-first × multi-country** — a new country is usually a new immigration-data connector, so
  the plugin contract has to fit sources it was not designed against.
- **Learning loop × privacy** — outcomes are the most valuable data in the system and among the most
  sensitive. Aggregated, retained deliberately, never surfaced identifiably.
- **Learning loop × multi-country** — outcome volume per country is small at first, so confidence
  must degrade honestly rather than a thin sample being presented as a pattern.
- **Privacy × the learning loop's appetite for data** — the resolution is always "collect less, label
  it clearly, and delete on schedule". Not "collect now, decide later".

When two tenets genuinely conflict, the resolution is written as an ADR
(`docs/architecture/decisions/`), not decided quietly in a pull request.

## Related

- `overview.md` — the component map these tenets shape
- `.claude/context/product-principles.md` — the eight per-feature acceptance properties
- `.claude/context/ai-principles.md` — the ten rules governing AI-produced claims
- `privacy.md`, `security.md`, `immigration.md`, `connectors.md`
- ADR-0002 (plugin model), ADR-0003 (model replaceability), ADR-0005 (enforcement)
