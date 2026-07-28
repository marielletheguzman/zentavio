# Product Principles

> **Purpose:** The eight properties every Zentavio feature must have. These are acceptance
> criteria, not aspirations — a feature missing one of them is unfinished, however well it
> works.

## 1. Explainability

Every score, match, ranking, and recommendation carries the evidence that produced it, stored
beside it and reachable in the UI. A number with no provenance is a bug.

**Check:** can a user reach *why*? Can we reproduce the number from the recorded inputs and
versions?

## 2. Scalability

Growth is data, not code. The tenth country, the fiftieth source, and the hundredth career
track must be additive.

**Check:** what code changes when we add a country? If the answer is anything but "a
reference file and a registry entry," the design is wrong.

## 3. Modularity

One concern per package, one source per connector, one job per service. Boundaries are the
directory tree; if a file feels homeless, a concept is missing.

**Check:** can this be deleted without touching four other layers? Can it be tested without
booting the platform?

## 4. Accessibility

WCAG 2.1 AA is the floor. Keyboard paths, semantic markup, contrast in both themes, announced
async results, never meaning by color alone.

**Check:** keyboard-only pass, dark-mode pass, 320px pass — before review, not after.

## 5. Transparency

Say what is known, what is unknown, and how confident we are. Unknown is a designed state and
a shippable answer. Distinguish facts (retrieved, cited) from judgments (ours, labeled, with
confidence).

**Check:** does the feature have an honest failure mode, or does it degrade into confident
guessing?

## 6. Privacy

Resumes, immigration status, and salary history are among the most sensitive data a person
holds. Collect the minimum, state the retention at table creation, never log it, never train
on it without explicit consent, and support erasure.

**Check:** what PII does this touch, where does it land, when is it deleted, and is any of it
in a log line? See `docs/architecture/privacy.md`.

## 7. AI-first

The reasoning layer is the product, not a feature bolted onto a listing site. But AI-first
means *knowledge-grounded* — see `ai-principles.md`. An LLM is a reasoning engine, never a
source of facts.

**Check:** which knowledge-engine facts back this? What happens when they are missing?

## 8. Documentation-first

The doc describes the behavior before the code implements it, and the doc ships with the
change. Code that contradicts its doc is broken.

**Check:** was `docs/` updated in this change? Would the next session get this right from the
docs alone?

## Applying them

These are ordered by how expensive they are to retrofit, not by importance. Explainability and
scalability are structural — they must be designed in. Accessibility and documentation are
recoverable but never get done "later." Privacy retrofitted is a breach already shipped.

When two principles pull against each other, the resolution is written down as an ADR, not
decided silently in a pull request.

## Related

- `vision.md` — the design test these support
- `ai-principles.md` — the reasoning-layer constitution
- `feature-philosophy.md` — whether a feature should exist at all
- `CLAUDE.md` — the five non-negotiable engineering principles
