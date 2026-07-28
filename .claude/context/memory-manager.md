# AI Memory Manager

> **Purpose:** How the memory layers interact, how a piece of information is routed, and how multiple
> agents share one memory foundation. Companions: `ai-memory.md` · `ai-session.md` ·
> `ai-memory-policy.md`.

## Flow

```text
User input
    │
    ▼
Session memory          always, automatically
    │
    ▼
Memory evaluation       is this worth keeping?
    │
    ▼
Long-term memory        only on an explicit action
```

The Memory Manager is a **service capability**, not an `ai/` module — memory is state, and `ai/` is
stateless (ADR-0003). It is the **single writer** to long-term memory; agents read through a port and
never write to each other's data (`ai-memory.md`, reconciliation).

## Decision flow

```text
New information
    │
    ├── Useful later? ──── no ──► session only, discarded
    │        │
    │       yes
    │        ▼
    ├── Career-related? ── no ──► session only
    │        │
    │       yes
    │        ▼
    ├── Sensitive? ─────── yes ─► ask permission first
    │        │
    │        no
    │        ▼
    └── Conflicts with existing memory? ── yes ─► resolve per precedence, ask before
             │                                    overwriting evidence
             no
             ▼
        store with source · status · confidence · timestamps
```

Four checks before any write: **is it new · is it career-related · is it useful later · does it
conflict.**

## Worked examples

| User says | Category | Stored where | Why |
|---|---|---|---|
| "I completed AWS Solutions Architect Associate." | certification | long-term | useful for matching, gap, and readiness indefinitely |
| "I am tired today." | conversation context | session only | no future value |
| "What about Luxembourg?" | current intent | session only | a question is not a preference |
| "Add Luxembourg to my target countries." | preference | long-term | explicit action |
| "I think I know Terraform." | claimed skill | long-term, `claimed` / `low` | useful, but not evidence |
| "My passport number is …" | **restricted** | **nowhere** | store permit status, never the number (`ai-memory-policy.md`) |

## Access rules

**Session memory** — used automatically.

**Long-term memory** — read only when it is relevant to the current task *and* permitted by the user's
privacy settings. Relevance matters beyond privacy: pulling a user's whole profile into every prompt
wastes context and increases the surface for a leak. Each agent receives the slice it needs.

## Agents map onto existing services

The agent roster is a **product-facing view of services that already exist**, not a second architecture.
Stating the mapping so nothing is built twice:

| Agent | Implemented by | Memory it reads |
|---|---|---|
| **AI Career Agent** | `ai/career-roadmap` | goals, background, skills, target careers |
| **Resume Agent** | `ai/resume-parser` + a generation prompt | work history, projects, skills, achievements, target role |
| **Job Matching Agent** | `services/matching` + `ai/skill-gap` | target roles, skills, location and remote preferences, salary, sponsorship requirement |
| **Immigration / Sponsorship Agent** | eligibility path in `ai/career-roadmap` | target countries, work authorization status, sponsorship requirement |
| **Interview Coach Agent** | `ai/interview-prep` | target roles, interview history, skills, experience |

Constraints that continue to apply to all of them:

- **No agent calls another agent.** Orchestration is a service's job; a peer call is hidden state in the
  call graph (`docs/architecture/ai-services.md`).
- **No agent owns a store.** Memory arrives per request; nothing is retained.
- **One writer.** Memory updates go through the Memory Manager, which is how rule 4 — never overwrite
  another agent's information without validation — is enforced structurally rather than by convention.
- **Every write records source and timestamp.**

Two roster items are **new capabilities**, not just new labels:

- **Résumé generation** ("improve resumes", "generate achievement statements") — the current
  `ai/resume-parser` only extracts. Generation needs its own versioned prompt, its own eval cases, and a
  rule that it never invents an achievement the profile does not support.
- **Sponsorship-friendly employer identification** — specified in
  `docs/features/migration-friendly-jobs.md`, including the constraint that employer sponsorship is
  sourced from registries, postings, and our own outcomes — **never by profiling the nationality of an
  employer's staff.**

## Shared memory, many consumers

```text
long-term memory ──┬──► career agent      → roadmap
                   ├──► résumé agent      → tailored résumé
                   ├──► matching agent    → ranked opportunities
                   ├──► immigration agent → sponsorship + pathway view
                   └──► interview coach   → practice and feedback
```

One profile, five readers, and each output carries **which memory influenced it** as a named evidence
entry. Personalization that cannot be explained is indistinguishable from a guess
(`.claude/context/ai-principles.md`).

The immigration agent additionally obeys the terminology rule: employers sponsor, governments grant. It
may report that a **pathway** exists; it never says a company provides residency or citizenship
(`docs/GLOSSARY.md`).

## Memory in job matching

```text
stored: Python · AWS · goal AI Engineer · sponsorship required
    ▼
recommend: roles matching the goal, ranked with sponsorship as a named factor,
           with gaps and any binding constraint shown
```

The sponsorship requirement becomes a **named constraint**, never a silent filter — and `unknown`
sponsorship is not treated as unavailable (`docs/features/migration-friendly-jobs.md`).

## Future agents

Salary negotiation · learning path · portfolio review · networking · personal branding. Each follows
these rules and `ai-memory-policy.md`; each needs its own prompts and eval cases before it ships. A new
agent is not a reason to add a second memory store.

## Source of truth

If the implementation differs from these documents, one of them is wrong and gets fixed — deliberately,
in the same change (CLAUDE.md principle 5).

## Related

- `ai-memory.md` · `ai-session.md` · `ai-memory-policy.md`
- `docs/architecture/ai-services.md` — the services these agents are
- `docs/features/migration-friendly-jobs.md` · `docs/GLOSSARY.md`
- ADR-0003 — why the Memory Manager is not inside `ai/`
