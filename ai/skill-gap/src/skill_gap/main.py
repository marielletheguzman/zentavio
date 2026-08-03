"""The gap's HTTP surface (ADR-0003).

**Stateless.** The requirements, the profile and the graph all arrive in the request rather than
being read from anywhere, exactly as the closed set does for the résumé parser. That is what keeps
`ai/` free of a persistent store, and it is also what makes the determinism M1b requires observable
from outside: the same request body produces the same response body.

**No model call anywhere in this service.** The gap is arithmetic over supplied facts
(`docs/features/skill-gap-analysis.md`). The prose that explains a gap is a separate prompt in a
separate file, and it reads the computed result rather than producing it.

Every *gap* outcome is a 200, including `unknown`. A target nobody has modelled is a result the user
must be shown, with the reason. `4xx` stays reserved for "the caller sent something wrong", so the
two genuinely different failures remain distinguishable.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import Body, FastAPI, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from skill_gap.compute import SCORER_VERSION, compute_gap
from skill_gap.ports import Edge, GapRequest, HeldSkill, RequiredSkill
from skill_gap.readiness import compute_readiness

app = FastAPI(
    title="Zentavio skill gap",
    version=SCORER_VERSION,
    description="Compare a profile against a target's requirements and return an ordered gap.",
)


class RequirementInput(BaseModel):
    skill_id: str
    #: None when the requirement is known but its importance is not. Never defaulted here — a
    #: default weight is an invented market fact.
    weight: float | None = Field(default=None, ge=0, le=1)
    cluster: Literal["core", "supporting", "differentiating", "peripheral"]
    market_scope: str | None = Field(default=None, min_length=2, max_length=2)
    basis: str = "curated"
    support: int | None = None


class HeldInput(BaseModel):
    skill_id: str
    status: Literal["evidenced", "claimed"]
    confidence: Literal["high", "medium", "low"] = "medium"


class EdgeInput(BaseModel):
    from_skill_id: str
    to_skill_id: str
    edge_type: Literal["requires", "adjacent_to", "transfers_to", "subsumes", "tooling_of"]
    weight: float = Field(ge=0, le=1)
    source_url: str | None = None
    source_tier: int = Field(default=3, ge=1, le=4)


class GapRequestBody(BaseModel):
    target_id: str = Field(min_length=1)
    target_kind: Literal["career"]
    requirements: list[RequirementInput] = Field(default_factory=list)
    held: list[HeldInput] = Field(default_factory=list)
    edges: list[EdgeInput] = Field(default_factory=list)
    market: str | None = Field(default=None, min_length=2, max_length=2)
    knowledge_as_of: str | None = None
    unresolved: list[str] = Field(default_factory=list)


class GapItemOut(BaseModel):
    skill_id: str
    weight: float | None
    cluster: str
    position: int
    partial: float | None
    partial_from: str | None
    prerequisites: list[str]
    basis: str
    support: int | None


class HeldOut(BaseModel):
    skill_id: str
    status: str


class ReadinessTermOut(BaseModel):
    """One requirement's contribution, and why it contributed that much."""

    skill_id: str
    weight: float
    credit: float
    basis: Literal["evidenced", "claimed", "subsumed", "transferred", "missing"]
    source: str | None
    contribution: float


class RemainingOut(BaseModel):
    skill_id: str
    weight: float
    partial: float | None
    partial_from: str | None
    cluster: str
    position: int
    typical_time_to_competence: str | None


class ClusterScoreOut(BaseModel):
    cluster: str
    score: float
    weight_share: float
    requirement_count: int


class ReadinessOut(BaseModel):
    """A verdict, a remainder, and a cost — never a bare score."""

    status: Literal["ok", "unknown"]
    score: float | None
    #: The floor and the ceiling. The distance between them is how much of the number rests on
    #: assertion rather than evidence, which one figure cannot say.
    score_low: float | None
    score_high: float | None
    by_cluster: list[ClusterScoreOut]
    confidence: Literal["high", "medium", "low"]
    remaining: list[RemainingOut]
    #: Every term of the sum, so the arithmetic can be checked by hand rather than trusted.
    terms: list[ReadinessTermOut]
    estimated_time_to_ready: str | None
    time_to_ready_basis: str
    binding_constraint: str | None
    missing: list[str]
    reason: str | None
    scorer_version: str


class GapResponse(BaseModel):
    status: Literal["ok", "no_gap", "unknown"]
    target_id: str
    target_kind: str
    items: list[GapItemOut]
    held: list[HeldOut]
    confidence: Literal["high", "medium", "low"]
    missing: list[str]
    unweighted: list[str]
    reason: str | None
    scorer_version: str
    knowledge_as_of: str | None
    #: Computed in the same call from the same inputs, deliberately. Two endpoints could disagree
    #: about `knowledge_as_of` — a score and a gap describing different moments, both looking
    #: correct on one screen.
    readiness: ReadinessOut


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

    Less sensitive than the parser's equivalent — there is no document here — but a profile's skill
    list is still personal, and a traceback is the most likely way a fragment of it escapes.
    """
    correlation_id = uuid.uuid4().hex
    try:
        return await call_next(request)
    except Exception:
        return _error(
            "INTERNAL",
            "The gap could not be computed.",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            retryable=False,
            correlation_id=correlation_id,
        )


@app.post("/gap", response_model=GapResponse)
def gap(payload: Annotated[GapRequestBody, Body()]) -> JSONResponse:
    """Compute one gap.

    Returns 200 for every gap outcome, `unknown` included. A person deciding what to spend six
    months learning deserves "we have not modelled this track" over a plausible-looking empty list,
    and neither is an HTTP error.
    """
    gap_request = GapRequest(
        target_id=payload.target_id,
        target_kind=payload.target_kind,
        requirements=tuple(
            RequiredSkill(
                skill_id=r.skill_id,
                weight=r.weight,
                cluster=r.cluster,
                market_scope=r.market_scope,
                basis=r.basis,
                support=r.support,
            )
            for r in payload.requirements
        ),
        held=tuple(
            HeldSkill(skill_id=h.skill_id, status=h.status, confidence=h.confidence)
            for h in payload.held
        ),
        edges=tuple(
            Edge(
                from_skill_id=e.from_skill_id,
                to_skill_id=e.to_skill_id,
                edge_type=e.edge_type,
                weight=e.weight,
                source_url=e.source_url,
                source_tier=e.source_tier,
            )
            for e in payload.edges
        ),
        market=payload.market,
        knowledge_as_of=payload.knowledge_as_of,
        unresolved=tuple(payload.unresolved),
    )

    result = compute_gap(gap_request)
    readiness = compute_readiness(gap_request, result.items)

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content=GapResponse(
            status=result.status,  # type: ignore[arg-type]
            target_id=result.target_id,
            target_kind=result.target_kind,
            items=[
                GapItemOut(
                    skill_id=item.skill_id,
                    weight=item.weight,
                    cluster=item.cluster,
                    position=item.position,
                    partial=item.partial,
                    partial_from=item.partial_from,
                    prerequisites=list(item.prerequisites),
                    basis=item.basis,
                    support=item.support,
                )
                for item in result.items
            ],
            held=[HeldOut(skill_id=h.skill_id, status=h.status) for h in result.held],
            confidence=result.confidence,  # type: ignore[arg-type]
            missing=list(result.missing),
            unweighted=list(result.unweighted),
            reason=result.reason,
            scorer_version=result.scorer_version,
            knowledge_as_of=result.knowledge_as_of,
            readiness=ReadinessOut(
                status=readiness.status,  # type: ignore[arg-type]
                score=readiness.score,
                score_low=readiness.score_low,
                score_high=readiness.score_high,
                by_cluster=[
                    ClusterScoreOut(
                        cluster=entry.cluster,
                        score=entry.score,
                        weight_share=entry.weight_share,
                        requirement_count=entry.requirement_count,
                    )
                    for entry in readiness.by_cluster
                ],
                confidence=readiness.confidence,  # type: ignore[arg-type]
                remaining=[
                    RemainingOut(
                        skill_id=entry.skill_id,
                        weight=entry.weight,
                        partial=entry.partial,
                        partial_from=entry.partial_from,
                        cluster=entry.cluster,
                        position=entry.position,
                        typical_time_to_competence=entry.typical_time_to_competence,
                    )
                    for entry in readiness.remaining
                ],
                terms=[
                    ReadinessTermOut(
                        skill_id=term.skill_id,
                        weight=term.weight,
                        credit=term.credit,
                        basis=term.basis,  # type: ignore[arg-type]
                        source=term.source,
                        contribution=term.contribution,
                    )
                    for term in readiness.terms
                ],
                estimated_time_to_ready=readiness.estimated_time_to_ready,
                time_to_ready_basis=readiness.time_to_ready_basis,
                binding_constraint=readiness.binding_constraint,
                missing=list(readiness.missing),
                reason=readiness.reason,
                scorer_version=readiness.scorer_version,
            ),
        ).model_dump(),
    )


@app.get("/health/live")
def live() -> dict[str, str]:
    """The process is up. Nothing else is claimed."""
    return {"status": "live", "version": SCORER_VERSION}


@app.get("/health/ready")
def ready() -> dict[str, str]:
    """Ready to serve.

    This service genuinely has no external dependency — no database, no cache, no model — because
    every fact it needs arrives in the request. So readiness really is "the code imported", and a
    probe that checked something it does not use would be theatre.
    """
    return {"status": "ready", "version": SCORER_VERSION}
