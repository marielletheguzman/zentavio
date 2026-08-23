# services

> **Purpose:** Backend runtime services. Each is independently deployable with its own boundary.

| Service | State |
|---|---|
| `api-gateway` | built — the only component that authenticates, and the only one a browser talks to |
| `ingestion` | built — requirement ingest, posting ingest, the due-source scheduler, and the alias skill scan. **Nothing calls `runDueJobBoards`**: what triggers a run is a deployment decision and nothing is deployed |
| `matching` · `notifications` · `billing` | placeholder |

**These compile; they are not type-stripped** (ADR-0014's amendment). NestJS needs decorators and
parameter properties, which are a `SyntaxError` under Node's strip-only mode. **A stale `dist/` is
the failure mode — the symptom is a change that appears to do nothing.**

Adding a data source must never require editing `services/ingestion` (principle 4). Sources are
connectors; the service is the thing that runs them.
