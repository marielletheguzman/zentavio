"""Composing eligibility and employability into viability (ADR-0022).

**Viability is a pair, not a score.** No composite number is computed here, and adding one later
means changing this ADR first. The deciding argument is in ADR-0022: a single number cannot carry a
refusal, because ``undetermined`` and ``unknown`` are not low values — they are the absence of an
answer. Any arithmetic admitting them invents a magnitude for "we do not know", and the obvious
mapping makes an unanswered question at 0.62 readiness indistinguishable from an eligible person at
0.31 — at exactly the moment the two require different actions.

What this module produces instead is the thing `docs/architecture/immigration.md` says must *always*
be named: **which of the two axes currently binds.**

Nothing new is measured to decide that. The binding constraint is read off the eligibility verdict
and the employability result that were already computed — this module introduces no threshold, no
weighting, and no judgement of its own.

**Employability arrives as data.** This service does not import `skill-gap` or call it: the gateway
computes both halves and hands them over, which is what keeps `ai/` stateless and keeps two
workspace members from depending on each other.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from career_roadmap.eligibility import Verdict

#: Which axis stops this being a pathway worth pursuing. A closed set, so a new one is a type error
#: rather than a string that quietly appears in a response nobody validates.
BindingConstraint = Literal[
    "eligibility",  # a rule is not met, or cannot be evaluated yet
    "employability",  # eligible, but not ready for the work at this level
    "recognition",  # licence-gated and no recognition rule is on file
    "unmodelled",  # nobody has ingested rules for this pathway
    "none",  # both axes satisfied
]

#: What `ai/skill-gap` reports. Mirrored rather than imported — see the module docstring.
EmployabilityStatus = Literal["ok", "no_gap", "unknown"]


@dataclass(frozen=True)
class Employability:
    """The readiness half, as the gateway supplies it.

    The **band** is carried, never a midpoint. Its width is how much of the number rests on
    assertion rather than evidence, and M1c added it for that reason — collapsing it here would
    throw away the honesty it exists to express.
    """

    status: EmployabilityStatus
    #: Counts only evidenced and subsumed skills. ``None`` when the status is ``unknown``.
    score_low: float | None = None
    #: Counts every claimed skill and transfer edge in full.
    score_high: float | None = None
    #: How many requirements remain. Reported, never turned into a threshold here.
    missing_count: int = 0
    #: Why readiness could not be computed, when the status is ``unknown``.
    reason: str | None = None


@dataclass(frozen=True)
class Viability:
    """Two axes and the one that binds. Deliberately has no score field."""

    pathway_id: str | None
    eligibility: Verdict
    employability: Employability
    binding: BindingConstraint
    #: Why that axis binds, in a sentence a person can act on.
    binding_reason: str
    #: Shared by both axes. A pair describing two moments is not a verdict about anything.
    as_of: str
    #: Emitted verbatim, from the eligibility verdict. Never reworded.
    disclaimer: str


class AsOfMismatchError(ValueError):
    """Raised when the two halves were computed against different dates.

    Not a warning. Immigration rules change on legislative timelines and readiness changes when a
    profile does; a pair mixing two dates is a statement about no particular moment, and the `asOf`
    on the response would be a claim about only half of it.
    """


def compose(
    eligibility: Verdict,
    employability: Employability,
    *,
    employability_as_of: str,
) -> Viability:
    """Pair the two axes and name the binding constraint.

    Ordering matters and follows `docs/architecture/immigration.md`: an unrecognised qualification
    makes a visa threshold moot, and a threshold that is not met makes readiness moot. So the axes
    are checked in the order of what blocks what, and the **first** blocker is the binding one.
    """
    if eligibility.as_of != employability_as_of:
        raise AsOfMismatchError(
            f"eligibility is as of {eligibility.as_of} and employability as of "
            f"{employability_as_of}; a viability pair must describe one moment"
        )

    binding, reason = _binding(eligibility, employability)

    return Viability(
        pathway_id=eligibility.pathway_id,
        eligibility=eligibility,
        employability=employability,
        binding=binding,
        binding_reason=reason,
        as_of=eligibility.as_of,
        disclaimer=eligibility.disclaimer,
    )


def _binding(eligibility: Verdict, employability: Employability) -> tuple[BindingConstraint, str]:
    """Which axis binds, and why.

    Every branch reads an existing field. Nothing here introduces a cut-off: "is there a gap" is
    `ai/skill-gap`'s own status, not a threshold invented at this layer.
    """
    if eligibility.status == "unknown":
        # `unknown` has two causes and they are different sentences to a person: one is about their
        # profession, the other is about our coverage.
        return (
            (
                "recognition",
                "This profession is licence-gated and we have no recognition rule on file, so no "
                "eligibility answer can be given — not a judgement about you.",
            )
            if eligibility.binding_domain == "recognition"
            else (
                "unmodelled",
                "Nobody has recorded the rules for this pathway on this date, so there is nothing "
                "to check against yet.",
            )
        )

    if eligibility.status == "not_met":
        blocker = eligibility.blockers[0] if eligibility.blockers else "a requirement"
        return (
            "eligibility",
            f"A requirement is not met ({blocker}), so readiness does not decide this yet.",
        )

    if eligibility.status == "undetermined":
        # Deliberately not "you are not eligible". Nothing here says no — a question is unanswered,
        # and the input that resolves it is already in the verdict.
        needed = ", ".join(eligibility.needs_from_user) or "one more input"
        return (
            "eligibility",
            f"Nothing here says no. We cannot finish checking until you supply {needed}.",
        )

    # Eligible. Employability is what is left to decide.
    if employability.status == "unknown":
        return (
            "employability",
            employability.reason
            or "You meet the requirements, but there is not enough on file to say how ready "
            "you are.",
        )

    if employability.status == "no_gap":
        return (
            "none",
            "You meet the requirements we can check, and nothing is missing from your profile for "
            "this track.",
        )

    return (
        "employability",
        f"You meet the requirements, and {employability.missing_count} skill(s) still stand "
        "between you and the work at this level.",
    )
