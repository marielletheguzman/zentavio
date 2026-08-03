# scripts

> **Purpose:** Operational and maintenance scripts.

```text
audit-boundary-disables.mjs    every eslint-disable of the boundary rule, and whether it is justified
audit-boundary-disables.test.ts
```

**The audit exists because the boundary rule is disableable.** `eslint.config.mjs` fails the build
on a cross-boundary import (ADR-0005), and one `eslint-disable-next-line` silently undoes that. The
audit makes each disable visible and require a stated reason, so the exception is a decision someone
made rather than a line nobody saw.

A script here is tested like anything else. An untested script is the one that runs during an
incident.
