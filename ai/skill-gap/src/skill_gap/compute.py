"""The gap: what is missing, how much it matters, and in what order to close it.

**Arithmetic over supplied facts. No model runs here, and none should** — the model's only role in
this feature is writing prose from an already-computed result
(``docs/features/skill-gap-analysis.md``). It never decides that a skill is missing, how much it
matters, or what order to close it in.

A gap is not "requirements minus skills". Four things separate the two, and each is a rule below:

1. **Market scoping.** A requirement can be real in one market and absent in another. The most
   specific row wins, so German for a Berlin role does not appear in a remote-worldwide gap.
2. **Collapsing.** Holding a broader skill covers the narrower one it ``subsumes``. Without this a
   gap double-counts, and a person is told to learn something they already have under another name.
3. **Partial credit.** A held skill can partly cover a missing one through ``transfers_to``.
   Reported, never silently folded into the weight — a half-closed gap is still a gap, and the user
   is the one who decides whether the transfer is real for them.
4. **Order.** ``requires`` edges impose dependency order. An unordered gap is not actionable, and
   an order that ignores prerequisites tells someone to learn Kubernetes before containers.

**Determinism is a correctness property here, not a nicety.** The same profile and graph must
produce the same gap, byte for byte, or a readiness score computed from it cannot be reproduced from
its recorded ``scorerVersion`` (ADR-0009). Every sort in this module carries a total-order tiebreak
for that reason, and there is a test that runs the whole thing repeatedly.
"""

from __future__ import annotations

from dataclasses import dataclass

from skill_gap.ports import Edge, GapRequest, HeldSkill, RequiredSkill

#: Bumped whenever the arithmetic changes in a way that could move a gap. Recorded on every result,
#: so a stored gap says which code produced it — a number whose scorer is unknown cannot be
#: reproduced or re-examined after a bug.
SCORER_VERSION = "skill-gap/2026-08-03"

_EDGE_REQUIRES = "requires"
_EDGE_TRANSFERS = "transfers_to"
_EDGE_SUBSUMES = "subsumes"

#: A held skill only collapses or transfers when the profile actually evidenced it. A `claimed`
#: skill is a line in a list, and letting it close someone else's gap is the same inflation the
#: evidenced/claimed split exists to prevent (`docs/features/resume-parsing.md`).
_CREDIT_STATUSES = frozenset({"evidenced"})


@dataclass(frozen=True)
class GapItem:
    """One missing requirement, with why it is a gap and why it sits where it does."""

    skill_id: str
    #: Importance for this target, straight from knowledge. None when the requirement is known but
    #: its weight is not — never defaulted.
    weight: float | None
    cluster: str
    #: 1-based. Position in dependency order.
    position: int
    #: 0..1 when a held skill partly covers this one, else None.
    partial: float | None
    #: The held skill that produced `partial`, so the claim is checkable.
    partial_from: str | None
    #: Requirements that must come first, as skill ids. Empty when nothing blocks it.
    prerequisites: tuple[str, ...]
    #: Where the requirement's weight came from.
    basis: str
    support: int | None


@dataclass(frozen=True)
class HeldItem:
    skill_id: str
    status: str


@dataclass(frozen=True)
class GapResult:
    """What the service returns.

    ``status`` has three values because there are three genuinely different answers, and collapsing
    them is how a system starts reporting a confident zero for a question it cannot answer:

    * ``ok`` — the gap was computed.
    * ``no_gap`` — every requirement is met. Said plainly, because "you're a great fit!" with no
      detail is a failure (``docs/features/skill-gap-analysis.md``).
    * ``unknown`` — the target is not modelled. Never a generic or empty gap.
    """

    status: str
    target_id: str
    target_kind: str
    items: tuple[GapItem, ...]
    held: tuple[HeldItem, ...]
    #: 'high' | 'medium' | 'low' — never implied, always stated.
    confidence: str
    #: What would have made this answer better, in words a caller can act on.
    missing: tuple[str, ...]
    #: Requirements whose importance is unknown. Listed rather than assigned a default, because a
    #: default weight is an invented market fact.
    unweighted: tuple[str, ...]
    reason: str | None
    scorer_version: str
    knowledge_as_of: str | None


def scope_requirements(
    requirements: tuple[RequiredSkill, ...], market: str | None
) -> tuple[RequiredSkill, ...]:
    """Pick one requirement per skill: the most specific one that applies.

    A market-specific row wins over a global row for the same skill. A row scoped to a *different*
    market is dropped entirely — German is a real requirement in Berlin and simply not one for a
    remote-worldwide target, and carrying it anyway would put it in every gap everywhere.
    """
    applicable = [
        requirement
        for requirement in requirements
        if requirement.market_scope is None or requirement.market_scope == market
    ]

    best: dict[str, RequiredSkill] = {}
    for requirement in applicable:
        current = best.get(requirement.skill_id)
        if current is None or (
            current.market_scope is None and requirement.market_scope is not None
        ):
            best[requirement.skill_id] = requirement

    return tuple(sorted(best.values(), key=lambda r: r.skill_id))


def _credited(held: tuple[HeldSkill, ...]) -> frozenset[str]:
    return frozenset(skill.skill_id for skill in held if skill.status in _CREDIT_STATUSES)


def covered_by_subsumption(
    required: str, credited: frozenset[str], edges: tuple[Edge, ...]
) -> str | None:
    """The held skill that makes this requirement redundant, if any.

    One hop only, deliberately. A chain of `subsumes` edges implying that some very broad skill
    covers everything is a modelling error, and following it would silently close gaps a person has
    not closed.
    """
    covering = sorted(
        edge.from_skill_id
        for edge in edges
        if edge.edge_type == _EDGE_SUBSUMES
        and edge.to_skill_id == required
        and edge.from_skill_id in credited
    )
    return covering[0] if covering else None


def strongest_transfer(
    required: str, credited: frozenset[str], edges: tuple[Edge, ...]
) -> tuple[float, str] | None:
    """The best partial credit available for a missing skill, and where it comes from.

    The edge weight is reported as-is. Discounting it by some factor would be exactly the invented
    constant `docs/features/skill-gap-analysis.md` forbids: the graph already states how much
    competence carries, and a second opinion applied in code has no provenance.
    """
    transfers = [
        (edge.weight, edge.from_skill_id)
        for edge in edges
        if edge.edge_type == _EDGE_TRANSFERS
        and edge.to_skill_id == required
        and edge.from_skill_id in credited
    ]
    if not transfers:
        return None
    # Strongest first; skill id breaks a tie so the choice is stable across runs.
    return sorted(transfers, key=lambda t: (-t[0], t[1]))[0]


def order_by_prerequisites(
    skill_ids: tuple[str, ...], edges: tuple[Edge, ...], weights: dict[str, float | None]
) -> tuple[str, ...]:
    """Dependency order over the gap, with a total-order tiebreak.

    A topological sort restricted to the gap itself: a `requires` edge pointing at something the
    person already has is not a blocker and must not delay the skill that needs it.

    Ties are broken by weight descending, then by skill id. Both halves matter — weight makes the
    order useful, and the id makes it reproducible, which is what the determinism requirement is
    actually asking for.

    A cycle cannot be ordered. Rather than raise, the remaining skills are appended by the same
    tiebreak so the gap is still answerable, because a data defect in the graph should not make the
    whole feature unavailable to the user in front of it.
    """
    in_gap = set(skill_ids)
    blockers: dict[str, set[str]] = {skill: set() for skill in skill_ids}
    for edge in edges:
        if edge.edge_type != _EDGE_REQUIRES:
            continue
        if edge.from_skill_id in in_gap and edge.to_skill_id in in_gap:
            blockers[edge.from_skill_id].add(edge.to_skill_id)

    def rank(skill: str) -> tuple[float, str]:
        weight = weights.get(skill)
        # Unweighted requirements sort last among their peers rather than first: an unknown
        # importance is not evidence of high importance.
        return (-(weight if weight is not None else -1.0), skill)

    ordered: list[str] = []
    placed: set[str] = set()
    remaining = set(skill_ids)

    while remaining:
        ready = sorted((s for s in remaining if blockers[s] <= placed), key=rank)
        if not ready:
            # Cycle among the remaining skills. Emit them deterministically and stop pretending
            # there is an order.
            ordered.extend(sorted(remaining, key=rank))
            break
        for skill in ready:
            ordered.append(skill)
            placed.add(skill)
        remaining -= set(ready)

    return tuple(ordered)


def _confidence(
    items: tuple[GapItem, ...], held: tuple[HeldSkill, ...], unweighted: tuple[str, ...]
) -> str:
    """Stated, never implied.

    Low whenever the inputs cannot support a confident answer: an unweighted requirement, or a
    profile whose skills are mostly claimed rather than evidenced. Both are honest reasons to
    distrust a gap, and neither is visible in the number itself.
    """
    if unweighted:
        return "low"
    if not held:
        return "low"
    evidenced = sum(1 for skill in held if skill.status in _CREDIT_STATUSES)
    if evidenced == 0:
        return "low"
    if evidenced < len(held) / 2:
        return "medium"
    return "high"


def compute_gap(request: GapRequest) -> GapResult:
    """Turn a target, a profile and a graph into an ordered gap.

    The unknown path is not an error path. A target nobody has modelled returns ``unknown`` naming
    what is missing, because a person deciding what to spend six months learning deserves "we have
    not modelled this track" over a plausible-looking empty list.
    """
    scoped = scope_requirements(request.requirements, request.market)

    if not scoped:
        return GapResult(
            status="unknown",
            target_id=request.target_id,
            target_kind=request.target_kind,
            items=(),
            held=(),
            confidence="low",
            missing=(
                f"no requirements are modelled for {request.target_kind} "
                f"'{request.target_id}'"
                + (f" in market {request.market}" if request.market else ""),
            ),
            unweighted=(),
            reason=(
                "This target has not been modelled yet, so there is nothing to compare a profile "
                "against. Nothing was inferred to fill the gap."
            ),
            scorer_version=SCORER_VERSION,
            knowledge_as_of=request.knowledge_as_of,
        )

    credited = _credited(request.held)

    missing_requirements: list[RequiredSkill] = []
    for requirement in scoped:
        if requirement.skill_id in credited:
            continue
        if covered_by_subsumption(requirement.skill_id, credited, request.edges) is not None:
            continue
        missing_requirements.append(requirement)

    weights = {r.skill_id: r.weight for r in missing_requirements}
    order = order_by_prerequisites(
        tuple(r.skill_id for r in missing_requirements), request.edges, weights
    )
    position_of = {skill_id: index + 1 for index, skill_id in enumerate(order)}
    by_id = {r.skill_id: r for r in missing_requirements}
    in_gap = set(order)

    items: list[GapItem] = []
    for skill_id in order:
        requirement = by_id[skill_id]
        transfer = strongest_transfer(skill_id, credited, request.edges)
        prerequisites = tuple(
            sorted(
                edge.to_skill_id
                for edge in request.edges
                if edge.edge_type == _EDGE_REQUIRES
                and edge.from_skill_id == skill_id
                and edge.to_skill_id in in_gap
            )
        )
        items.append(
            GapItem(
                skill_id=skill_id,
                weight=requirement.weight,
                cluster=requirement.cluster,
                position=position_of[skill_id],
                partial=transfer[0] if transfer else None,
                partial_from=transfer[1] if transfer else None,
                prerequisites=prerequisites,
                basis=requirement.basis,
                support=requirement.support,
            )
        )

    unweighted = tuple(sorted(item.skill_id for item in items if item.weight is None))

    missing: list[str] = []
    if unweighted:
        missing.append(
            f"{len(unweighted)} requirement(s) have no weight available, so their importance is "
            "unknown rather than low"
        )
    if request.unresolved:
        missing.append(
            f"{len(request.unresolved)} phrase(s) in the profile could not be resolved to a known "
            "skill, so they were not counted as held"
        )
    if not request.held:
        missing.append("the profile contains no skills, so every requirement reads as a gap")

    result_items = tuple(items)
    held_out = tuple(
        HeldItem(skill_id=skill.skill_id, status=skill.status)
        # Only what is relevant to this target. A profile's unrelated skills are not evidence about
        # this gap and listing them would pad the answer.
        for skill in sorted(request.held, key=lambda s: s.skill_id)
        if skill.skill_id in {r.skill_id for r in scoped}
    )

    if not result_items:
        return GapResult(
            status="no_gap",
            target_id=request.target_id,
            target_kind=request.target_kind,
            items=(),
            held=held_out,
            confidence=_confidence((), request.held, ()),
            missing=tuple(missing),
            unweighted=(),
            reason=(
                "Every modelled requirement for this target is already evidenced in the profile. "
                "That is the answer, not an error."
            ),
            scorer_version=SCORER_VERSION,
            knowledge_as_of=request.knowledge_as_of,
        )

    return GapResult(
        status="ok",
        target_id=request.target_id,
        target_kind=request.target_kind,
        items=result_items,
        held=held_out,
        confidence=_confidence(result_items, request.held, unweighted),
        missing=tuple(missing),
        unweighted=unweighted,
        reason=None,
        scorer_version=SCORER_VERSION,
        knowledge_as_of=request.knowledge_as_of,
    )


__all__ = [
    "SCORER_VERSION",
    "GapItem",
    "GapResult",
    "HeldItem",
    "compute_gap",
    "covered_by_subsumption",
    "order_by_prerequisites",
    "scope_requirements",
    "strongest_transfer",
]
