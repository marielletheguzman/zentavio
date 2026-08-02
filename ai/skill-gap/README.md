# skill-gap

> **Purpose:** Compare user skills against job requirements; produce structured gap output.

Turns a profile plus a target into a weighted, dependency-ordered list of what is missing.
Contract: `docs/features/skill-gap-analysis.md`.

```text
src/skill_gap/
├── ports.py     what the gap needs from outside — all of it supplied in the request
├── compute.py   the arithmetic. No model runs here, and none should.
└── main.py      POST /gap, health, the shared error envelope
```

## Stateless, and visibly so

Requirements, profile and graph edges all arrive **in the request**, the same way the closed skill
set does for the résumé parser. That keeps `ai/` free of a persistent store (ADR-0003) and makes the
determinism M1b requires observable from outside the process: the same request body produces the
same response body, asserted by a test that posts it repeatedly.

## What the arithmetic actually does

A gap is not "requirements minus skills":

| Rule | Why |
|---|---|
| **Market scoping** | German is a real requirement in Berlin and absent for remote-worldwide. The most specific row wins; another market's row is dropped. |
| **Collapsing** | Holding a skill that `subsumes` a requirement covers it, so the gap does not tell someone to learn what they already have under another name. |
| **Partial credit** | A `transfers_to` edge reports partial coverage. It never closes the gap — a half-closed gap is still a gap, and whether the transfer is real is the user's call. |
| **Order** | `requires` edges impose dependency order, so nobody is told to learn Kubernetes before containers. |

**Only `evidenced` skills earn credit.** A `claimed` skill is a line in a list, and letting it close
someone's gap is the inflation the evidenced/claimed split exists to prevent.

**`adjacent_to` and `tooling_of` are deliberately ignored here.** Adjacency is not evidence of
competence, and treating it as partial credit would close gaps nobody has closed.

## Three answers, not one

| `status` | Means |
|---|---|
| `ok` | the gap was computed |
| `no_gap` | every modelled requirement is met — said plainly, with the held skills attached |
| `unknown` | the target is not modelled. Never a generic or empty gap. |

A requirement whose weight is unavailable is listed in `unweighted` rather than assigned a default,
because a default weight is an invented market fact. `confidence` is always stated, never implied.

## Reproducibility

Every result carries `scorer_version` and `knowledge_as_of`. Ordering carries a total-order
tiebreak — weight descending, then skill id — so the answer does not depend on the order rows
happened to arrive in from a database. There is a test for that specifically.
