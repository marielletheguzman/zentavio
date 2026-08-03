# lib

> **Purpose:** Web-app client/server helpers (fetchers, formatting, auth glue).

```text
parse-view.ts   the upload response → its five states
gap-view.ts     the gap response → its six states, plus the readiness band and its assumption
```

**Pure functions over a validated response, and that is the whole point.** These take a wire type
and return what to render — no fetching, no React, no `window`. That is what makes the state
machine assertable instead of clickable, and `.claude/context/ui-guidelines.md` requires every state
designed before the success state is styled.

**No fetchers and no auth glue yet.** The panels fetch, and the dev credential is one header
(ADR-0017) that disappears when a real session lands — a real one will be an httpOnly cookie the
browser sends by itself, which is glue nobody writes.
