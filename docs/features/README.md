# Features

> **Purpose:** Feature catalog and status legend.

Every feature answers a user question. A feature that answers none is not a Zentavio feature
(`.claude/context/feature-philosophy.md`).

## Catalog

| Feature | The user asks | Status |
|---|---|---|
| [resume-parsing](resume-parsing.md) | What does the platform think I can do? | specified |
| [skill-gap-analysis](skill-gap-analysis.md) | What am I missing, and what matters most? | specified |
| [learning-paths](learning-paths.md) | What should I learn, in what order, how long? | specified |
| [job-matching](job-matching.md) | Which of these jobs is worth my time? | specified |
| [country-preferences](country-preferences.md) | Where should I go? | specified |
| [immigration-tracking](immigration-tracking.md) | Am I eligible to work there? | specified |
| [interview-prep](interview-prep.md) | What will they ask, and am I ready? | specified |
| [job-aggregation](job-aggregation.md) | Are these openings real and current? | specified |
| [notifications](notifications.md) | What changed that I need to know? | specified |
| [outcomes-learning](outcomes-learning.md) | Will this actually work? | specified |

## Status legend

| Status | Means |
|---|---|
| **specified** | this document describes intended behaviour; no implementation exists |
| **partial** | some of it is built; the document says which parts |
| **built** | implemented, tested, and matching this document |
| **deferred** | intentionally not being built yet, with the reason recorded |

Everything is **specified**. There is no application code yet — the documentation, the ADRs, and the
boundary enforcement come first so every feature inherits them (`../README.md`).

## The chain

Features are not independent. They compose into one answer, and the order matters:

```text
resume → profile
       → skill gap          (against a target)
       → learning path      (ordered, resourced, timed)
       → readiness          (honest number + remainder)
       → viability          (eligibility × employability)
       → job matching       (only what is realistically reachable)
       → interview prep     (for what was actually applied to)
       → outcomes recorded  → improves every step above
```

Matching sits *after* readiness and viability deliberately. Ranking jobs a person cannot get, or is not
ready for, is what a job board does.

## What every feature owes

Regardless of which question it answers:

- **Evidence.** Every score, match, and recommendation carries what produced it, reachable in the UI.
- **An honest unknown state.** Missing knowledge produces "we don't know, and here's what's missing" —
  never a default, never a plausible value.
- **Confidence, visibly.** Low confidence looks different, not the same badge in a paler tint.
- **The four states.** Loading, empty, error, success — designed before the success state is styled.
- **A retention decision.** For any person data it touches.
- **Additive breadth.** New countries, tracks, and sources are data, not code changes.

These are acceptance criteria, not aspirations (`.claude/context/product-principles.md`).

## Anti-features

Recognizable by the question they answer being nobody's: a job feed, a résumé keyword optimizer, a course
catalogue, a chatbot with no retrieval, a vanity score, a country list. Each is the shallow version of a
real feature above; the difference is always reasoning over sourced knowledge with the evidence shown.

## Related

- `.claude/context/feature-philosophy.md` — the tests a feature must pass
- `docs/roadmap/phases.md` — the order these get built
- `docs/architecture/overview.md`, `docs/GLOSSARY.md`
