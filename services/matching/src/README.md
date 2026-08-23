# src

> **Purpose:** Matching source: scoring arithmetic, feature builders, the scoring API.

| Module | Holds |
|---|---|
| `skill-fit.ts` | `scoreSkillFit` — pure; requirements, held skills and edges in, a score and its evidence out |
| `scoring-run.ts` | `scorePostingForUser` — retrieve, score, record |
| `index.ts` | the public surface |

Design rationale is in [`../README.md`](../README.md). The split is `services/ingestion`'s: the
interesting behaviour is testable without PostgreSQL, and here that behaviour is **what a match may
claim when a signal was never consulted**.

## The three numbers, and why they are these

| Constant | Value | Why |
|---|---|---|
| evidenced cover | `1` | the skill is demonstrated |
| claimed cover | `0.6` | a résumé sentence is a claim nobody checked (ADR-0030) |
| transfer cover | edge weight × the above | `skill_edges.transfers_to` only — never `requires` or `adjacent_to` |

**The best transfer wins, never the sum.** Holding three things that each partly carry into
Kubernetes does not add up to knowing Kubernetes.

**Only `transfers_to`.** `requires` is a prerequisite relation and `adjacent_to` is a neighbourhood;
neither means competence carries, and crediting them would hand somebody a skill they do not have.

## Reconciliation is by construction

Each requirement's contribution is rounded to four decimals — matching `matches.score numeric(5,4)` —
and the score accumulates from the **rounded** values. Summing at full precision and rounding once at
the end would leave the evidence weights adding up to something the score is not, and `match.md`
requires that weights reconcile rather than approximately reconcile.

Positives sum to `score`. Positives plus the `skill_missing` entries sum to 1.
