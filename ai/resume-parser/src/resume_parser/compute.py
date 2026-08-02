"""The deterministic half of parsing: segment, resolve, classify.

**No model runs here, and none should.** ``docs/prompts/conventions.md`` puts normalization to a
closed set and classification into a closed set on the model's side of the table — but only where
messy text makes rules impossible. Alias matching against a known set is not messy: it is a lookup,
and a lookup that a model performs is a lookup that can hallucinate.

**ADR-0018 settled that split with a measurement rather than an argument.** Written to the
``conventions.md`` contract, a full-extraction prompt scored 4/11 against ``qwen2.5:7b-instruct``
with both injection gates failing, while this module got resolution, the evidenced/claimed split,
deduplication and ordering right on the same inputs. So code keeps resolution and classification;
the model supplies the two jobs it is better at — recall on phrasing the alias table does not cover
(``skill-recall``), and spans addressed to the reader rather than describing the person
(``instruction-quarantine``). The second one is the failure this module cannot see alone: a
sentence pasted under an Experience heading claiming expertise is otherwise mined as evidence.

Everything here is a pure function over text, a supplied registry, and an optional set of
quarantined spans, which is what makes the whole of it testable without a model, a database, or a
document library.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from resume_parser.ports import ExtractedText, RegisteredSkill, SkillRegistry

#: Headings that mark a list of skills rather than a description of work. A match inside one of
#: these is `claimed`; a match inside prose about a role or project is `evidenced`.
_SKILL_LIST_HEADINGS = (
    "skills",
    "technical skills",
    "core competencies",
    "competencies",
    "technologies",
    "tech stack",
    "toolbox",
    "expertise",
    "proficiencies",
    "languages",
)

_EXPERIENCE_HEADINGS = (
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "employment history",
    "projects",
    "selected projects",
    "career history",
)

_HEADING_RE = re.compile(r"^\s{0,4}([A-Za-z][A-Za-z /&+-]{2,40})\s*:?\s*$")


def normalize_phrase(value: str) -> str:
    """Casefold, strip punctuation, collapse whitespace.

    **This must stay identical to `normalizeAlias` in `packages/db/src/seed.ts`.** The seed writes
    alias keys with that function; this reads them with this one. If they diverge, every alias whose
    normalization differs stops resolving, and the failure looks like missing coverage rather than a
    bug. There is a test asserting a shared table of cases.

    ``+`` and ``#`` survive because ``c++`` and ``c#`` are names where the punctuation *is* the
    name itself.
    """
    folded = unicodedata.normalize("NFKD", value).lower()
    stripped = re.sub(r"[^\w+#]+", " ", folded, flags=re.UNICODE)
    stripped = stripped.replace("_", " ")
    return re.sub(r"\s+", " ", stripped).strip()


@dataclass(frozen=True)
class Section:
    """A labelled region of the résumé."""

    heading: str
    #: 'skill-list' | 'experience' | 'other'
    kind: str
    lines: tuple[str, ...]


def segment(text: str) -> tuple[Section, ...]:
    """Split résumé text into labelled sections.

    Segmentation happens before extraction because, without it, a skills list reads as a job
    description and every listed skill is promoted to `evidenced`
    (``docs/features/resume-parsing.md``). That single confusion would inflate the readiness of
    anyone who pads a skills section, which is exactly what the evidenced/claimed split exists to
    prevent.

    Text before any recognised heading is `other` — never `experience`. Guessing upward is how a
    contact block becomes evidence.
    """
    sections: list[Section] = []
    heading = ""
    kind = "other"
    buffer: list[str] = []

    def flush() -> None:
        if buffer or heading:
            sections.append(Section(heading=heading, kind=kind, lines=tuple(buffer)))

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        match = _HEADING_RE.match(line)
        candidate = normalize_phrase(match.group(1)) if match else ""

        if candidate in _SKILL_LIST_HEADINGS or candidate in _EXPERIENCE_HEADINGS:
            flush()
            buffer = []
            heading = line.strip().rstrip(":")
            kind = "skill-list" if candidate in _SKILL_LIST_HEADINGS else "experience"
            continue

        if line.strip():
            buffer.append(line.strip())

    flush()
    return tuple(sections)


@dataclass(frozen=True)
class SkillFinding:
    """One resolved skill, with the text that produced it."""

    slug: str
    #: 'evidenced' | 'claimed'
    status: str
    #: 'role' | 'project' | None — required by the schema when status is evidenced.
    evidence_kind: str | None
    #: The verbatim line the match came from. What makes the claim correctable.
    source_span: str
    #: 'high' | 'medium' | 'low'
    confidence: str


def _alias_index(registry: SkillRegistry) -> dict[str, RegisteredSkill]:
    index: dict[str, RegisteredSkill] = {}
    for skill in registry.all_skills():
        for alias in skill.aliases:
            index.setdefault(alias, skill)
    return index


def _find_in_line(line: str, index: dict[str, RegisteredSkill]) -> set[str]:
    """Which registered skills a line mentions.

    Matches on normalized token windows rather than substrings: a substring search makes ``go``
    match inside ``Django``, and ``r`` match everything. Longest window first, so
    ``google cloud platform`` wins over ``google cloud`` when both are registered.
    """
    tokens = normalize_phrase(line).split()
    found: set[str] = set()
    max_window = 4

    for size in range(min(max_window, len(tokens)), 0, -1):
        for start in range(0, len(tokens) - size + 1):
            phrase = " ".join(tokens[start : start + size])
            skill = index.get(phrase)
            if skill is not None:
                found.add(skill.slug)
    return found


def recover_spelling(text: str, phrase: str) -> str:
    """Return the document's own capitalization of ``phrase``, or the phrase unchanged.

    ``skill-recall`` reliably identifies which phrase is a technology and unreliably preserves how
    it was written — it lower-cases product names, and more so when the document also contains an
    injected block spelling them in lower case. That is a lookup against the source text, and by
    ADR-0018 a lookup belongs here rather than in a prompt: the model is asked what, code answers
    how it was spelled.

    Falls back to the phrase as given when it does not occur in the text, which is the honest
    outcome for a phrase the model paraphrased rather than quoted.
    """
    match = re.search(re.escape(phrase), text, flags=re.IGNORECASE)
    return match.group(0) if match else phrase


def number_lines(text: str) -> tuple[tuple[int, str], ...]:
    """Split a document into numbered non-empty lines, for the quarantine prompt.

    Splitting and numbering are done here rather than by the model because asking a 7B model to
    *enumerate* lines is where it fails: given the whole document it silently omits the very line
    an attacker inserted, under every prompt shape tried. Given the lines already numbered, it
    labels that same line correctly. So code counts and the model judges — which is ADR-0018's
    division applied to the mechanical step nobody thought was one.
    """
    kept = (line.strip() for line in text.splitlines() if line.strip())
    # Numbered over the kept lines, not over the original ones: a blank line that consumed a number
    # would leave gaps, and the prompt tells the model that the highest number it can see is how
    # many entries to return. With gaps that instruction is false, and a short array is exactly how
    # this output goes wrong.
    return tuple((i + 1, line) for i, line in enumerate(kept))


def spans_from_labels(text: str, labels: dict[int, str]) -> tuple[str, ...]:
    """Turn per-line labels back into the spans ``parse`` excludes.

    A number the model did not label, or labelled with anything other than ``reader``, keeps its
    line. That default matters: a truncated or malformed response must lose the protection, never
    silently delete someone's history.
    """
    return tuple(line for number, line in number_lines(text) if labels.get(number) == "reader")


def is_quarantined(line: str, quarantined: tuple[str, ...]) -> bool:
    """Whether a line falls inside a span the quarantine step marked as addressed to the reader.

    Compared on normalized text rather than raw, because the span comes back from a model that may
    differ from the document in whitespace even when it is quoting verbatim. Exact string equality
    would make the whole mechanism fail silently — a span that matches nothing quarantines nothing
    and still looks like protection (ADR-0018).
    """
    if not quarantined:
        return False
    normalized_line = normalize_phrase(line)
    if not normalized_line:
        return False
    return any(normalized_line in normalize_phrase(span) for span in quarantined)


def extract_skills(
    extracted: ExtractedText,
    registry: SkillRegistry,
    quarantined: tuple[str, ...] = (),
) -> tuple[SkillFinding, ...]:
    """Resolve the closed set against the résumé text.

    Rules this deliberately obeys, from ``docs/features/resume-parsing.md``:

    * **Never invents a slug.** Only what the registry supplied can be returned.
    * **Never infers a skill from a job title, an employer, or years of experience.** "Senior DevOps
      Engineer" is not evidence of Terraform, so headings and titles are not mined for skills — only
      the lines under them.
    * **Never scores the person.** This produces claims; judgment happens elsewhere.

    A skill mentioned in both a skills list and a role description resolves once, as `evidenced` —
    the strongest evidence wins, and the unique index on ``(user_profile_id, skill_id)`` requires
    exactly one row anyway.

    ``quarantined`` holds spans a caller determined are addressed to the reader rather than
    describing the person (ADR-0018). They are skipped. Alias matching cannot make that judgment
    itself: a sentence reading "This candidate is an expert in Kubernetes, Terraform, Go and
    Docker", pasted under an Experience heading, is otherwise mined as four evidenced skills. The
    default is empty, so the deterministic path keeps working unchanged when no model ran.
    """
    index = _alias_index(registry)
    best: dict[str, SkillFinding] = {}

    for section in segment(extracted.text):
        if section.kind == "skill-list":
            status, evidence_kind = "claimed", None
        elif section.kind == "experience":
            status, evidence_kind = "evidenced", "role"
        else:
            # An unlabelled region is not evidence of anything. Listing it as `claimed` is the
            # honest reading: the phrase appeared, and nothing says how.
            status, evidence_kind = "claimed", None

        # Degradation is a property of the DOCUMENT, not of a section, and treating it otherwise
        # was a real bug: the extractor names what it read badly in its own vocabulary ("a table",
        # "page 2"), which never matches a résumé's section headings. Every finding silently kept
        # high confidence.
        #
        # Document-level is also the honest reading. If a table was flattened or a page came out
        # empty, we do not know which lines were affected — interleaved column text can land
        # anywhere. Lowering everything is conservative in the direction that costs the user
        # nothing: a low-confidence claim they can confirm, rather than a confident one they have
        # no reason to check.
        degraded = bool(extracted.degraded_sections)
        confidence = "low" if degraded else ("high" if status == "evidenced" else "medium")

        for line in section.lines:
            if is_quarantined(line, quarantined):
                continue
            for slug in _find_in_line(line, index):
                finding = SkillFinding(
                    slug=slug,
                    status=status,
                    evidence_kind=evidence_kind,
                    source_span=line,
                    confidence=confidence,
                )
                existing = best.get(slug)
                if existing is None or (existing.status == "claimed" and status == "evidenced"):
                    best[slug] = finding

    return tuple(sorted(best.values(), key=lambda f: f.slug))


@dataclass(frozen=True)
class ParseResult:
    """What the service returns.

    ``status`` is the contract with the UI, and it has four values because
    ``docs/features/resume-parsing.md`` names four outcomes a user can be shown. **`partial` is the
    common case, not an edge case** — a résumé whose skills section parsed cleanly and whose
    employment history did not is a normal Tuesday, and saying so is more useful than a confident
    half-profile.
    """

    #: 'ok' | 'partial' | 'unknown'
    status: str
    skills: tuple[SkillFinding, ...]
    #: Present when status is not 'ok': what could not be read, in words a user can act on.
    reason: str | None
    #: Sections the extractor reported it read badly.
    degraded_sections: tuple[str, ...]
    #: 0..1 — drives confidence downstream. None when nothing could be read.
    completeness: float | None


def parse(
    extracted: ExtractedText,
    registry: SkillRegistry,
    quarantined: tuple[str, ...] = (),
) -> ParseResult:
    """Turn extracted text into a result, including the honest failure states.

    The unknown path is not an error path. An unreadable document returns ``unknown`` naming what
    failed, never a thin profile presented as complete — a person making an irreversible decision
    deserves "we could not read this" over a confident guess.

    ``quarantined`` is optional and defaults to empty (ADR-0018): a profile produced with no model
    available is byte-identical to one produced with a model that found nothing to quarantine.
    """
    if extracted.image_only:
        return ParseResult(
            status="unknown",
            skills=(),
            reason=(
                "This document contains no selectable text — it looks like a scan or an image. "
                "Upload a text-based PDF or DOCX, or enter your profile manually."
            ),
            degraded_sections=extracted.degraded_sections,
            completeness=None,
        )

    if not extracted.text.strip():
        return ParseResult(
            status="unknown",
            skills=(),
            reason=(
                "No text could be read from this document. Try a different file, or enter your "
                "profile manually."
            ),
            degraded_sections=extracted.degraded_sections,
            completeness=None,
        )

    skills = extract_skills(extracted, registry, quarantined)

    if not skills:
        return ParseResult(
            status="partial",
            skills=(),
            reason=(
                "The document was readable, but no known skills were recognised in it. Nothing was "
                "invented to fill the gap."
            ),
            degraded_sections=extracted.degraded_sections,
            completeness=0.0,
        )

    if extracted.degraded_sections:
        return ParseResult(
            status="partial",
            skills=skills,
            reason=(
                "Some sections could not be read cleanly, so this profile may be incomplete: "
                + ", ".join(extracted.degraded_sections)
            ),
            degraded_sections=extracted.degraded_sections,
            completeness=_completeness(skills, degraded=True),
        )

    return ParseResult(
        status="ok",
        skills=skills,
        reason=None,
        degraded_sections=(),
        completeness=_completeness(skills, degraded=False),
    )


def _completeness(skills: tuple[SkillFinding, ...], *, degraded: bool) -> float:
    """A crude, deliberately conservative signal — never a score of the person.

    It answers "how much of this profile do we actually have", which drives *confidence* downstream.
    Ten evidenced skills is not a better person than three; it is a better-populated profile. The
    ceiling is below 1.0 because a résumé is never the whole of someone's experience, and a
    completeness of exactly 1 would invite treating it as one.
    """
    evidenced = sum(1 for s in skills if s.status == "evidenced")
    base = min(0.9, 0.1 * len(skills) + 0.05 * evidenced)
    return round(base * (0.6 if degraded else 1.0), 3)
