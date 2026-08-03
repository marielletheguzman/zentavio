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

## Readiness, and why it is three numbers rather than one

```text
readiness = sum(weight(r) * credit(r)) / sum(weight(r))
credit: 1.0 evidenced · 0.6 claimed · transfer-edge weight · 0 otherwise
```

**A point estimate implies precision the inputs do not have.** Only two of the five bases are
*known* — an evidenced hold and a subsumed one. A claimed skill is the person's word, and a
transfer edge is a general statement about how competence carries, not a measurement of how it
carried for them. So the score travels as a band:

| | Counts |
|---|---|
| `score_low` | evidenced and subsumed only — true even if every assertion is hollow |
| `score` | the formula above |
| `score_high` | every claimed skill and transfer edge in full |

**The width is the point.** Nothing estimated means no band at all, and the surface renders no
range rather than "62% to 62%", which would imply a doubt that does not exist.

**`by_cluster` exists because the blend hides which part is strong.** Someone 70% through the core
of a track and 0% through its peripherals, and someone with the reverse, can produce the same
overall number while being in completely different positions. Each cluster reports its own score
*and its share of the denominator*, because 70% of a part worth 7% of the track is not a strong
position and the score alone cannot say so.

Real numbers, against the seeded track with three evidenced skills and one claimed:

```text
point  15%      band  13% .. 16%
  Supporting       20%  of a part worth 52% (15 reqs)
  Core             14%  of a part worth 33% (7 reqs)
  Differentiating   0%  of a part worth  8% (3 reqs)
  Peripheral        0%  of a part worth  7% (5 reqs)
```

## The calibration travels with the score

`CLAIMED_CREDIT = 0.6` is the one tuning constant in the arithmetic, and it is **not** derived from
data — no recorded outcomes exist to calibrate against. That makes it an assumption, and
`ai-matching/SKILL.md` forbids a hidden penalty: *"every negative contribution appears in
evidence"*. A 40% haircut on every listed-but-undescribed skill is exactly one.

So every result carries `calibration`, on the wire and on the screen:

```text
A skill you listed but did not describe counts for 60% of one you did — fixed by
career-intelligence/SKILL.md rather than derived from data, because no recorded outcomes exist yet
to calibrate against. It becomes a measurement once there are recorded outcomes in
knowledge-engine/outcomes.
```

Two reasons it is emitted rather than left in this module:

- **`scorer_version` records which code ran, not what it assumed.** Two runs of the same version
  are only comparable if both calibrations are knowable, so a stored score that omits this cannot
  be reproduced from its own output.
- **A constant with no revisit trigger quietly becomes permanent.** `awaiting` names the condition
  that replaces the assumption with a measurement.

The value itself is deliberately unchanged. Moving it without outcome data would substitute one
guess for another, which is worse than an acknowledged assumption.

## What readiness refuses to do

- **No bare score.** The remainder, confidence, every term's basis, and the scorer version travel
  with it or it is not emitted.
- **No invented timeline.** `estimated_time_to_ready` is null and says why. There is no
  time-to-competence data, and optimistic timelines are the most damaging thing a career platform
  can produce.
- **No asserted binding constraint.** Market demand, language and eligibility are unmodelled.
- **No number for an empty profile.** `unknown` plus the input that would resolve it — a zero reads
  as "you are not ready" when the truth is "we have not been told anything about you".
