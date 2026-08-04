"""Deterministic eligibility evaluation over retrieved requirement rows.

**No model appears anywhere in this path** (`docs/architecture/immigration.md`). An LLM may
summarise a retrieved rule for display; it may never decide one. Every function here is arithmetic
and comparison over data the caller supplies.

The evaluator is **generic by construction**. It branches on a requirement's ``evaluation`` field,
never on its jurisdiction — adding a country adds rows, never a branch. If a country name ever
appears in this module, ADR-0002's central claim is false.

Three rules carry most of the value:

1. ``undetermined`` never collapses into ``met`` or ``not_met``. A missing fact is not a failure,
   and reporting it as one would tell someone they are ineligible when they simply have not
   answered a question.
2. ``undetermined`` **dominates** the aggregate. One unknown requirement makes the verdict
   undetermined even when everything else is met — it never rounds toward the friendlier answer.
3. Every ``undetermined`` names the input that would resolve it. That is ``needs_from_user``, and
   it is what converts a dead end into a next action.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

Result = Literal["met", "not_met", "undetermined"]
Status = Literal["met", "not_met", "undetermined", "unknown"]

#: Emitted verbatim on every verdict. Never reworded, never shortened, never omitted
#: (`docs/architecture/immigration.md`, "Information, never advice").
DISCLAIMER = (
    "Sourced official information, not legal advice. Confirm with the authority or a "
    "qualified adviser."
)

#: Evaluation order, by what blocks what. An unrecognised qualification makes a visa threshold
#: moot, so recognition is reported before immigration (ADR-0010).
DOMAIN_ORDER: tuple[str, ...] = (
    "authentication",
    "credential",
    "recognition",
    "immigration",
    "employment_clearance",
    "language",
)


@dataclass(frozen=True)
class Requirement:
    """One stored requirement row, as the gateway hands it over."""

    requirement_id: str
    domain: str
    imposed_by: str
    kind: str
    evaluation: str
    value: Any
    needs_input: tuple[str, ...]
    authority: str
    source_url: str
    effective_from: date
    #: ``None`` for an open-ended rule. **Not** a reliable signal of currency — see
    #: :func:`applicable_on`.
    effective_to: date | None
    refresh_after: date | None = None
    contested: bool = False
    contested_note: str | None = None


@dataclass(frozen=True)
class PersonFact:
    """One answer the person has given."""

    key: str
    value: Any
    basis: str = "self_reported"


@dataclass(frozen=True)
class EvaluatedRequirement:
    requirement_id: str
    domain: str
    imposed_by: str
    result: Result
    authority: str
    source_url: str
    effective_from: str
    basis: str | None = None
    reason: str | None = None
    needs_input: tuple[str, ...] = ()


@dataclass(frozen=True)
class Verdict:
    pathway_id: str | None
    status: Status
    requirements: tuple[EvaluatedRequirement, ...]
    blockers: tuple[str, ...]
    needs_from_user: tuple[str, ...]
    binding_domain: str | None
    confidence: str
    as_of: str
    disclaimer: str = DISCLAIMER
    notes: tuple[str, ...] = field(default_factory=tuple)


def applicable_on(requirement: Requirement, as_of: date) -> bool:
    """Whether a requirement applies on a given date.

    **Containment, never ``effective_to IS NULL``.** Some sources publish open-ended rules; others
    publish bounded ones. Germany's Blue Card salary minimum is announced *for one calendar year*,
    so every stored row has an ``effective_to`` and none is ever null. A query treating null as
    "current" silently excludes every annual rule and returns an empty rule set — which reads as
    "we have no requirements" rather than as the bug it is.
    """
    if as_of < requirement.effective_from:
        return False
    return requirement.effective_to is None or as_of <= requirement.effective_to


def _as_number(value: Any) -> float | None:
    """A comparable number, or ``None``.

    A monetary requirement value is an object carrying currency and period; a person's answer may
    be the same shape or a bare number. Anything else is not comparable, and returning ``None``
    makes that ``undetermined`` rather than a coerced zero.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        amount = value.get("amount")
        if isinstance(amount, (int, float)) and not isinstance(amount, bool):
            return float(amount)
    return None


def _units_match(requirement_value: Any, fact_value: Any) -> bool:
    """Whether two monetary values are in the same currency and period.

    Comparing 50 700 EUR/year against 55 000 USD/year, or against a monthly figure, produces a
    confident wrong answer. When either side declares units they must agree; a bare number is
    treated as already being in the requirement's units, which is what the fact catalogue's
    ``unit`` column exists to guarantee.
    """
    if not isinstance(requirement_value, dict) or not isinstance(fact_value, dict):
        return True
    for key in ("currency", "period", "basis"):
        expected, actual = requirement_value.get(key), fact_value.get(key)
        if expected is not None and actual is not None and expected != actual:
            return False
    return True


def evaluate_requirement(
    requirement: Requirement, facts: dict[str, PersonFact]
) -> EvaluatedRequirement:
    """Evaluate one requirement against what the person has told us.

    A requirement whose ``evaluation`` this function does not implement returns ``undetermined``
    with a reason, never ``met``. Silently passing an unimplemented comparison would let a rule
    nobody evaluated read as satisfied.
    """
    common = {
        "requirement_id": requirement.requirement_id,
        "domain": requirement.domain,
        "imposed_by": requirement.imposed_by,
        "authority": requirement.authority,
        "source_url": requirement.source_url,
        "effective_from": requirement.effective_from.isoformat(),
    }

    if requirement.contested:
        return EvaluatedRequirement(
            **common,
            result="undetermined",
            reason=requirement.contested_note
            or "the source is ambiguous and the ambiguity has not been resolved",
        )

    missing = tuple(key for key in requirement.needs_input if key not in facts)
    if missing:
        return EvaluatedRequirement(
            **common,
            result="undetermined",
            reason=f"no value on file for {', '.join(missing)}",
            needs_input=missing,
        )

    if requirement.evaluation in ("numeric-gte", "numeric-lte"):
        return _evaluate_numeric(requirement, facts, common)

    if requirement.evaluation == "set-member":
        return _evaluate_set_member(requirement, facts, common)

    if requirement.evaluation == "boolean":
        fact = facts[requirement.needs_input[0]]
        met = bool(fact.value) is bool(requirement.value)
        return EvaluatedRequirement(
            **common,
            result="met" if met else "not_met",
            basis=f"{requirement.needs_input[0]} is {fact.value!r}",
        )

    # `document-present` and `manual` are deliberately not decided here. A document check needs the
    # document, and `manual` means an authority decides — asserting either would be inventing a
    # verdict.
    return EvaluatedRequirement(
        **common,
        result="undetermined",
        reason=f"'{requirement.evaluation}' requires review that this evaluator does not perform",
        needs_input=requirement.needs_input,
    )


def _evaluate_numeric(
    requirement: Requirement, facts: dict[str, PersonFact], common: dict[str, Any]
) -> EvaluatedRequirement:
    threshold = _as_number(requirement.value)
    fact = facts[requirement.needs_input[0]]
    actual = _as_number(fact.value)

    if threshold is None or actual is None:
        return EvaluatedRequirement(
            **common,
            result="undetermined",
            reason="the requirement or the answer is not a comparable number",
            needs_input=requirement.needs_input,
        )

    if not _units_match(requirement.value, fact.value):
        return EvaluatedRequirement(
            **common,
            result="undetermined",
            reason="the answer is in different units from the threshold and cannot be compared",
            needs_input=requirement.needs_input,
        )

    met = actual >= threshold if requirement.evaluation == "numeric-gte" else actual <= threshold
    comparator = "at least" if requirement.evaluation == "numeric-gte" else "at most"
    return EvaluatedRequirement(
        **common,
        result="met" if met else "not_met",
        basis=f"{actual:g} against a threshold of {comparator} {threshold:g}",
    )


def _evaluate_set_member(
    requirement: Requirement, facts: dict[str, PersonFact], common: dict[str, Any]
) -> EvaluatedRequirement:
    permitted = requirement.value if isinstance(requirement.value, (list, tuple)) else None
    if permitted is None:
        return EvaluatedRequirement(
            **common,
            result="undetermined",
            reason="the requirement does not list the permitted values",
            needs_input=requirement.needs_input,
        )

    actual = facts[requirement.needs_input[0]].value
    met = actual in permitted
    return EvaluatedRequirement(
        **common,
        result="met" if met else "not_met",
        basis=f"{actual!r} against {len(permitted)} permitted value(s)",
    )


def _confidence(evaluated: tuple[EvaluatedRequirement, ...], facts: dict[str, PersonFact]) -> str:
    """Lower confidence when a verdict rests on assertion rather than evidence.

    A self-reported salary is an intention. A verdict computed from one is not wrong, but it is
    less certain than one computed from a verified figure, and saying so is cheaper than being
    confidently wrong.
    """
    if not evaluated:
        return "low"
    used = {key for req in evaluated for key in req.needs_input} or set(facts)
    relied_on = [facts[key] for key in used if key in facts]
    if relied_on and all(fact.basis == "verified" for fact in relied_on):
        return "high"
    return "medium"


def evaluate_pathway(
    pathway_id: str | None,
    requirements: list[Requirement],
    facts: list[PersonFact],
    as_of: date,
    *,
    licence_gated: bool = False,
) -> Verdict:
    """Evaluate every applicable requirement and aggregate one verdict.

    Returns ``unknown`` — not ``met`` — when there is nothing to evaluate, and when a licence-gated
    profession has no recognition requirement on file. Returning a visa-only verdict to a nurse
    whose licence does not transfer is the most harmful output this product could produce
    (`docs/architecture/immigration.md`).
    """
    by_key = {fact.key: fact for fact in facts}
    applicable = [r for r in requirements if applicable_on(r, as_of)]
    order = {domain: i for i, domain in enumerate(DOMAIN_ORDER)}
    applicable.sort(key=lambda r: (order.get(r.domain, len(DOMAIN_ORDER)), r.requirement_id))

    evaluated = tuple(evaluate_requirement(r, by_key) for r in applicable)
    notes: list[str] = []

    stale = [r for r in applicable if r.refresh_after is not None and r.refresh_after < as_of]
    if stale:
        notes.append(
            f"{len(stale)} rule(s) are past their refresh window and may no longer be current"
        )

    if not evaluated:
        return Verdict(
            pathway_id=pathway_id,
            status="unknown",
            requirements=(),
            blockers=(),
            needs_from_user=(),
            binding_domain=None,
            confidence="low",
            as_of=as_of.isoformat(),
            notes=(*notes, "no requirements are on file for this pathway on this date"),
        )

    if licence_gated and not any(r.domain == "recognition" for r in applicable):
        return Verdict(
            pathway_id=pathway_id,
            status="unknown",
            requirements=evaluated,
            blockers=(),
            needs_from_user=(),
            binding_domain="recognition",
            confidence="low",
            as_of=as_of.isoformat(),
            notes=(
                *notes,
                "this profession is licence-gated and no recognition rule is on file, so no "
                "eligibility verdict can be given",
            ),
        )

    # A `right` is a benefit the statute grants, not a hurdle — Germany's reduced Blue Card salary
    # threshold for certain ISCO groups is one. It can only ever *lower* the bar, so an unanswered
    # one must not block a verdict: doing so rejects exactly the people the provision is being
    # generous to, and asks a question whose answer could not have hurt them.
    #
    # Rights are still evaluated and still reported. They simply do not dominate.
    deciding = tuple(
        pair[0] for pair in zip(evaluated, applicable, strict=True) if pair[1].kind != "right"
    )

    # `undetermined` dominates among the deciding rules: one unknown makes the whole verdict
    # undetermined, even when everything else is met. It never rounds toward the friendlier answer.
    if any(r.result == "undetermined" for r in deciding):
        status: Status = "undetermined"
    elif any(r.result == "not_met" for r in deciding):
        status = "not_met"
    else:
        status = "met"

    blockers = tuple(r.requirement_id for r in deciding if r.result == "not_met")

    # Ordered by the domain pass, and de-duplicated while keeping first appearance — so the input
    # that unblocks the earliest-blocking domain is named first.
    # Only what would actually resolve the verdict. A right's input is optional by construction —
    # listing it as "needed" would promise that answering it changes the outcome.
    needs: list[str] = []
    for req in deciding:
        for key in req.needs_input:
            if key not in needs:
                needs.append(key)

    binding = next(
        (r.domain for r in deciding if r.result != "met"),
        None,
    )

    return Verdict(
        pathway_id=pathway_id,
        status=status,
        requirements=evaluated,
        blockers=blockers,
        needs_from_user=tuple(needs),
        binding_domain=binding,
        confidence=_confidence(evaluated, by_key),
        as_of=as_of.isoformat(),
        notes=tuple(notes),
    )
