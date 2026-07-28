# Privacy

> **Purpose:** Anonymization of user outcomes, PII handling, data retention.

Zentavio holds resumes, immigration status, salary history, and rejection records — among the most
sensitive data a person has, and a set that is uniquely damaging in combination. Privacy here is
structural: retrofitted privacy is a breach that already shipped.

## What we hold, and how sensitive it is

| Data | Sensitivity | Why we hold it |
|---|---|---|
| Resume document and parsed profile | **High** | the input to every score |
| Immigration status, nationality, visa history | **Highest** | eligibility cannot be computed without it |
| Salary history and expectations | **High** | threshold eligibility, market comparison |
| Outcomes — applied, rejected, offered | **High** | the learning loop (`principles.md`) |
| Target countries and careers | Medium | recommendations |
| Practice answers and interview reports | Medium | readiness scoring |
| Email, auth identity | Medium | account |

Immigration status is treated as the most sensitive field in the system. It can imply nationality,
legal precarity, and family circumstances, and in some jurisdictions its disclosure carries real
personal risk.

## Principles

**Collect the minimum.** Every field must trace to a computation that needs it. "Useful later" is not
a reason to collect now — it is a reason to add the field when later arrives.

**State retention at table creation.** A table with no retention policy is unfinished, not pending.
Recorded in `docs/database/data-retention.md`.

**Never log it.** No PII in a log line, an error message, an exception, a prompt trace, or a metric
label. `packages/logger` carries a correlation id — the correlation id is not the person, and that is
the point.

**Never in a fixture or a document.** Synthetic profiles only, in `tests/fixtures/` and in every
example in `docs/`. Not even scrubbed real data: scrubbing is reliably incomplete.

**Self-hosted inference.** Models run under Ollama (ADR-0003), so resume content is not sent to a
third party as a side effect of scoring it. This is a privacy property of the architecture, not only
a cost choice.

**The user sees what we believe about them.** A profile is inspectable and correctable, and
corrections outweigh inferences.

## PII handling by layer

| Layer | Rule |
|---|---|
| `apps/*` | never store PII in local/session storage; no PII in a URL or query string (URLs leak via history, referrers, and logs) |
| `services/api-gateway` | authorizes every request against the subject; a correlation id in logs, never the subject |
| `services/*` | PII only where the use case needs it; never in an event payload — events carry ids |
| `ai/*` | receives the minimum the task needs; stateless, so nothing is retained (ADR-0003) |
| `knowledge-engine/*` | holds facts about the *world*; person-scoped rows are ids plus references |
| `connectors/*` | never send user data to an external source |
| `packages/db` | encryption at rest; column-level encryption for the highest-sensitivity fields |

**Prompts.** Carry only the fields the task requires. Chain-of-thought is never persisted or
displayed as evidence — evidence is computed factors (`.claude/context/ai-principles.md`). A resume is
delimited as untrusted data, and never echoed into a field downstream code treats as trusted.

## Anonymizing outcomes

Outcomes are the most valuable data in the system and among the most re-identifiable: "rejected by
company X for role Y in month Z" is close to unique. So the aggregate is the product and the row is
never the product.

- **Ingest-time anonymization** for interview reports: identifying details stripped before storage,
  never surfaced afterward.
- **Minimum support before surfacing.** A pattern is shown only above a threshold count, always with
  `n` and a time window — "12 of 15 reports (last 18 months)", never "someone reported".
- **Aggregate only, in both directions.** An individual's outcome never appears in another user's
  view, and market intelligence derived from outcomes is aggregated with no path back.
- **Separate the person from the pattern.** Outcome rows reference a profile id; aggregation reads the
  pattern and does not carry the id forward.
- **No k-anonymity, no publication.** Where a cohort is too small to aggregate safely, the answer is
  "not enough data yet" — which is a valid, shippable answer here.

## Retention

Windows live in `docs/database/data-retention.md`. The shape:

| Category | Retention |
|---|---|
| Resume document (original upload) | shortest viable — parse, then discard the file; keep the parsed profile |
| Parsed profile | while the account is active |
| Outcomes | while the account is active; anonymized aggregates survive deletion |
| Practice answers | bounded window, then aggregate signal only |
| Auth and audit records | as required for security, then purged |
| Knowledge-engine world facts | indefinite — these are not personal data |

Soft deletes for anything a user removes; hard deletes for erasure requests and expired ephemera.

## Deletion and export

- **Erasure** removes person-scoped rows and derived embeddings. The vector store holds only derived,
  rebuildable vectors (ADR-0004), which is what keeps erasure bounded — deleting a person's vectors
  costs recompute, not knowledge.
- **Aggregates already published stay**, having no path back to the individual. That boundary is
  stated to the user rather than implied.
- **Export** returns the profile, its evidence, and its outcomes in a portable form. A person is
  entitled to the reasoning we hold about them, not only the inputs.
- Both paths are built and tested, not assumed. An untested erasure path is a promise, not a feature.

## Consent

- Explicit and purpose-scoped. Uploading a resume for a gap analysis is not consent to train on it.
- No training on user data without separate, revocable, explicit consent.
- Consent state is a fact with a timestamp and a version, not a boolean that overwrites its history.

## Constraints

- No PII in a log, error, metric label, or trace.
- No PII in a fixture, example, doc, or commit message.
- No PII in an event payload — events carry ids.
- No PII in a URL or query string.
- No table without a retention policy.
- No single outcome surfaced as a pattern.
- No training on user data without explicit consent.
- No third-party model API receiving resume content.
- No untested erasure path.

## Related

- `security.md` — authentication, secrets, isolation, threat model
- `principles.md` — privacy by default, and what it costs
- `docs/database/data-retention.md`, `docs/features/outcomes-learning.md`
- `.claude/context/ai-principles.md`, `.claude/context/product-principles.md`
- ADR-0003 (self-hosted inference), ADR-0004 (embeddings are derived)
