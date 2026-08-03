"""Readiness: how close someone is, and what is still missing.

**A readiness number without a remainder is a vanity metric**
(``.claude/context/career-philosophy.md``). So this module never returns a bare score — the
remainder, the confidence, the evidence for every term, and the versions that produced it all travel
with it or it is not emitted.

Computed from exactly the same inputs as the gap, in the same call, deliberately. Readiness and the
gap are two readings of one comparison, and computing them separately would let them disagree about
``knowledge_as_of`` — a score and a gap describing different moments, both looking correct.

The formula is ``.claude/skills/career-intelligence/SKILL.md``'s:

    readiness = sum(weight(r) * credit(r) for r in requirements) / sum(weight(r))

where ``credit`` is 1.0 for an evidenced hold, ``CLAIMED_CREDIT`` for a claimed one, the transfer
edge's weight when competence carries over, and 0 otherwise. Every non-zero term names its basis,
because a score whose terms cannot be inspected is a number nobody can argue with — and a person
should be able to argue with this one.
"""

from __future__ import annotations

from dataclasses import dataclass

from skill_gap.compute import (
    GapItem,
    covered_by_subsumption,
    scope_requirements,
    strongest_transfer,
)
from skill_gap.ports import Edge, GapRequest, HeldSkill, RequiredSkill

#: Bumped whenever this arithmetic changes in a way that could move a score. Recorded on every
#: result: a number whose scorer is unknown cannot be reproduced or re-examined after a bug.
SCORER_VERSION = "readiness/2026-08-03-2"

#: What a *claimed* skill is worth against an evidenced one.
#:
#: The one calibration constant here, and it is a constant on purpose rather than by omission:
#: `.claude/skills/career-intelligence/SKILL.md` fixes it, so it is traceable to a decision rather
#: than to whoever typed it. It is **not** a market fact — those come from `career_skills.weight`
#: and are never hardcoded.
#:
#: It matters more than its size suggests. This is the number that makes correcting an over-claimed
#: skill move readiness *down*, which is the M1a correction loop having a visible consequence.
CLAIMED_CREDIT = 0.6

_EVIDENCED = "evidenced"
_CLAIMED = "claimed"


@dataclass(frozen=True)
class ReadinessTerm:
    """One requirement's contribution, and why it contributed that much."""

    skill_id: str
    weight: float
    credit: float
    #: 'evidenced' | 'claimed' | 'subsumed' | 'transferred' | 'missing'
    basis: str
    #: The held skill that produced the credit, when one did.
    source: str | None
    #: What this term added to the numerator. Shown so the arithmetic is checkable by hand.
    contribution: float


@dataclass(frozen=True)
class RemainingItem:
    """One thing still missing, with what it costs to be wrong about it."""

    skill_id: str
    weight: float
    #: 0..1 when partly covered, else None. Reported, never folded into the score silently.
    partial: float | None
    partial_from: str | None
    cluster: str
    position: int
    #: Deliberately absent until there is data to fill it. See `time_to_ready_basis`.
    typical_time_to_competence: str | None = None


@dataclass(frozen=True)
class ClusterScore:
    """Readiness within one cluster, because the blend hides which part is strong.

    Core and peripheral are different questions. Someone 70% through the core of a track and 0%
    through its peripherals, and someone with the reverse, can produce the same overall number
    while being in completely different positions.
    """

    cluster: str
    score: float
    #: What share of the whole denominator this cluster is, so a strong score over 7% of the
    #: requirement mass is not read as a strong score overall.
    weight_share: float
    requirement_count: int


@dataclass(frozen=True)
class Readiness:
    """A verdict, a remainder, and a cost — never a bare score.

    ``status`` is ``unknown`` whenever the inputs cannot support a number. A low score and "we
    cannot tell" are different answers, and reporting the second as the first is the failure the
    whole product is built to avoid.
    """

    status: str
    score: float | None
    #: The floor: only evidenced and subsumed holds counted. What is true even if every assertion
    #: on the profile turns out to be hollow.
    score_low: float | None
    #: The ceiling: every claimed skill and every transfer edge counted in full. What is true if
    #: all of them hold up.
    score_high: float | None
    #: Per cluster, because a single blended number hides which part of the track is strong.
    by_cluster: tuple[ClusterScore, ...]
    confidence: str
    remaining: tuple[RemainingItem, ...]
    terms: tuple[ReadinessTerm, ...]
    #: Null until learning-resource durations or recorded outcomes exist. Never estimated from
    #: nothing — an invented timeline is the most damaging thing a career platform can produce.
    estimated_time_to_ready: str | None
    time_to_ready_basis: str
    #: Null while market demand, language level and eligibility are unmodelled. Naming a binding
    #: constraint we did not compute would be worse than admitting there is none yet.
    binding_constraint: str | None
    missing: tuple[str, ...]
    reason: str | None
    scorer_version: str


def _credit_for(
    requirement: RequiredSkill,
    evidenced: frozenset[str],
    claimed: frozenset[str],
    edges: tuple[Edge, ...],
) -> tuple[float, str, str | None]:
    """How much of one requirement this person already has, and on what basis.

    Order matters and is the doc's: an evidenced hold beats a claimed one beats a transfer. Taking
    the maximum rather than summing is deliberate — holding Docker *and* a transfer edge into
    Kubernetes does not make someone more than fully credited for Kubernetes.
    """
    if requirement.skill_id in evidenced:
        return 1.0, _EVIDENCED, requirement.skill_id

    subsumed_by = covered_by_subsumption(requirement.skill_id, evidenced, edges)
    if subsumed_by is not None:
        return 1.0, "subsumed", subsumed_by

    if requirement.skill_id in claimed:
        # A claimed skill is a line in a list. Crediting it fully is how a padded skills section
        # inflates a readiness score, which is exactly what the evidenced/claimed split prevents.
        return CLAIMED_CREDIT, _CLAIMED, requirement.skill_id

    transfer = strongest_transfer(requirement.skill_id, evidenced, edges)
    if transfer is not None:
        return transfer[0], "transferred", transfer[1]

    return 0.0, "missing", None


def _bounds_credit(basis: str, credit: float) -> tuple[float, float]:
    """The same term read pessimistically and optimistically.

    Only two of the five bases are *known*: an evidenced hold and a subsumed one. The rest are
    estimates — a claimed skill is the person's word, and a transfer edge is a general statement
    about how competence carries, not a measurement of how it carried for them.

    So the floor counts only what is known, and the ceiling counts every estimate as if it held in
    full. The distance between them is exactly how much of the number rests on assertion, which is
    the thing a single figure cannot say.
    """
    if basis in {_EVIDENCED, "subsumed"}:
        return 1.0, 1.0
    if basis in {_CLAIMED, "transferred"}:
        return 0.0, 1.0
    return 0.0, 0.0


def _confidence(held: tuple[HeldSkill, ...], unweighted_count: int, scored_count: int) -> str:
    """Stated, never implied, and pinned to the weakest input.

    Three things independently make a readiness number untrustworthy: requirements nobody has
    weighted, a profile that is mostly assertions, and a profile with almost nothing in it. Any one
    of them caps the confidence, because a score is only as good as its worst input.
    """
    if unweighted_count > 0:
        return "low"

    evidenced = sum(1 for skill in held if skill.status == _EVIDENCED)
    if evidenced == 0:
        return "low"

    # A handful of skills can produce a confident-looking number over a track with thirty
    # requirements. The number may even be right; our confidence in it should not be high.
    sparse_profile_floor = 3
    if evidenced < sparse_profile_floor or evidenced < len(held) / 2:
        return "medium"

    if scored_count == 0:
        return "low"
    return "high"


def compute_readiness(request: GapRequest, gap_items: tuple[GapItem, ...]) -> Readiness:
    """Score the same comparison the gap describes.

    ``gap_items`` is passed in rather than recomputed so the remainder is *literally* the gap — a
    readiness whose remainder disagreed with the gap on the same screen would be two answers to one
    question.
    """
    scoped = scope_requirements(request.requirements, request.market)

    if not scoped:
        return Readiness(
            status="unknown",
            score=None,
            score_low=None,
            score_high=None,
            by_cluster=(),
            confidence="low",
            remaining=(),
            terms=(),
            estimated_time_to_ready=None,
            time_to_ready_basis="not estimated: the target is not modelled",
            binding_constraint=None,
            missing=(f"no requirements are modelled for '{request.target_id}'",),
            reason=(
                "This target has not been modelled, so there is nothing to measure readiness "
                "against. Nothing was inferred to fill the gap."
            ),
            scorer_version=SCORER_VERSION,
        )

    if not request.held:
        # The sparse-profile path M1b's sibling requirement names: return `unknown` with the one
        # input that would resolve it, never a low number. A zero here would read as "you are not
        # ready" when the truth is "we have not been told anything about you".
        return Readiness(
            status="unknown",
            score=None,
            score_low=None,
            score_high=None,
            by_cluster=(),
            confidence="low",
            remaining=(),
            terms=(),
            estimated_time_to_ready=None,
            time_to_ready_basis="not estimated: no profile to measure",
            binding_constraint=None,
            missing=("the profile contains no skills",),
            reason=(
                "There is no parsed profile to measure. Upload a résumé and this becomes a real "
                "number rather than a guess."
            ),
            scorer_version=SCORER_VERSION,
        )

    evidenced = frozenset(s.skill_id for s in request.held if s.status == _EVIDENCED)
    claimed = frozenset(s.skill_id for s in request.held if s.status == _CLAIMED)

    terms: list[ReadinessTerm] = []
    unweighted: list[str] = []
    numerator = 0.0
    denominator = 0.0
    numerator_low = 0.0
    numerator_high = 0.0
    cluster_totals: dict[str, list[float]] = {}

    for requirement in scoped:
        if requirement.weight is None:
            # Excluded from the arithmetic rather than defaulted: a default weight is an invented
            # market fact, and inventing one here would move a score by a number nobody chose.
            unweighted.append(requirement.skill_id)
            continue

        credit, basis, source = _credit_for(requirement, evidenced, claimed, request.edges)
        contribution = requirement.weight * credit
        numerator += contribution
        denominator += requirement.weight

        low_credit, high_credit = _bounds_credit(basis, credit)
        numerator_low += requirement.weight * low_credit
        numerator_high += requirement.weight * high_credit

        bucket = cluster_totals.setdefault(requirement.cluster, [0.0, 0.0, 0.0])
        bucket[0] += contribution
        bucket[1] += requirement.weight
        bucket[2] += 1
        terms.append(
            ReadinessTerm(
                skill_id=requirement.skill_id,
                weight=requirement.weight,
                credit=credit,
                basis=basis,
                source=source,
                contribution=round(contribution, 4),
            )
        )

    if denominator == 0:
        return Readiness(
            status="unknown",
            score=None,
            score_low=None,
            score_high=None,
            by_cluster=(),
            confidence="low",
            remaining=(),
            terms=tuple(terms),
            estimated_time_to_ready=None,
            time_to_ready_basis="not estimated: no weighted requirements",
            binding_constraint=None,
            missing=(
                f"none of the {len(scoped)} modelled requirements carry a weight, "
                "so there is nothing to measure against",
            ),
            reason=(
                "This track's requirements have no importance recorded, so a readiness number "
                "would be arithmetic over nothing."
            ),
            scorer_version=SCORER_VERSION,
        )

    score = round(numerator / denominator, 4)
    score_low = round(numerator_low / denominator, 4)
    score_high = round(numerator_high / denominator, 4)

    by_cluster = tuple(
        ClusterScore(
            cluster=cluster,
            score=round(totals[0] / totals[1], 4),
            weight_share=round(totals[1] / denominator, 4),
            requirement_count=int(totals[2]),
        )
        # Sorted by share of the denominator, so the cluster that actually drives the number reads
        # first rather than whichever happened to be inserted first.
        for cluster, totals in sorted(
            cluster_totals.items(), key=lambda entry: (-entry[1][1], entry[0])
        )
    )

    remaining = tuple(
        RemainingItem(
            skill_id=item.skill_id,
            # A gap item without a weight was excluded from the score; it is still missing, and
            # reporting it as weight 0 would read as "does not matter" rather than "unknown".
            weight=item.weight if item.weight is not None else 0.0,
            partial=item.partial,
            partial_from=item.partial_from,
            cluster=item.cluster,
            position=item.position,
        )
        for item in gap_items
    )

    missing: list[str] = []
    if unweighted:
        missing.append(
            f"{len(unweighted)} requirement(s) have no weight recorded and were left out of the "
            "score rather than assigned a default"
        )
    if claimed:
        missing.append(
            f"{len(claimed)} skill(s) are listed but not described in your history, and count for "
            f"{CLAIMED_CREDIT:.0%} rather than in full"
        )
    # Said plainly rather than left for someone to notice: this number is about skills only.
    missing.append(
        "market demand, language level and visa eligibility are not modelled yet, so this is "
        "skill readiness rather than whether you would be hired"
    )
    if score_high - score_low > 0:
        # Said out loud rather than left implicit in two numbers nobody compares.
        missing.append(
            f"between {score_low:.0%} and {score_high:.0%} depending on whether your listed and "
            "transferred skills hold up in practice — the single figure sits in the middle"
        )

    return Readiness(
        status="ok",
        score=score,
        score_low=score_low,
        score_high=score_high,
        by_cluster=by_cluster,
        confidence=_confidence(request.held, len(unweighted), len(terms)),
        remaining=remaining,
        terms=tuple(terms),
        estimated_time_to_ready=None,
        time_to_ready_basis=(
            "not estimated: no time-to-competence data exists yet. Learning takes as long as it "
            "takes, and an invented timeline is worse than no timeline."
        ),
        binding_constraint=None,
        missing=tuple(missing),
        reason=None,
        scorer_version=SCORER_VERSION,
    )


__all__ = [
    "CLAIMED_CREDIT",
    "SCORER_VERSION",
    "ClusterScore",
    "Readiness",
    "ReadinessTerm",
    "RemainingItem",
    "compute_readiness",
]
