# apps

> **Purpose:** Deployable user-facing applications. Each subfolder is an independently buildable app.

| App | State |
|---|---|
| `web` | built — résumé upload with correction, and the gap surface with readiness |
| `admin` | placeholder |
| `mobile` | placeholder |

**Every app talks to `services/api-gateway` and nothing else.** The `ai/*` services carry no
authentication of their own, so an app that could reach one directly would be an open endpoint.
