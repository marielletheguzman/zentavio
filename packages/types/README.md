# types

> **Purpose:** Shared domain types: job, user, skill, country, match, outcome (single source of truth).

Domain types, and — more importantly — the **wire contracts** between the TypeScript and Python
halves (ADR-0003).

```text
src/
├── resume-parser.ts   ParseResponseWire + isParseResponse
├── skill-gap.ts       GapResponseWire, ReadinessWire + isGapResponse
└── skill.ts · requirement.ts · sponsorship.ts · explained.ts
```

**Every wire type ships with a runtime guard, and the guard is the point.** `as ParseResponseWire`
on a `fetch` result is a claim about a remote process, and the failure it hides — a renamed field
silently reading `undefined` — does not throw. It stores wrong data.

The guards check more than shape:

- a non-`ok` status must carry a reason, or the UI has nothing to show
- gap positions must be dense from 1, or "step 3 of 5" is a lie
- a partial score must name its source, because a number with no provenance is a bug
- a readiness point estimate must sit inside its own band, or three numbers are not describing one
  thing

`snake_case` on the wire because the Python side speaks it. Translating at the boundary is a bug
factory.

Neither side hand-writes the other's types. There is no schema generation yet — that needs its own
ADR — so the interim guard is golden fixtures written by the Python tests and validated here, and a
change on either side fails a test in the same pull request.
