# System Diagram

> **Purpose:** Component and data-flow diagram: ingestion, knowledge, AI, app.

Diagrams only. The reasoning behind the boundaries is in `overview.md` and `principles.md`; the
stage-by-stage narrative is in `data-flow.md`.

## Components and dependency direction

```mermaid
graph TD
    subgraph apps["apps/ — Next.js"]
        WEB[web]
        ADMIN[admin]
        MOBILE[mobile]
    end

    GW["services/api-gateway<br/>auth · routing · rate limits"]

    subgraph svc["services/ — NestJS"]
        MATCH[matching]
        ING[ingestion]
        NOTIF[notifications]
        BILL[billing]
    end

    subgraph ke["knowledge-engine/ — FACTS"]
        SKILLS[skills-graph]
        COMP[companies]
        IMM[immigration]
        MKT[market-intel]
        IR[interview-reports]
        OUT[outcomes]
        VEC[vector-store]
    end

    subgraph ai["ai/ — Python, STATELESS, JUDGMENTS"]
        RP[resume-parser]
        SG[skill-gap]
        CR[career-roadmap]
        LP[learning-paths]
        IP[interview-prep]
        EMB[embeddings]
    end

    subgraph conn["connectors/ — PLUGINS"]
        CORE[core · registry]
        JB[job-boards]
        SAL[salary-data]
        CD[company-data]
        IMMD[immigration-data]
        LR[learning-resources]
    end

    subgraph store["substrate"]
        PG[(PostgreSQL<br/>system of record)]
        REDIS[(Redis<br/>cache · events)]
        QD[(Qdrant<br/>index)]
    end

    OLLAMA["Ollama<br/>Qwen · Gemma"]

    WEB -->|HTTPS only| GW
    ADMIN --> GW
    MOBILE --> GW

    GW --> MATCH
    GW --> ING
    GW --> NOTIF
    GW --> BILL

    MATCH --> ke
    MATCH -->|HTTP, packages/types| ai
    ING --> CORE
    ING --> ke

    CORE --> JB
    CORE --> SAL
    CORE --> CD
    CORE --> IMMD
    CORE --> LR

    ai -->|read facts via port| ke
    ai --> OLLAMA

    ke --> PG
    ke --> QD
    svc --> PG
    svc --> REDIS

    classDef facts fill:#e8f0fe,stroke:#4285f4
    classDef judge fill:#fce8e6,stroke:#ea4335
    classDef plug fill:#e6f4ea,stroke:#34a853
    class ke,SKILLS,COMP,IMM,MKT,IR,OUT,VEC facts
    class ai,RP,SG,CR,LP,IP,EMB judge
    class conn,CORE,JB,SAL,CD,IMMD,LR plug
```

**Read the arrows as "may import / may call".** They point inward only: `apps` → `services` →
`knowledge-engine` → `packages/types`. `ai/` and `knowledge-engine/` must run with `services/` and
`apps/` deleted. Only `connectors/core` may reference a connector. Only `ai/` reaches Ollama. All four
are enforced by `eslint.config.mjs` and `ruff.toml` (ADR-0005), not by convention.

## Ingestion flow

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant I as services/ingestion
    participant R as connectors/core
    participant C as connector
    participant K as knowledge-engine
    participant Q as Quarantine

    S->>I: start run (run id)
    I->>R: enabled connectors
    loop per connector, per page
        I->>C: search(query, cursor)
        C-->>I: raw payloads
        I->>C: normalize(raw) — pure
        I->>C: validate(normalized)
        alt rejected
            I->>Q: store raw + reasons
        else accepted or flagged
            I->>I: stage with dedupKey
        end
        I->>I: persist cursor (resumable)
    end
    I->>K: reconcile(run) — tier-aware merge
    K->>K: version facts, mark contested
    I->>I: expire unseen postings
    I-->>S: run report (counts, rejects, breakers)
```

## Reading flow — "am I ready for cloud engineering in Germany?"

```mermaid
sequenceDiagram
    participant U as apps/web
    participant G as api-gateway
    participant M as services/matching
    participant K as knowledge-engine
    participant A as ai/career-roadmap
    participant O as Ollama

    U->>G: request (authenticated)
    G->>M: authorized subject
    M->>K: profile facts, requirements, DE rules
    K-->>M: facts + provenance + asOf
    M->>A: facts (HTTP, packages/types contract)
    A->>A: transferability, gap, readiness — arithmetic
    A->>O: explain(computed evidence) — prose only
    O-->>A: explanation
    A-->>M: score + confidence + evidence + versions
    M-->>G: response
    G-->>U: number rendered beside its reasons
```

The model writes the explanation from evidence that code already computed. It never produces the
number — that is what makes the answer reproducible from `scorerVersion` and `knowledgeAsOf`.

## The learning loop

```mermaid
graph LR
    REC[recommendation shown] --> ACT[user acts]
    ACT --> OUT[outcome recorded]
    OUT --> TP[transition_path frequency]
    OUT --> TTC[time-to-competence]
    OUT --> REL[source reliability]
    OUT --> CAL[score calibration]
    TP --> REC
    TTC --> REC
    REL --> REC
    CAL --> REC
```

## Related

- `overview.md`, `principles.md`, `data-flow.md`
- `knowledge-engine.md`, `ai-services.md`, `connectors.md`
- ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0005
