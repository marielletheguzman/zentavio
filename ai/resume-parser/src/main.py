"""The résumé parser's HTTP surface (ADR-0003).

**Stateless.** No database handle, no cache, no session. The closed set of skills arrives *in the
request* rather than being read from anywhere, which is what keeps `ai/` free of a persistent store
and makes every response a pure function of its input. It also matches how the prompt layer works:
the caller supplies the closed set and the service may only return ids from it
(``docs/prompts/conventions.md``).

**The document never leaves this process and is never retained.** It is parsed and dropped — the
parsed profile is the asset, the file is a liability (``docs/features/resume-parsing.md``). Nothing
here writes the document, its filename, or any of its text to a log or an error message.

The error envelope is the one every Zentavio service returns
(``.claude/skills/backend-service/SKILL.md``): same shape, same code set, and ``retryable`` as part
of the contract rather than a hint.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from typing import Annotated, Literal

from compute import parse
from extract import SUPPORTED_CONTENT_TYPES, UnsupportedDocumentError, extract
from fastapi import Body, FastAPI, Request, status
from fastapi.responses import JSONResponse
from ports import RegisteredSkill
from pydantic import BaseModel, Field

#: Bumped whenever extraction, segmentation, or classification changes in a way that could move a
#: profile. Recorded on every parse so a stored profile says which code produced it — a profile
#: whose parser is unknown cannot be reproduced or re-examined after a bug.
PARSER_VERSION = "resume-parser/2026-08-01"

#: A cap here as well as at the gateway. The gateway is the right place to reject early, but a
#: service that trusts its caller's limits has no limit of its own.
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

app = FastAPI(
    title="Zentavio résumé parser",
    version=PARSER_VERSION,
    description="Turns a résumé into evidenced and claimed skills, each with its source text.",
)


class SkillInput(BaseModel):
    """One member of the closed set, supplied by the caller."""

    slug: str
    name: str
    kind: str
    #: Already normalized by the caller — `normalizeAlias` in `packages/db/src/seed.ts`.
    aliases: list[str] = Field(default_factory=list)


class ParseRequest(BaseModel):
    """A document plus the closed set to resolve it against.

    ``document`` is base64 because a résumé is binary. It is decoded, parsed, and discarded within
    this request — nothing persists it.
    """

    document_base64: str = Field(min_length=1)
    content_type: str
    skills: list[SkillInput] = Field(min_length=1)


class SkillOut(BaseModel):
    slug: str
    status: Literal["evidenced", "claimed"]
    evidence_kind: str | None
    source_span: str
    confidence: Literal["high", "medium", "low"]


class ParseResponse(BaseModel):
    status: Literal["ok", "partial", "unknown"]
    skills: list[SkillOut]
    reason: str | None
    degraded_sections: list[str]
    completeness: float | None
    parser_version: str


class _Registry:
    """Adapts the request's closed set to the `SkillRegistry` port."""

    def __init__(self, skills: list[SkillInput]) -> None:
        self._skills = tuple(
            RegisteredSkill(
                slug=s.slug,
                name=s.name,
                kind=s.kind,
                aliases=frozenset(s.aliases) | {s.name.lower()},
            )
            for s in skills
        )

    def all_skills(self) -> tuple[RegisteredSkill, ...]:
        return self._skills


def _error(
    code: str, message: str, http_status: int, *, retryable: bool, correlation_id: str
) -> JSONResponse:
    return JSONResponse(
        status_code=http_status,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": [],
                "correlationId": correlation_id,
                "retryable": retryable,
            }
        },
    )


@app.middleware("http")
async def unhandled_errors_never_leak(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Turn any unhandled exception into the shared envelope.

    A traceback reaching the client would be the single most likely way résumé content escapes this
    service — an exception raised deep in a parser can carry a fragment of the document in its
    message. This catches everything and returns a fixed string.
    """
    correlation_id = uuid.uuid4().hex
    try:
        return await call_next(request)
    except Exception:
        return _error(
            "INTERNAL",
            "The document could not be processed.",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            retryable=False,
            correlation_id=correlation_id,
        )


@app.post("/parse", response_model=ParseResponse)
def parse_resume(payload: Annotated[ParseRequest, Body()]) -> JSONResponse:
    """Parse one document against one closed set.

    Returns 200 for every *parse* outcome, including ``unknown``. A résumé we could not read is not
    an HTTP error — it is a result the user must be shown, with the reason. Reserving 4xx for
    "the caller sent something wrong" keeps the two genuinely different failures distinguishable.
    """
    correlation_id = uuid.uuid4().hex

    if payload.content_type not in SUPPORTED_CONTENT_TYPES:
        return _error(
            "VALIDATION_FAILED",
            f"Unsupported content type: {payload.content_type}. "
            "Upload a PDF, a DOCX, or plain text.",
            status.HTTP_400_BAD_REQUEST,
            retryable=False,
            correlation_id=correlation_id,
        )

    try:
        content = base64.b64decode(payload.document_base64, validate=True)
    except (binascii.Error, ValueError):
        return _error(
            "VALIDATION_FAILED",
            "The document could not be decoded.",
            status.HTTP_400_BAD_REQUEST,
            retryable=False,
            correlation_id=correlation_id,
        )

    if len(content) > MAX_DOCUMENT_BYTES:
        return _error(
            "VALIDATION_FAILED",
            f"The document is larger than {MAX_DOCUMENT_BYTES // (1024 * 1024)} MB.",
            status.HTTP_400_BAD_REQUEST,
            retryable=False,
            correlation_id=correlation_id,
        )

    try:
        extracted = extract(content, payload.content_type)
    except UnsupportedDocumentError:
        return _error(
            "VALIDATION_FAILED",
            f"Unsupported content type: {payload.content_type}.",
            status.HTTP_400_BAD_REQUEST,
            retryable=False,
            correlation_id=correlation_id,
        )

    result = parse(extracted, _Registry(payload.skills))

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content=ParseResponse(
            status=result.status,
            skills=[
                SkillOut(
                    slug=f.slug,
                    status=f.status,  # type: ignore[arg-type]
                    evidence_kind=f.evidence_kind,
                    source_span=f.source_span,
                    confidence=f.confidence,  # type: ignore[arg-type]
                )
                for f in result.skills
            ],
            reason=result.reason,
            degraded_sections=list(result.degraded_sections),
            completeness=result.completeness,
            parser_version=PARSER_VERSION,
        ).model_dump(),
    )


@app.get("/health/live")
def live() -> dict[str, str]:
    """The process is up. Nothing else is claimed."""
    return {"status": "live", "version": PARSER_VERSION}


@app.get("/health/ready")
def ready() -> dict[str, str]:
    """Ready to serve.

    This service has **no** external dependency — no database, no cache, no model call — so
    readiness is genuinely just "the code imported". A probe that checks something it does not use
    would be theatre, and a probe that reports healthy while a real dependency is down is worse
    (``docs/development/ai-service-guide.md``).
    """
    return {"status": "ready", "version": PARSER_VERSION}
