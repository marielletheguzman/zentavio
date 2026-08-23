# Computer Engineer (`computer-engineer`)

> **Purpose:** Career model for computer engineering. Defines the skill set, ladder, entry points,
> adjacency, and evidence standards. **Weights, demand, and salary values live in
> `knowledge-engine`, not here.**

---

## What this track is

Designing and building computing systems across the hardware/software boundary: embedded and systems
software, firmware, device drivers, and the platforms that run them. The defining constraint is that
the machine is part of the problem — memory is finite, timing is a correctness property rather than a
performance one, and there is frequently no operating system underneath to hide any of it.

**Not:** a **cloud / platform engineer**, who operates infrastructure other engineers deploy onto.
That track's binding question is *how do we run this reliably at scale*; this one's is *how do we
make this system work at all, on this hardware*. They share Linux, Git and C-adjacent tooling, which
is why the two are constantly confused, and they diverge completely above that.

**Not:** an **electronics / hardware engineer**, who designs the board. Schematic capture, PCB layout,
HDL and FPGA work are a neighbouring track. A computer engineer reads a datasheet and writes the
software that drives the part; they do not usually design it.

**Not:** a general **software engineer**. The overlap is real and large, and the difference is that a
computer engineer is accountable for behaviour that a language runtime normally guarantees.

## Skill set

| Cluster | Skills | Role |
|---|---|---|
| Core | `c-programming`, `firmware-development`, `embedded-linux`, `device-drivers`, `computer-architecture`, `rtos`, `linux-fundamentals`, `networking-fundamentals`, `git`, `python`, `bash-scripting`, `english` | required — absence blocks |
| Supporting | `gdb`, `cmake`, `docker`, `containers`, `ci-cd`, `observability`, `cloud-fundamentals`, `german` | expected at most levels |
| Differentiating | `cpp`, `misra-c` | separates senior from mid |
| Peripheral | `rust`, `go`, `postgresql` | nice to have, rarely decisive |

**Method for this list: judgement against the track definition, sourced to official documentation —
not co-occurrence.** No posting corpus supports it. The only board ever fetched is Lever's demo
board, and **343 of its 383 postings declare themselves fictional** in their own text (*"a fictional
job created solely for demonstration purposes"*); the remaining 40 are largely test artefacts with
empty requirement lists. Deriving a skill set from that would be deriving it from fiction.

Every skill added carries `source_url` pointing at the maintainer's own documentation, or `null` where
no single authority exists. `firmware-development` and `computer-architecture` are `null` on purpose:
they are practices with no canonical owner, following `networking-fundamentals`. Three sources were
wanted and **not** used because their pages could not be verified — `developer.arm.com`,
`standards.ieee.org` and `iso.org` all answer `403` to an automated request, and a URL that cannot be
fetched is not a citation.

**When a real corpus exists, this list is the hypothesis to test, not the answer.** Co-occurrence over
ingested postings replaces it, and the weights in `packages/db/seeds/computer-engineering.json` are
declared rather than measured until then — which the seed's `basis: 'curated'` and `source_tier: 3`
already say.

## Prerequisites

The `requires` edges that make a learning path orderable. Strict: an edge means the second skill is
genuinely hard to learn without the first.

```text
firmware-development  requires  c-programming
firmware-development  requires  computer-architecture
device-drivers        requires  c-programming
device-drivers        requires  linux-fundamentals
device-drivers        requires  computer-architecture
embedded-linux        requires  linux-fundamentals
embedded-linux        requires  c-programming
rtos                  requires  c-programming
rtos                  requires  computer-architecture
misra-c               requires  c-programming
cpp                   requires  c-programming
gdb                   requires  c-programming
```

**`c-programming` is the root of this track's dependency graph**, which is the structural difference
from cloud/platform engineering, where `linux-fundamentals` is. Someone who cannot read C cannot be
taught drivers, firmware or MISRA in any order that works.

`cpp requires c-programming` is the arguable one. Modern C++ is teachable without C first, and the
edge is kept because the embedded dialect of C++ in this track is not modern C++ — it is C with
scope, and the code a computer engineer will read is full of the C underneath.

## Transfer

Where competence genuinely carries. These are the `transfers_to` edges Skill Fit credits, so an
overstated one hands somebody a skill they do not have.

```text
c-programming        transfers_to  cpp                  0.70
cpp                  transfers_to  c-programming        0.60
c-programming        transfers_to  rust                 0.45
firmware-development transfers_to  device-drivers       0.70
rtos                 transfers_to  firmware-development 0.65
embedded-linux       transfers_to  device-drivers       0.60
```

`c → rust` is deliberately the weakest. The systems-level mental model transfers — ownership,
lifetimes and the borrow checker do not, and they are most of the difficulty.

## Seniority ladder

| Level | What changes | Typical evidence |
|---|---|---|
| Entry | Works inside an existing codebase on a board somebody else brought up | A driver or feature merged; a bug traced with a debugger rather than by guessing |
| Mid | Owns a subsystem; brings up a peripheral from a datasheet | A peripheral working end to end; a memory or timing bug found and fixed |
| Senior | Owns the board bring-up and the architecture decisions under it | A system taken from schematic to booting; a decision that survived contact with production hardware |
| Staff/Lead | Owns the platform other teams build products on | A BSP or SDK other teams depend on; a safety or certification path completed |

Levels are distinguished by scope of judgment, not by years. Years are a proxy for skills measured
directly (`.claude/context/career-philosophy.md`).

## Entry points

- **Electronics or computer-engineering degree.** The most common route, and the one that matters for
  Germany specifically: the protected title `Ingenieur` is regulated per Land and turns on the
  qualification, not the work (ADR-0029, `.claude/skills/immigration/references/countries/de.md`).
  **The work itself is not a regulated profession** — software and platform work in Germany needs no
  recognition, and that is a real answer rather than an `unknown`.
- **From general software into embedded**, usually via Linux and C. The gap is `computer-architecture`
  and the habit of treating timing as correctness.
- **From electronics/hardware into firmware.** The gap is software engineering practice — version
  control, testing, CI — not the domain.

## Adjacent careers

| Track | Shared | What must be added |
|---|---|---|
| Cloud / platform engineer | Linux, Git, containers, CI/CD, Python, Bash | orchestration, IaC, SRE practice; loses the hardware constraint entirely |
| Backend software engineer | C/C++ or Rust, testing, CI | distributed systems, data stores, API design |
| Electronics / hardware engineer | datasheets, computer architecture | schematic capture, PCB layout, HDL — a different discipline, not a promotion |

## Evidence standards

- **Working hardware beats a repository.** A driver merged upstream, a board brought up, a bug traced
  to a race in an interrupt handler — these demonstrate the thing the track is about.
- **A course completion evidences nothing** (ADR-0030). Only an in-platform assessment may promote a
  skill to `evidenced`, and none exists for any skill on this track: `git-fundamentals` is the one
  instrument that exists.
- **Certifications are weak here.** The track has no widely-recognised credential, and treating a
  vendor course as evidence would be a stronger claim than the industry itself makes.

## Verification

Nothing on this track is verifiable in-platform today. Every skill listed resolves to `claimed` from a
résumé, which Skill Fit scores at reduced cover on purpose (ADR-0037). Building an assessment for
`c-programming` would be the highest-value instrument for this track, and it does not exist.

## Open questions

- **The skill set is untested against real postings.** It is judgement, and it is labelled as such
  above. The first real board fetched for embedded roles should be compared against this list, and the
  differences treated as evidence about the list rather than about the postings.
- **No sub-specialisation is modelled.** Automotive, medical, aerospace and consumer embedded differ
  sharply in certification burden — `misra-c` is core in automotive and irrelevant in consumer — and
  the single `computer-engineer` track flattens that.
- **HDL and FPGA are excluded by judgement**, on the grounds that they belong to the hardware track.
  A posting corpus may say otherwise.

## Related

- `packages/db/seeds/computer-engineering.json` — the graph rows this model describes
- `cloud-platform-engineer.md` — the adjacent track, and the worked example for this format
- ADR-0030 (what may promote a skill to `evidenced`), ADR-0037 (what a match may claim)
- `.claude/skills/immigration/references/countries/de.md` — the `Ingenieur` title, and why the work is
  not regulated
