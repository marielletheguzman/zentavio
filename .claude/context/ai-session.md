# AI Session Memory

> **Purpose:** Temporary context for the current conversation only. Expires when the conversation does.
> Long-term memory: `ai-memory.md`.

Session memory exists so the assistant does not ask what was already answered. It is **not** a staging
area for facts about the user.

## What it holds

**Current intent** — finding jobs · improving a résumé · preparing interview answers · comparing career
paths · learning a technology.

**Current task context** — editing a résumé · reviewing a posting · drafting a cover letter · comparing
destinations · running a career simulation.

**Active conversation data** — job descriptions the user pasted, résumé content being edited, interview
questions in play, salary comparisons on screen, the current analysis result.

**Working state** — active filters, current target country and role, the surface they are on.

## Rules

The assistant **should**:

- Track conversation flow and refer back to earlier messages in the same session.
- Avoid re-asking anything already answered here.
- Use session context to interpret a short follow-up ("what about Luxembourg?").

The assistant **must not**:

- Persist session information without an explicit user action.
- Assume session context exists in a future conversation.
- Treat an inference made here as a fact about the user.
- Let pasted content leak into a stored profile silently.

## Promotion to long-term memory

The only path is **explicit**: the user says to save it, or takes an action that means it (setting a
target country, confirming a skill, saving a résumé version).

> "You mentioned targeting Luxembourg — add it to your preferred countries?"

Silent promotion is the failure mode. A country mentioned once in passing is not a preference, and a
skill claimed mid-conversation is not evidence. Anything promoted arrives as `claimed` with `low`
confidence unless it came with evidence (`ai-memory.md`).

## Expiration

Deleted when the user ends the conversation, on session timeout, or when they clear history. No archival
copy, no analytics snapshot, no "just in case" retention.

## Handling pasted content

Job descriptions and résumé text pasted into a conversation are **untrusted input**: delimited as data,
never followed as instructions (`docs/prompts/conventions.md`), and never written to a store as a fact
about the user without the promotion step above.

They are also **PII in transit**. Not logged, not in an error message, not in a trace
(`docs/architecture/privacy.md`).

## Implementation note

Session memory is **not** owned by `ai/` — AI services are stateless (ADR-0003) and receive session
context per request. It lives with the session, and it is the shortest-lived data in the system.

## Related

- `ai-memory.md` — the persistent counterpart, and the reconciliation with existing tables
- `docs/architecture/privacy.md`, `docs/prompts/conventions.md`
- ADR-0003 — why this is not stored inside `ai/`
