# AI Memory Policy

> **Purpose:** Privacy, retention, security, and precedence rules for AI memory. Binding on anything that
> reads or writes user memory. Structure: `ai-memory.md` · `ai-session.md` · `memory-manager.md`.

## Principles

Data minimization · user control · transparency · purpose limitation.

Store only what is necessary for career assistance, and only what improves a future answer.

## Allowed

Career history · skills · certifications · job preferences · learning goals · résumé preferences ·
professional interests · target roles and countries · salary expectations · language proficiency.

## Restricted — never stored

| Never | Note |
|---|---|
| Passwords or credentials | authentication is `packages/auth`'s concern, never memory |
| Financial account information | not needed for any career answer |
| **Government identification numbers** | passport, national ID, tax, social security — see the distinction below |
| Medical information | including anything implied by a career break |
| Sensitive personal attributes | see the distinction below |
| Private conversation unrelated to career assistance | "I am tired today" is session-only |

### Two distinctions this list requires

The restricted list is right, and applying it naively would break immigration eligibility. Both cases
resolve the same way — **store the status, never the identifier; use it for eligibility, never for
scoring.**

**Identification numbers vs status.** Eligibility needs to know *that* someone holds a permit and when it
expires. It never needs the number.

| Store | Never store |
|---|---|
| "holds a work permit, expires 2027-03" | the permit number |
| "citizenship: PH" | the passport number |
| "degree recognized by <authority>, 2025" | the certificate serial |

**Nationality vs scoring feature.** Citizenship is *required* to evaluate a visa pathway — it is the first
input to almost every immigration rule. It is also a protected attribute that must never influence a
score.

So it is stored, isolated, and encrypted (`docs/database/entities/user.md` — `user_immigration_facts`),
and it is admissible **only** as an input to eligibility evaluation. It is never a feature in a match,
readiness, or ranking computation (`.claude/context/career-philosophy.md`). Any code path that reads
citizenship for a purpose other than a sourced immigration rule is a defect.

## User control

Users must be able to **view · update · delete · disable · export · reset** their memory. Natural-language
requests are honoured:

> "Forget my previous job preferences." · "Update my target role." · "Show my stored career profile."

A deletion request is a deletion, not a soft flag on something we keep using. Disabling memory degrades
personalization and must not break the product.

## Retention

| Layer | Retention |
|---|---|
| Long-term memory | until the user deletes it, or until it goes stale and is reconfirmed |
| Session memory | current conversation only, then discarded |

Stale ≠ deleted: expiry lowers confidence and prompts confirmation
(`ai-memory.md`, expiration table). Full schedule in
`docs/database/data-retention.md`.

## Conflict resolution

The spec's precedence is correct **for self-declared things** — goals, target roles, preferences, which
are true because the user says so:

1. Current user statement
2. User-confirmed profile
3. Latest stored memory
4. Historical memory

> Old: *wants Frontend Developer* → New: *wants AI Engineer* → **use AI Engineer.**

**It does not apply to evidence.** For skills and credentials, evidence outranks recency:

| Situation | Resolution |
|---|---|
| Claimed statement contradicts an assessment or certification | **evidence wins.** Ask, never silently overwrite |
| Newer claim, no evidence either side | newer wins |
| Certification expired | confidence drops, prompt to reconfirm — not deleted |
| User explicitly retracts a skill | honoured, and the prior evidence is retained as history |

Recency winning over evidence would let one sentence erase a verified certification, which is the
opposite of what "never overwrite verified information without confirmation" means
(`ai-memory.md`).

**Goals are mutable and evidence is durable.** That is the whole rule.

## Data quality

Every stored memory carries:

```json
{
  "value": "AWS Certified Solutions Architect – Associate",
  "source": "user_confirmed",
  "status": "evidenced",
  "confidence": "high",
  "created_at": "2026-07-28T09:14:02Z",
  "updated_at": "2026-07-28T09:14:02Z",
  "expires_at": "2029-07-28"
}
```

`confidence` is the enum `high | medium | low`, derived from source and completeness — never a model
probability and never an invented percentage (`.claude/context/ai-principles.md`).

## Security

Encrypted at rest, with immigration-related memory isolated in its own table and access path. Requires
authentication; authorized per subject on every read. **Never in a log, an error, a metric label, a trace,
an event payload, or a fixture.** Never shared, never used outside Zentavio, never trained on without
separate explicit consent (`docs/architecture/security.md`).

## Transparency

When memory influences an answer, it appears as a named evidence entry — not as invisible
personalization:

> Recommended because Germany is a stated target and your AWS certification is on file.

Personalization that cannot be explained is indistinguishable from a guess.

## Source of truth

These memory documents define intended behaviour. **If the implementation differs, one of the two is
wrong and gets fixed** — code brought into line, or the document corrected deliberately. Code that
contradicts its doc is broken (CLAUDE.md principle 5).

## Related

- `ai-memory.md` · `ai-session.md` · `memory-manager.md`
- `.claude/context/ai-principles.md` · `career-philosophy.md`
- `docs/architecture/privacy.md` · `security.md` · `docs/database/data-retention.md`
