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
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from career_roadmap.eligibility import (
    DISCLAIMER,
    PersonFact,
    Requirement,
    Verdict,
    evaluate_pathway,
)
from career_roadmap.viability import AsOfMismatchError, Employability, compose

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
    #: Carried through from the stored row. Only `route` is read (ADR-0024); the rest is the
    #: caller's business.
    applies_to: dict[str, Any] = Field(default_factory=dict)


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
    #: The jurisdiction this pathway leads to, used only to place rules an origin state scopes by
    #: destination (ADR-0029). A property of the pathway, never compared against anything the person
    #: said. Absent means a destination-scoped rule cannot be placed and stays `undetermined`.
    destination: str | None = None


class EvaluatedRequirementOutput(BaseModel):
    requirement_id: str
    domain: str
    imposed_by: str
    #: `not_applicable` is a rule on a route this person cannot use. **A surface must never render
    #: it as a failure** — they were never on that route (ADR-0024).
    result: Literal["met", "not_met", "undetermined", "not_applicable"]
    authority: str
    source_url: str
    effective_from: str
    basis: str | None = None
    reason: str | None = None
    needs_input: list[str] = Field(default_factory=list)


class RouteOutcomeOutput(BaseModel):
    """One way into the pathway, reported whether or not it is the one that applies."""

    route: str
    status: Literal["met", "not_met", "undetermined", "not_applicable"]
    blockers: list[str]
    needs_from_user: list[str]
    requirement_ids: list[str]
    reason: str | None = None


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
    #: The route this verdict is about, or null for a pathway whose rules declare none.
    route: str | None = None
    #: Every route. Empty for a pathway with no routes, which is how every pathway starts.
    routes: list[RouteOutcomeOutput] = Field(default_factory=list)


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
        route=verdict.route,
        routes=[
            RouteOutcomeOutput(
                route=o.route,
                status=o.status,
                blockers=list(o.blockers),
                needs_from_user=list(o.needs_from_user),
                requirement_ids=list(o.requirement_ids),
                reason=o.reason,
            )
            for o in verdict.routes
        ],
    )


def _evaluate(payload: EvaluateRequest) -> Verdict:
    """Shared by both routes, so viability cannot drift from what `/evaluate` returns."""
    return evaluate_pathway(
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
                applies_to=r.applies_to,
            )
            for r in payload.requirements
        ],
        [PersonFact(key=f.key, value=f.value, basis=f.basis) for f in payload.facts],
        payload.as_of,
        licence_gated=payload.licence_gated,
        destination=payload.destination,
    )


@app.post("/evaluate", response_model=EvaluateResponse)
def evaluate(payload: Annotated[EvaluateRequest, Body()]) -> EvaluateResponse:
    """Evaluate a pathway. Always a 200 — every eligibility outcome is an answer."""
    return _to_response(_evaluate(payload))


class EmployabilityInput(BaseModel):
    """The readiness half, supplied by the caller.

    This service does not call `ai/skill-gap`: the gateway computes both halves and hands them
    over, which is what keeps `ai/` stateless and stops two workspace members depending on each
    other.
    """

    status: Literal["ok", "no_gap", "unknown"]
    #: The band, never a midpoint — its width is how much rests on assertion.
    score_low: float | None = None
    score_high: float | None = None
    missing_count: int = 0
    reason: str | None = None
    #: Must equal the eligibility `as_of`. A pair describing two moments is not a verdict.
    as_of: date


class ViabilityRequest(EvaluateRequest):
    employability: EmployabilityInput


class ViabilityResponse(BaseModel):
    """Two axes and the one that binds. **Deliberately has no score field** (ADR-0022)."""

    pathway_id: str | None
    eligibility: EvaluateResponse
    employability: EmployabilityInput
    binding: Literal["eligibility", "employability", "recognition", "unmodelled", "none"]
    binding_reason: str
    as_of: str
    disclaimer: str
    evaluator_version: str


@app.post("/viability", response_model=ViabilityResponse)
def viability(payload: Annotated[ViabilityRequest, Body()]) -> ViabilityResponse:
    """Eligibility and employability, with the binding constraint named.

    A 422 when the two halves describe different dates — that is a caller mistake, not an
    eligibility outcome, and answering it would produce a verdict about no particular moment.
    """
    verdict = _evaluate(payload)

    try:
        paired = compose(
            verdict,
            Employability(
                status=payload.employability.status,
                score_low=payload.employability.score_low,
                score_high=payload.employability.score_high,
                missing_count=payload.employability.missing_count,
                reason=payload.employability.reason,
            ),
            employability_as_of=payload.employability.as_of.isoformat(),
        )
    except AsOfMismatchError as mismatch:
        raise RequestValidationError(
            [
                {
                    "loc": ("body", "employability", "as_of"),
                    "msg": str(mismatch),
                    "type": "value_error",
                }
            ]
        ) from mismatch

    return ViabilityResponse(
        pathway_id=paired.pathway_id,
        eligibility=_to_response(verdict),
        employability=payload.employability,
        binding=paired.binding,
        binding_reason=paired.binding_reason,
        as_of=paired.as_of,
        disclaimer=paired.disclaimer,
        evaluator_version=EVALUATOR_VERSION,
    )


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
