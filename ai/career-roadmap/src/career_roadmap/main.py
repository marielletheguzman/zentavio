"""The eligibility evaluator's HTTP surface (ADR-0003).

**Stateless.** The requirements, the person's facts and the evaluation date all arrive in the
request rather than being read from anywhere. The gateway owns the database; this service owns the
reasoning. That is what keeps `ai/` free of a persistent store, and it makes determinism observable
from outside — the same request body produces the same response body.

**No model call anywhere in this service.** Eligibility is comparison over supplied rows
(`docs/architecture/immigration.md`). An LLM may summarise a retrieved rule for display; it may
never decide one.

**Every eligibility outcome is a 200, including `unknown`.** A pathway nobody has modelled, and a
licence-gated profession with no recognition rule, are both results the user must be shown with
their reason. `4xx` stays reserved for "the caller sent something wrong", so a broken request and an
honest non-answer remain distinguishable.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import Body, FastAPI, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from career_roadmap.eligibility import (
    DISCLAIMER,
    PersonFact,
    Requirement,
    Verdict,
    evaluate_pathway,
)

#: Bumped when the evaluator's output changes for the same input. A stored verdict records this, so
#: "why did this answer change?" is answerable without guessing.
EVALUATOR_VERSION = "1.0.0"

app = FastAPI(
    title="Zentavio eligibility",
    version=EVALUATOR_VERSION,
    description="Evaluate stored requirements against a person's facts. Deterministic, no model.",
)


class RequirementInput(BaseModel):
    requirement_id: str
    domain: str
    imposed_by: str
    kind: str
    evaluation: str
    value: Any
    needs_input: list[str] = Field(default_factory=list)
    authority: str
    source_url: str
    effective_from: date
    #: Null for an open-ended rule. Not a signal of currency — applicability is date containment.
    effective_to: date | None = None
    refresh_after: date | None = None
    contested: bool = False
    contested_note: str | None = None


class PersonFactInput(BaseModel):
    key: str
    value: Any
    basis: Literal["self_reported", "derived", "verified"] = "self_reported"


class EvaluateRequest(BaseModel):
    pathway_id: str | None = None
    requirements: list[RequirementInput] = Field(default_factory=list)
    facts: list[PersonFactInput] = Field(default_factory=list)
    #: The date the answer is *as of*. Supplied rather than read from a clock, so a verdict given
    #: last year stays reproducible — `asOf` is part of every response.
    as_of: date
    #: True when the target profession is licence-gated, which forces `unknown` unless a
    #: recognition rule is on file.
    licence_gated: bool = False


class EvaluatedRequirementOutput(BaseModel):
    requirement_id: str
    domain: str
    imposed_by: str
    result: Literal["met", "not_met", "undetermined"]
    authority: str
    source_url: str
    effective_from: str
    basis: str | None = None
    reason: str | None = None
    needs_input: list[str] = Field(default_factory=list)


class EvaluateResponse(BaseModel):
    pathway_id: str | None
    status: Literal["met", "not_met", "undetermined", "unknown"]
    requirements: list[EvaluatedRequirementOutput]
    blockers: list[str]
    needs_from_user: list[str]
    binding_domain: str | None
    confidence: str
    as_of: str
    disclaimer: str
    notes: list[str]
    evaluator_version: str


def _error(code: str, message: str, http_status: int) -> JSONResponse:
    return JSONResponse(status_code=http_status, content={"code": code, "message": message})


@app.middleware("http")
async def unhandled_errors_never_leak(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Turn an unhandled exception into a correlation id, never a stack trace.

    A requirement's evaluation touches a person's salary. A traceback in a response body is a
    privacy incident as well as a bug (`docs/architecture/privacy.md`).
    """
    try:
        return await call_next(request)
    except Exception:
        incident = str(uuid.uuid4())
        return _error(
            "INTERNAL_ERROR",
            f"The request could not be completed. Reference: {incident}",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


def _to_response(verdict: Verdict) -> EvaluateResponse:
    return EvaluateResponse(
        pathway_id=verdict.pathway_id,
        status=verdict.status,
        requirements=[
            EvaluatedRequirementOutput(
                requirement_id=r.requirement_id,
                domain=r.domain,
                imposed_by=r.imposed_by,
                result=r.result,
                authority=r.authority,
                source_url=r.source_url,
                effective_from=r.effective_from,
                basis=r.basis,
                reason=r.reason,
                needs_input=list(r.needs_input),
            )
            for r in verdict.requirements
        ],
        blockers=list(verdict.blockers),
        needs_from_user=list(verdict.needs_from_user),
        binding_domain=verdict.binding_domain,
        confidence=verdict.confidence,
        as_of=verdict.as_of,
        disclaimer=verdict.disclaimer,
        notes=list(verdict.notes),
        evaluator_version=EVALUATOR_VERSION,
    )


@app.post("/evaluate", response_model=EvaluateResponse)
def evaluate(payload: Annotated[EvaluateRequest, Body()]) -> EvaluateResponse:
    """Evaluate a pathway. Always a 200 — every eligibility outcome is an answer."""
    verdict = evaluate_pathway(
        payload.pathway_id,
        [
            Requirement(
                requirement_id=r.requirement_id,
                domain=r.domain,
                imposed_by=r.imposed_by,
                kind=r.kind,
                evaluation=r.evaluation,
                value=r.value,
                needs_input=tuple(r.needs_input),
                authority=r.authority,
                source_url=r.source_url,
                effective_from=r.effective_from,
                effective_to=r.effective_to,
                refresh_after=r.refresh_after,
                contested=r.contested,
                contested_note=r.contested_note,
            )
            for r in payload.requirements
        ],
        [PersonFact(key=f.key, value=f.value, basis=f.basis) for f in payload.facts],
        payload.as_of,
        licence_gated=payload.licence_gated,
    )
    return _to_response(verdict)


@app.get("/health/live")
def live() -> dict[str, str]:
    """The process is up. Deliberately not a readiness signal."""
    return {"status": "ok"}


@app.get("/health/ready")
def ready() -> dict[str, str]:
    """Ready to serve.

    This service has no dependencies — no database, no model host, no other service — so readiness
    and liveness genuinely coincide. Saying so is more useful than an endpoint that checks nothing
    and implies it checked something.
    """
    return {"status": "ok", "dependencies": "none", "disclaimer": DISCLAIMER}
