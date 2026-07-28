# Cloud / Platform Engineer (`cloud-platform-engineer`)

> **Purpose:** Career model for cloud / platform engineering. Defines the skill set, ladder, entry points,
> adjacency, and evidence standards. **Weights, demand, and salary values live in `knowledge-engine`, not
> here.**

**The MVP track** (`docs/roadmap/mvp.md`). Chosen because it is not a regulated profession — so it needs no
licence recognition and does not wait on ADR-0010's origin-side rules being sourced — and because its skill
set is well-defined enough that `requires` edges are derivable rather than guessed.

---

## What this track is

Building and operating the infrastructure other engineers deploy onto: provisioning it as code, running
containerised workloads, and owning the reliability, observability, and cost of the platform. The work is
judged on whether other teams can ship safely without asking for help.

**Not software engineering.** Overlapping skills, different judgment: a backend engineer owns a service's
behaviour, a platform engineer owns the substrate every service runs on.

**Not IT support or sysadmin work**, though it is the most common route *from* there. The distinction is
infrastructure-as-code and self-service: maintaining servers by hand is the previous generation of the same
responsibility.

**Not "DevOps"** as a job title. Treated here as a practice, not a career node — postings using it usually
describe this track or backend engineering, and the extraction should resolve to whichever the requirements
actually describe.

## Skill set

Skill ids must exist in the skill graph. **This list is the seed, not the truth.**

| Cluster | Skills | Role |
|---|---|---|
| Core | `linux-fundamentals`, `networking-fundamentals`, `containers-docker`, `kubernetes`, `infrastructure-as-code-terraform`, one of `aws` / `azure` / `gcp` | required — absence blocks |
| Supporting | `ci-cd-pipelines`, `git`, `bash-scripting`, `python-scripting`, `observability-monitoring`, `secrets-management` | expected at most levels |
| Differentiating | `sre-practices`, `cost-optimization`, `platform-self-service`, `security-hardening`, `multi-cluster-operations` | separates senior from mid |
| Peripheral | `service-mesh`, `serverless`, `data-pipeline-basics` | nice to have, rarely decisive |

**Method for this list: curated, and pending derivation.** It is written from the shape of the work, **not**
from measured posting frequency, because no postings are ingested yet. Every entry is therefore a hypothesis
to be replaced by `posting-cooccurrence` with real `support` counts once ingestion runs
(`docs/database/entities/skill.md`).

**Cloud provider is deliberately one-of.** A posting asking for AWS is not satisfied by Azure, but the
*career* does not require all three. Modelled as an alternative set, not three separate core requirements —
otherwise every candidate shows a permanent two-item gap that no employer actually asks them to close.

## Prerequisites

The `requires` edges that make a learning path orderable. Deliberately sparse: an over-eager prerequisite
makes a path longer than the gap requires, which makes a reachable target look unreachable.

```text
containers-docker                  requires  linux-fundamentals
kubernetes                         requires  containers-docker
kubernetes                         requires  networking-fundamentals
infrastructure-as-code-terraform   requires  <cloud provider>
ci-cd-pipelines                    requires  git
observability-monitoring           requires  linux-fundamentals
sre-practices                      requires  observability-monitoring
multi-cluster-operations           requires  kubernetes
cost-optimization                  requires  <cloud provider>
```

These are technical dependency claims — learning Kubernetes without containers is genuinely inefficient —
recorded with `basis: curated`. They still need validation against ingested curricula, and any that a real
learning path contradicts should be removed rather than defended.

## Seniority ladder

Distinguished by **scope of judgment**, not by years. Years are a proxy for skills we measure directly.

| Level | What changes | Typical evidence |
|---|---|---|
| Entry | operates what others built; follows runbooks | contributions to IaC, a lab or home cluster |
| Mid | owns a service's infrastructure end to end | production IaC, an on-call rotation survived |
| Senior | designs the platform; sets the patterns others follow | a migration led, a reliability improvement with numbers |
| Staff / Lead | decides build-vs-buy; owns cost and reliability across teams | an architecture decision with its tradeoffs written down |

## Entry points

Where people realistically arrive from, and what carries over.

| From | Transfers | Usually missing |
|---|---|---|
| IT support / helpdesk | Linux, networking, troubleshooting instinct | IaC, containers, any code-as-infrastructure habit |
| System administration | Linux, networking, operations judgment | Kubernetes, IaC, CI/CD |
| Backend software engineering | Git, CI/CD, scripting, code review habits | Linux depth, networking, operational ownership |
| Network engineering | networking depth | containers, IaC, cloud provider model |
| NOC / monitoring roles | observability exposure, incident familiarity | everything build-side |

**IT support and sysadmin are the important rows** for this user base: both are common Philippines starting
points, and both transfer real, evidenced skills. That is why this track was chosen — the transferability
story is genuine rather than theoretical.

**Frequencies are unmeasured.** These are plausible routes, not observed ones. `transition_path` edges with
real frequency come from `knowledge-engine/outcomes` once outcomes exist
(`docs/features/outcomes-learning.md`).

## Adjacent careers

| Adjacent track | Direction | What transfers | What does not |
|---|---|---|---|
| Site reliability engineering | near-lateral | almost everything | deeper statistics, error-budget practice |
| Backend software engineering | lateral | scripting, CI/CD, Git | language depth, API and data modelling |
| Security engineering | lateral | hardening, secrets, networking | threat modelling, compliance |
| Data engineering | further | containers, IaC, pipelines | data modelling, warehouse work |
| IT support | reverse | — | — |

Transfer weights come from skill-graph edges with their provenance. **No numbers are written here** —
a weight in a reference file is a market fact frozen at the moment someone typed it.

## Evidence standards

What actually demonstrates competence, so `evidenced` versus `claimed` is decidable
(`docs/database/entities/user.md`).

- **Strong:** infrastructure-as-code in a real repository; a cluster operated in production; an incident
  handled with a written postmortem; a migration completed; contributions to an infrastructure project.
- **Moderate:** a recognised certification — cloud provider associate/professional, or a Kubernetes
  administrator certification. Proves examined knowledge, not operational judgment.
- **Weak:** course completion, self-report, a tutorial followed.

**Certifications are unusually useful in this track** for a Philippines-origin applicant: they are
internationally recognised, verifiable by the issuer, and independent of the origin education system — which
is exactly what credential evaluation is otherwise needed for. Worth surfacing in learning paths for that
reason, while still being `moderate` rather than `strong`.

## Verification

| Route | Promotes to |
|---|---|
| In-platform assessment | `evidenced` |
| Public repository with IaC or manifests | `evidenced` |
| Issuer-verified certification | `evidenced`, at the certification's own weight |
| Course completion claimed | stays `claimed` |

## Interview shape

Role-generic, from requirement facts rather than reports — no interview reports exist yet. Typically a
systems-design or troubleshooting exercise, a practical or take-home involving IaC or a broken cluster, and
a behavioural round covering incident handling. Company-specific patterns live in
`knowledge-engine/interview-reports` and require minimum support before they are surfaced
(`docs/features/interview-prep.md`).

## Market notes

**Deliberately empty.** Demand, salary bands, hiring difficulty, and sponsorship prevalence are
`market_signals` and `salary_bands` rows with sources and dates — not prose in a reference file. Writing
"high demand in Germany" here without a citation is precisely the fabrication
`.claude/context/ai-principles.md` rule 8 forbids.

What is needed, and tracked as MVP work: DE demand for this track, DE salary bands against the Blue Card
threshold, and whether English-only roles are realistically available at this level.

## Sub-specializations

`platform-engineering` · `sre` · `cloud-infrastructure` · `devops-tooling` · `kubernetes-operations`.
Modelled as one node for the MVP. An unmodelled sub-specialization returns `unknown` rather than the generic
track's answer.

## Open questions

1. **Cloud provider weighting.** If German postings skew heavily to one provider, the alternative set may
   need per-market weights. Answerable only from ingested postings.
2. **Is `devops-engineer` a distinct node?** Currently treated as a title for this track. If postings
   describe a materially different role, it becomes its own node.
3. **English viability at this level in Germany.** Genuinely uncertain and high-stakes for this user base;
   needs sourcing rather than assumption.

## Related

- `.claude/context/career-philosophy.md` — what makes a career succeed
- `.claude/skills/career-intelligence/SKILL.md` · `learning-paths` · `ai-matching`
- `docs/roadmap/mvp.md` — why this track is first
- `docs/database/entities/skill.md` — where weights and edges actually live
