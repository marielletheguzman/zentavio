# Vision

> **Canonical document:** [`docs/roadmap/vision.md`](../../docs/roadmap/vision.md).
> Read it for the full vision. This file is the in-session summary — it must not restate
> content that would drift.

## North star

The most intelligent career platform in the world — the system a professional consults when
the question is **"what should I do next?"**

Not a job board. A job board matches strings and leaves the judgment to the user. Zentavio
reasons about a career: where this person can realistically work, what they would have to
become, how long it takes, and whether it is worth it.

## Who, and where

**Users:** professionals and students from the Philippines, and skilled workers planning
international careers.
**Launch destinations:** Germany · Luxembourg · New Zealand · Switzerland.
**Future:** Netherlands · Ireland · Australia · Canada · Nordics. **Remote** is first-class.

The origin is a design constraint, not a segment. Filipino applicants face **origin-side**
requirements — overseas employment regulation, licence recognition, credential evaluation,
document authentication — as binding as destination visa rules, and often *more* binding:
a country can be visa-accessible while a professional licence is not transferable.
Destination-only reasoning answers half the question.

## The design test

Apply to every table, endpoint, prompt, screen, and ADR:

1. **Does this move us toward the vision?** Does it help answer "what should I do next?"
2. **Can it explain itself?** Would a user see *why*, with evidence?
3. **Does it read facts rather than invent them?** Which knowledge-engine facts back it?
4. **Would it survive the tenth country and the fiftieth source?**
5. **Is the documentation part of the change?**

A "yes" to 1 with a "no" to any of 2–5 is debt every later feature inherits.

## Horizon

- **Near** — one career track, one country, end to end, fully explainable.
- **Middle** — breadth: more tracks, countries, sources; graphs dense enough that
  transitions are discovered rather than declared. Outcomes begin feeding back.
- **Long** — prediction: which transitions actually succeed, from where, in which markets,
  and how long they really take.

## What we will not become

A job aggregator with an AI summary bolted on · a source of confident uncited answers about
visas or salaries · a course marketplace · a resume keyword optimizer.

## Related

- `business.md` — who this serves and what they pay for
- `feature-philosophy.md` — the question each capability answers
- `ai-principles.md` — the rules the reasoning layer obeys
- `docs/GLOSSARY.md` — the terminology this vision uses
