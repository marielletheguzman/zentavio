# tests

> **Purpose:** Cross-cutting and end-to-end test suites spanning multiple services.

| Directory | Holds |
|---|---|
| `fixtures` | shared fixtures, including the golden wire fixtures Python writes and TypeScript validates |
| `integration` | suites that need a real database — schema, repositories, the gateway's routes |
| `unit` | `contracts/` — the cross-language wire contract; `invariants/` — M1a's invariants asserted in both languages |
| `e2e` | empty — nothing is deployed to run against yet |

Tests that belong to one package live **in** that package. What lands here is what spans more than
one, which is why `e2e` stays empty until there is an environment to point it at.

**The cross-language contract is checked, not trusted** (ADR-0003): the Python tests write golden
fixtures, the TypeScript guards validate them, and a change on either side fails a test in the same
pull request.
