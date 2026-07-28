# Notifications

> **Purpose:** New match and deadline alerts.

Interrupting someone requires a real reason. Career decisions run on career timescales, so this feature
is deliberately quiet — and the discipline is in what it refuses to send.

**User question:** *what changed that I need to know about?*

## Valid triggers

Only these. Each earns an interruption because something outside the user's control changed, or something
perishable is due.

| Trigger | Why it earns it |
|---|---|
| A rule they depend on changed | their plan is now wrong |
| A tracked target's requirements changed | their gap moved |
| Readiness crossed a threshold they set | they asked to know |
| A high-value match appeared within their constraints | perishable |
| A tracked application or pathway stage is due | perishable and consequential |
| Their plan has stalled and a smaller next step exists | actionable, once |

The first is the clearest payoff of never mutating a fact: because immigration rules are versioned, a
change is detectable, and *"the threshold you were planning against changed on 2026-01-01"* is among the
most valuable things the platform can say.

## Invalid, explicitly

- Engagement prompts, streaks, "you haven't logged in".
- Re-sends of unchanged content.
- Digests with nothing new — **if there is nothing new, send nothing.**
- Manufactured urgency: no invented countdowns, no scarcity framing. The only deadlines surfaced are
  real ones.

A career platform that nags becomes a feed, and the trust that makes its numbers worth reading is the
thing it spends.

## Every notification carries

1. **What changed** — specifically, not "there are updates".
2. **Why it matters to them** — referencing their target, their plan, their number.
3. **One action.**

## Controls

- Per-category subscription, each independently unsubscribable.
- Frequency caps and quiet hours, enforced in `services/notifications`.
- Digest as an option for match alerts; never for a rule change, which is time-sensitive.
- Unsubscribing from everything is allowed and does not degrade the product's core, which is the
  dashboard.

## Privacy

Payloads carry **ids, never PII**. No résumé content, no salary figures, no immigration status in an
email, push payload, or log line — a notification travels through channels we do not control
(`docs/architecture/privacy.md`).

Rule-change alerts name the rule and the pathway, never the user's personal circumstances against it.

## Delivery

| Channel | Used for |
|---|---|
| In-app | everything; the source of truth for what was sent |
| Email | rule changes, due dates, opted-in match digests |
| Push (mobile) | due dates and opted-in high-value matches only |

Every send is recorded with its trigger, so "why did I get this?" is answerable, and so a trigger that
fires too often is visible to us before it is annoying to them.

## Failure behaviour

Idempotent on (user, trigger, subject, window) — a retry after a partial failure must not send twice.
A send that fails is retried within its relevance window and then dropped: a due-date reminder arriving
after the date is worse than silence.

## States

| State | Shown |
|---|---|
| **Empty** | "nothing new" as a designed state, not an empty list |
| **Unread** | grouped by trigger kind, newest first |
| **Stale** | a notification whose subject has since changed is marked, not silently updated |
| **Error** | delivery failure surfaced in-app rather than only logged |

## Dependencies

`services/notifications` · versioned events from ingestion and the knowledge engine ·
`immigration-tracking.md` for rule changes · `.claude/skills/recommendations/SKILL.md` for what
qualifies as high-value

## Related

- `immigration-tracking.md`, `job-matching.md`, `outcomes-learning.md`
- `docs/architecture/privacy.md`
