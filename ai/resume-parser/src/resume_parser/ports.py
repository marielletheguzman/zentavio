"""What the résumé parser needs from the outside world.

Three ports, and the reason each exists is the same: the thing behind it is either a stack decision
that has not been made (`TextExtractor`, ADR-0016), a dependency the AI layer must not own
(`SkillRegistry` — state lives in `packages/db`, never here), or a model call that must stay
replaceable (ADR-0003).

Nothing in this package imports a document library, a database driver, or an HTTP client directly.
That is what makes the pipeline testable without any of them, and it is checkable: a bare
``import pypdf`` outside an extractor implementation means a port was bypassed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ExtractedText:
    """The result of turning an uploaded file into text.

    ``degraded_sections`` is not decoration. Real résumés are two-column layouts and tables, and an
    extractor that silently returns interleaved lines produces a profile that looks complete and is
    wrong. Naming what came out badly is what makes the ``partial`` state reportable rather than a
    guess (``docs/features/resume-parsing.md``).
    """

    text: str
    #: Human-readable labels for regions the extractor believes it read badly.
    degraded_sections: tuple[str, ...] = ()
    #: Set when the document contains no extractable text at all — an image-only PDF, typically.
    #: Distinct from an empty string, which could also mean a genuinely blank document.
    image_only: bool = False


class TextExtractor(Protocol):
    """Turns uploaded bytes into text.

    The implementation is a stack decision (ADR-0016) that is still Proposed. This protocol
    exists so everything downstream of extraction can be built and tested before that decision
    lands, and so swapping `pypdf` for `pdfplumber` later touches one file.
    """

    def extract(self, content: bytes, content_type: str) -> ExtractedText: ...


@dataclass(frozen=True)
class RegisteredSkill:
    """One member of the closed set the parser resolves against.

    ``aliases`` are already normalized by the same function the parser applies to candidate phrases.
    If those two normalizations ever disagree, resolution misses silently and the phrase lands in
    ``unmatched`` — which reads as a coverage gap rather than the bug it is.
    """

    slug: str
    name: str
    kind: str
    aliases: frozenset[str]


class SkillRegistry(Protocol):
    """The closed set of skills, supplied from outside.

    The AI layer owns no persistent store (ADR-0003), so this is read through a port rather than a
    database handle. The parser may only ever return slugs that came from here — an unrecognized
    phrase stays unrecognized and becomes the coverage backlog for the skill graph.
    """

    def all_skills(self) -> tuple[RegisteredSkill, ...]: ...


class ModelClient(Protocol):
    """A model that turns a rendered prompt into parsed JSON.

    Behind a port because ADR-0003 requires the model to stay replaceable and because nothing
    outside the adapter may import an HTTP client. It also makes every enrichment path testable
    with a fake — including the paths that matter most, where the model is unreachable or answers
    with something that is not the agreed shape.

    ``complete`` returns ``None`` rather than raising when the call fails or the response does not
    parse. A model that is down is an expected condition here, not an exception: the parse still
    succeeds deterministically and says so (ADR-0018).
    """

    #: What the model reports itself as, recorded on the response so a result is attributable.
    name: str

    def available(self) -> bool: ...

    def complete(self, prompt: str) -> dict | None: ...
