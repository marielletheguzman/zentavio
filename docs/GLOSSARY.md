# Glossary

> **Purpose:** Canonical project terms: job, skill, connector, pathway, outcome, match score, and more.

This file is the terminology contract. A term used in code, a doc, a prompt, a table name,
or UI copy means what it means here — and nothing else. Every entry that is commonly
confused with something else carries an explicit **Not:** line. If a new concept appears
that is not in this list, add it here in the same change.

---

## Core system terms

### Career Intelligence
The reasoning capability that evaluates a person's employability, trajectory, and realistic
options — transitions, readiness, gaps, relocation viability.
**Not:** job search. **Not:** the LLM. **Not:** a single score.

### Knowledge Engine
The structured-knowledge substrate under `knowledge-engine/`: skills graph, career graph,
company registry, immigration rules and pathways, market intelligence, outcomes. Facts with
provenance, versioned over time.
**Not:** the LLM. **Not:** a cache. **Not:** the vector store alone (the vector store is one
index inside it).

### AI Service
A stateless capability under `ai/` that reasons over knowledge-engine facts and returns an
explained result. Owns no tables.
**Not:** a place where facts are invented or stored.

### Connector
A plugin under `connectors/` that imports data from one external source and implements
`search`, `fetch`, `normalize`, `validate`, `healthCheck`.
**Not:** a scraper. **Not:** a service. **Not:** something `services/ingestion` knows the
name of.

### Provenance
The record of where a fact came from: source, source URL, fetch time, connector version,
confidence tier. Attached to the fact itself.
**Not:** a log line. **Not:** optional.

### Evidence
The inputs and reasoning that produced a derived number or recommendation, stored beside it
and renderable in the UI.
**Not:** an explanation generated after the fact. **Not:** prose without references.

### Confidence
A declared reliability level (`high` / `medium` / `low`) derived from the source tier and
data completeness. See `.claude/context/knowledge-sources.md`.
**Not:** a model probability. **Not:** a score.

---

## Graphs

### Skill Graph
Relationships between skills: prerequisite, adjacent, subsumes, transfers-to, tooling-of,
with edge weights and provenance.
**Not:** a tag list. **Not:** a skills taxonomy without edges.

### Career Graph
Relationships between careers: adjacency, common transition paths, seniority ladders,
typical entry points, observed transition frequency.
**Not:** a job-title list. **Not:** the skill graph.

### Transferable Skill
A skill a person already holds that carries measurable weight in a target career, with the
graph edge that justifies the transfer.
**Not:** any overlapping keyword.

---

## Scores

Zentavio has several scores. They are not interchangeable, and none of them may be rendered
without evidence.

### Career Score
A person's overall employability for a **career track** — how hirable they are for that kind
of role, independent of any single posting.
**Not:** Job Match Score. **Not:** a resume score. **Not:** a percentage of skills matched.

### Job Match Score
Fit between one person and one **specific job posting**, across every signal
`docs/features/job-matching.md` defines — including work authorization, which is a hard constraint.
**Not:** Career Score. **Not:** Skill Fit.

**Nothing computes this yet** (ADR-0037). Work authorization is unevaluatable while
`job_postings.country_code` is null, and a number that omits a hard constraint nobody consulted is
not this score under a shorter name. What exists today is Skill Fit.

### Skill Fit
How much of what **one posting asks for** a person holds, or holds something that transfers.
One axis, named for itself. Stored in `matches` with `scorer_version = 'skill-fit-v1'`.

**Not:** Job Match Score — that is thirteen signals, this is one, and the difference includes whether
the person may legally take the job. **Not:** Career Score, which is not tied to a posting at all.
**Not:** a Skill Gap, which is the ordered work to close a target's requirements.

`unknown` here never means a bad fit: it means no number exists, because the posting has not been
read yet or because it asks for nothing curated. Those two are distinct and `missing` says which.

### Opportunity Score
Attractiveness of a career or market for a person — demand, salary, competition, relocation
viability — independent of that person's current readiness.
**Not:** Career Score (readiness), **not:** Job Match Score (fit).

### Career Readiness Score
How close a person is to being hirable in a target career **right now**, expressed with the
gap that remains.
**Not:** Career Score (current employability). Readiness is forward-looking, about a target.

### Interview Readiness
Preparedness for the interview process of a specific role or company, from interview reports
and practice outcomes.
**Not:** Career Readiness Score.

### Resume Score
Quality and completeness of the resume document as a document — parseability, evidence,
clarity.
**Not:** a judgment of the person. **Not:** Career Score.

### Migration-Friendly Employer Score
How much migration support a specific **employer** demonstrably provides — sponsorship, relocation,
immigration assistance — computed only from known factors and reported with how many were known.
**Not:** a probability of visa approval. **Not:** a company quality or culture score. **Not:** a
statement about permanent residency or citizenship, which are destination properties and never an
employer's.

### Immigration Feasibility
Whether a specific opportunity is realistically actionable for a specific person: sponsorship plus visa
eligibility plus recognition. Reported alongside a Job Match Score, never merged into it.
**Not:** Job Match Score. **Not:** a prediction of approval.

---

## Sponsorship and pathways

The terminology in this section is **binding on UI copy, prompts, and code**. The distinction it protects:
**employers sponsor, governments grant.**

### Visa sponsorship / work permit sponsorship
An employer's willingness and legal ability to sponsor an application.
**Not:** the permit itself. **Not:** a guarantee of approval.

### Relocation support
Employer-provided assistance with moving — cost, logistics, temporary housing.
**Not:** immigration assistance. **Not:** a visa.

### Immigration assistance
Employer-provided help navigating the process — legal counsel, document handling.
**Not:** sponsorship. **Not:** a decision.

### Permanent residency pathway
A route to residency defined by the **destination government**, with its own conditions and clock.
**Not:** anything an employer provides or accelerates by choice.

### Citizenship pathway
A route to citizenship defined by the **destination government**.
**Not:** "free citizenship". **Not:** an employer benefit. Never stated as offered by a company.

### Professional recognition
Whether a qualification or licence earned at origin is accepted at destination, decided by the
destination's competent authority.
**Not:** visa eligibility — a country can be visa-accessible while a licence is not transferable.

### Sponsorship status
The four-valued state of what is known about a posting: `stated_available`, `stated_unavailable`,
`inferred_likely`, `unknown`.
**Not:** a boolean. **`unknown` is never treated as `stated_unavailable`** — silence is not a refusal.

## Banned phrasings

| Never | Because |
|---|---|
| "free citizenship" | employers do not grant citizenship; governments do |
| "guaranteed visa" / "approval likely" | we do not predict government decisions |
| "employer provides permanent residency" | conflates employer support with a state decision |
| "no sponsorship" for an `unknown` posting | asserts a fact nobody stated |
| "visa-ready" / "migration guaranteed" | implies a verdict we cannot give |

---

## Career and learning

### Career Transition
Moving from one profession to another (support engineer → cloud engineer). Modeled as a path
through the career graph with a gap, a plan, and a viability estimate.
**Not:** a promotion. **Not:** a job change within the same career.

### Skill Gap
The set of skills required by a target that the person lacks or under-evidences, each with
its weight and how it was determined.
**Not:** a diff of two keyword lists.

### Learning Path
An ordered sequence of learning steps that closes a specific skill gap, each step tied to a
gap item and to real learning resources.
**Not:** a course list. **Not:** a curriculum with no target.

### Learning Resource
An external, identified artifact that teaches something — course, doc, book, lab, cert —
imported by a connector with provenance.
**Not:** a link Claude remembered.

### Outcome
A recorded real-world result: applied, interviewed, offered, rejected, relocated, completed a
course. The feedback signal the platform learns from.
**Not:** a user action log. **Not:** analytics.

---

## Geography and mobility

### Country Intelligence
Structured knowledge about a country as a place to work: labor market, immigration rules,
languages, salaries, cost of living, hiring difficulty, official sources.
**Not:** a country list. **Not:** immigration rules alone.

### Immigration Rule
A single versioned, dated, officially sourced requirement or constraint (eligibility,
threshold, quota, document, timeline).
**Not:** advice. **Not:** a summary of a rule.

### Immigration Pathway
A named route to work or residence in a country (e.g. EU Blue Card), composed of rules, with
stages and timelines.
**Not:** a visa type in isolation. **Not:** legal advice.

### Relocation Viability
Whether a specific person can realistically work in a specific country — eligibility under a
pathway, plus market and language reality.
**Not:** visa eligibility alone.

---

## Data flow

### Raw Payload
Exactly what a source returned, stored unmodified for provenance and reprocessing.

### Normalized Record
A raw payload mapped to a Zentavio type by a connector's pure `normalize`. Absent fields stay
`null` — never defaulted, never guessed.

### Deduplication Key
The stable derived key that lets the same posting from two sources reconcile to one fact.

### Source Reliability
An observed 0..1 value per connector, derived from validation pass rate and outcome feedback.
**Not:** the confidence of a single record. **Not:** declared by hand.

### Ingestion Run
One scheduled execution of connectors — discovery, normalization, validation, reconciliation
— with its own record of what was accepted, flagged, and rejected.
