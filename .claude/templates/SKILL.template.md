---
name: <kebab-case-name>
description: <What this skill governs, and the concrete triggers that should load it. Name paths, file types, and task phrasings. This field is the only thing Claude sees before deciding to load the skill — make it specific, not aspirational.>
---

# <Skill Name>

## Purpose

One paragraph. What this skill exists to keep consistent across the lifetime of Zentavio.

## Scope

**Applies to:** explicit paths and task types.
**Does not apply to:** the adjacent things a reader might wrongly assume, with a pointer to
the skill that does own them.

## Responsibilities

Numbered list of what Claude must guarantee whenever this skill is active.

## Workflow

Ordered steps. Start with what to read, end with what to verify. Every step should be
checkable — "confirm X exists", not "consider X".

## Constraints

Hard rules. Phrase as prohibitions. These are the lines that must not be crossed even
when a prompt asks for it, without an ADR overriding them.

## Dependencies

- Documents this skill reads as source of truth (real paths only)
- Other skills that must load alongside it
- Packages or contracts it assumes

## Examples

At least one worked example. Prefer a good/bad pair over prose.

## Best Practices

Judgment calls that are not hard rules but reflect how Zentavio prefers to solve things.
