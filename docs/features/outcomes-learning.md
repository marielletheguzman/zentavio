# Outcomes Learning

> **Purpose:** Anonymized outcome capture and how it feeds the knowledge engine.

The feature that turns Zentavio from a system that describes the market into one that anticipates it. Also
the one holding the most re-identifiable data in the product, so capture and use are deliberately
asymmetric: **the aggregate is the product, the row never is.**

**User question served indirectly:** *will this actually work?*

## What is captured

| Kind | Source |
|---|---|
| applied, screened, interviewed, offered, rejected, withdrawn | user-reported or platform-observed |
| accepted, started, relocated | user-reported |
| course completed, assessment passed | platform-observed |
| no response after N days | inferred, and labelled as inferred |

Alongside the event: the target, the market, whether it was a relocation or a career change, the skill
snapshot at the time (**ids only**), and — critically — **what we predicted**.

## Why the prediction is stored

```text
predicted_score · predicted_kind · scorer_version · knowledge_as_of
```

The loop only closes if we recorded what we *said* before we learned what happened. Without these,
outcomes describe the market but cannot calibrate our own scoring — which is the entire point. It also
means a score is falsifiable, which is a property very few career products have.

## What outcomes feed

| Consumer | Effect |
|---|---|
| `career_edges.transition_path` | observed transition frequency, so a proposed route can prefer one people actually took over one that is merely adjacent |
| Time-to-competence | learning estimates move from assumed (resource durations) to observed |
| Source reliability | a source whose postings turn out dead loses reliability regardless of its tier |
| Score calibration | whether 0.72 meant what it claimed |
| Interview process models | stage structure and format, aggregated |

## Capture is easy or it does not happen

Outcome data cannot be bought or backfilled, so the interaction is designed for the moment it is
plausible:

- One tap from a tracked application: *interviewed · rejected · offered*.
- Asked after a state change we can already infer, not on a schedule.
- Never a required form, never blocking anything.
- A rejection is recorded without commentary — asking someone to explain a rejection is a good way to
  never be told about one again.

**No free-text field anywhere.** A notes column here would become the most sensitive and least
controllable data in the system.

## Anonymization

- **Ingest-time stripping** for interview reports; identifying details never stored.
- **`occurred_month`, not `occurred_at`, for aggregation.** An exact timestamp plus a company plus a role
  is close to unique; a month is not.
- **Minimum support before anything is surfaced** — below it, "not enough data yet", which is both a
  privacy control and an honesty one. A pattern from two reports identifies its contributors *and*
  misleads its reader.
- **Always `n` and a window.** "37 of 120 (last 18 months)", never "users like you often…".
- **Never surfaced individually**, in either direction.

## Erasure: detached, not deleted

```text
erasure → user_id = NULL, application_id = NULL, anonymized_at = now()
        → the pattern row remains and keeps contributing
```

Stated to the user at erasure rather than implied. The alternative — deleting outcomes — means the
learning loop silently degrades every time someone leaves, and the data cannot be recovered.

## What the user gets back

The loop is not extractive. Contributors see:

- Their own trajectory over time — readiness in January versus now.
- Honest transition data: *"of 40 recorded moves from support engineering to cloud engineering, median
  time to first offer was 14 months"* — the kind of number nobody else will tell them.
- Better estimates, because their outcome improved the estimate they are reading.

## Prediction, eventually

With enough recorded outcomes, "what should I do next?" gets an answer with a track record. Until then,
estimates are labelled as assumptions rather than dressed up as predictions
(`docs/roadmap/vision.md`).

Outcomes are captured from the start, **before anything reads them.** Deliberate ordering: the data cannot
be created retroactively, and it is the long-term moat.

## States

| State | Shown |
|---|---|
| **Empty** | no outcomes yet — what recording one unlocks |
| **Thin** | their own timeline, with aggregate comparisons withheld until minimum support |
| **Success** | trajectory plus aggregate context, each figure with `n` and window |

## Dependencies

`knowledge-engine/outcomes` · `applications`, `practice_sessions` · consumers across
`ai/*`

## Related

- `docs/architecture/knowledge-engine.md` — the feedback loop
- `docs/database/entities/outcome.md`, `docs/architecture/privacy.md`
- `docs/architecture/principles.md` — the learning loop tenet
