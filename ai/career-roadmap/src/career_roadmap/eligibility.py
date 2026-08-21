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

**Routes (ADR-0024).** A pathway may offer more than one way in, and a rule may belong to one of
them. A requirement declaring ``applies_to.route`` belongs to that route; one declaring none is
pathway-wide and belongs to every route. The pathway is satisfied when **any** route is, and the
verdict names the route it used. A route the person cannot use is ``not_applicable`` — not a
failure, and never reported as one.

**Route ids are opaque.** They arrive in the data and mean nothing here. This module must never
construct one, infer one, or branch on a particular value — that is what keeps the evaluator
generic, and an AST test enforces it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

#: What a comparison against a person's facts can conclude. Shared by every level that aggregates.
Decided = Literal["met", "not_met", "undetermined"]
#: A requirement's result. ``not_applicable`` belongs to a rule on a route this person cannot use —
#: not a failure, and never rendered as one (ADR-0024).
Result = Literal["met", "not_met", "undetermined", "not_applicable"]
#: A pathway's status. ``unknown`` is pathway-only: nothing on file, or a licence-gated profession
#: with no recognition rule. It never means "no route is open" — that is ``not_met``.
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


#: The fact naming where a person's qualification was awarded (ADR-0029). Named once here because
#: the evaluator reads it structurally — to decide *which rules are about this person* — rather than
#: comparing it against a threshold the way every other fact is used.
ORIGIN_FACT_KEY = "qualification_awarded_in"


def _codes(value: Any) -> tuple[str, ...] | None:
    """A jurisdiction scope as a tuple of codes, or ``None`` when it says nothing.

    Accepts a list of strings, and a bare string as the one-element case, because a connector
    writing ``"PH"`` where it meant ``["PH"]`` has expressed the same intent and refusing it would
    turn a harmless shape difference into a rule that applies to nobody.

    Anything else — a number, an empty list, a list of numbers — is ``None``: **broader, not
    narrower**. A scope nobody can read must not silently exclude the people the rule was written
    for, and a rule that quietly applies to no one is invisible in a way a wrong verdict is not.
    """
    if isinstance(value, str):
        return (value.strip().upper(),) if value.strip() != "" else None
    if isinstance(value, list):
        codes = tuple(
            item.strip().upper() for item in value if isinstance(item, str) and item.strip() != ""
        )
        return codes or None
    return None


def _normalised(value: Any) -> str | None:
    """A person's or a pathway's jurisdiction code, comparably. ``None`` when there is not one."""
    return value.strip().upper() if isinstance(value, str) and value.strip() != "" else None


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
    #: Occupation lists, qualification levels — and the four keys this module reads: ``route``
    #: (ADR-0024), ``anyOf`` (its amendment), and ``origin_jurisdiction`` /
    #: ``destination_jurisdiction`` (ADR-0029). Everything else here is carried for the caller's
    #: benefit and ignored.
    applies_to: dict[str, Any] = field(default_factory=dict)

    @property
    def route(self) -> str | None:
        """The route this rule belongs to, or ``None`` when it is pathway-wide.

        A non-string or empty value is treated as absent rather than as an error: a malformed
        ``applies_to`` should make a rule pathway-wide, which is the conservative reading, not make
        the whole pathway unevaluable.
        """
        value = self.applies_to.get("route")
        return value if isinstance(value, str) and value != "" else None

    @property
    def origin_jurisdictions(self) -> tuple[str, ...] | None:
        """Which origins this rule is for, or ``None`` when it is for all of them (ADR-0029).

        The origin is where the person's **qualification** was awarded, never their nationality: a
        citizen of one country holding another's nursing degree has that degree's recognition
        problem, not their passport's.

        ``None`` means the rule applies whatever the origin — "absent means broader, not narrower",
        the same conservative reading :attr:`route` gets. A malformed value is read as absent for
        the same reason: a typo in one rule must not silently exclude the people it was written for.
        """
        return _codes(self.applies_to.get("origin_jurisdiction"))

    @property
    def destination_jurisdictions(self) -> tuple[str, ...] | None:
        """Which destinations this rule is for, or ``None`` for all of them (ADR-0029).

        The mirror of :attr:`origin_jurisdictions`, for rules an origin state imposes: an exit
        clearance may have different terms depending on where the person is going. Same
        absent-means-broader reading, for the same reason.
        """
        return _codes(self.applies_to.get("destination_jurisdiction"))

    @property
    def any_of(self) -> str | None:
        """The any-of group this condition belongs to, or ``None`` (ADR-0024 rule 10).

        Members of a group are **alternatives to each other**: the group is met when any one member
        is met, and fails only when every member fails. Luxembourg's Art. 45 (2) f) is the case —
        one qualification condition satisfiable by a diploma, by ICT experience, or by five years
        in another profession. Those are not separate legal consequences, so they are not routes;
        and failing all three is ``not_met`` rather than ``not_applicable``, so they are not gates.

        Read exactly like ``route``: a non-string or empty value is treated as absent, because a
        malformed ``applies_to`` must not make a pathway unevaluable.
        """
        value = self.applies_to.get("anyOf")
        return value if isinstance(value, str) and value != "" else None


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
class RouteOutcome:
    """One way into a pathway, and how far this person gets along it.

    ``not_applicable`` is the state that earns this type. A person holding a degree has no use for
    Germany's experience route, and telling them they *failed* it would be false — they were never
    on it. That distinction cannot survive in a single aggregate, which is why routes are reported
    individually as well as aggregated.
    """

    route: str
    status: Result
    blockers: tuple[str, ...]
    needs_from_user: tuple[str, ...]
    #: Every requirement considered for this route, pathway-wide rules included.
    requirement_ids: tuple[str, ...]
    #: Why the route is closed, when it is. ``None`` whenever it is open.
    reason: str | None = None


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
    #: The route this verdict is about: the one that is met, else the nearest open one. ``None``
    #: for a pathway whose rules declare no routes, which is every pathway until one does.
    route: str | None = None
    #: Every route, including the ones that do not apply. Empty when the pathway has no routes.
    routes: tuple[RouteOutcome, ...] = field(default_factory=tuple)


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
    # `unit` covers the non-monetary thresholds — months of contract, years of experience. It is
    # here for the same reason `currency` is: 6 months against 6 years is a confident wrong answer.
    for key in ("currency", "period", "basis", "unit"):
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
        return _evaluate_boolean(requirement, facts, common)

    # `document-present` and `manual` are deliberately not decided here. A document check needs the
    # document, and `manual` means an authority decides — asserting either would be inventing a
    # verdict.
    return EvaluatedRequirement(
        **common,
        result="undetermined",
        reason=f"'{requirement.evaluation}' requires review that this evaluator does not perform",
        needs_input=requirement.needs_input,
    )


def _evaluate_boolean(
    requirement: Requirement, facts: dict[str, PersonFact], common: dict[str, Any]
) -> EvaluatedRequirement:
    """Decide a yes-or-no rule, and only from an actual yes or no.

    ``bool("no")`` is ``True``. A presentation string reaching here decided the rule **met** for
    somebody who had just said the opposite — a browser found exactly that on 2026-08-11, against
    Germany's qualification rule.

    **The fix is at the write boundary**, where a fact is typed against its catalogue ``value_type``
    (`docs/database/entities/person-fact.md`). This refusal is the same one the numeric path already
    makes for an uncomparable value, and it exists so a row written before that boundary did cannot
    be reinterpreted into a verdict here.
    """
    fact = facts[requirement.needs_input[0]]

    if not isinstance(fact.value, bool) or not isinstance(requirement.value, bool):
        return EvaluatedRequirement(
            **common,
            result="undetermined",
            reason="the answer on file is not a yes or a no, so it cannot decide this rule",
            needs_input=requirement.needs_input,
        )

    return EvaluatedRequirement(
        **common,
        result="met" if fact.value is requirement.value else "not_met",
        basis=f"{requirement.needs_input[0]} is {fact.value!r}",
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


ScopeStatus = Literal["applies", "excluded", "unanswered"]


def scope_status(
    requirement: Requirement, *, origin: str | None, destination: str | None
) -> ScopeStatus:
    """Whether a rule is about this person at all (ADR-0029).

    Three answers, and the third is the one that keeps the model honest:

    ``applies``
        The rule declares no scope, or declares one containing the person's value.

    ``excluded``
        The rule declares a scope the person is outside. It is **not** a rule they failed — it was
        never about them, which is why it becomes ``not_applicable`` rather than ``not_met``.

    ``unanswered``
        The rule declares a scope and we do not know the person's value. We cannot tell whether it
        applies, and guessing in either direction is a fabricated verdict: assuming it applies
        invents a hurdle, assuming it does not invents compliance. The answer is ``undetermined``
        with the question named.

    The destination is a property of the pathway being evaluated rather than something the person
    tells us, so a destination-scoped rule with no destination on the request is ``unanswered`` too
    — but nothing the person can answer. The caller distinguishes those.
    """
    origins = requirement.origin_jurisdictions
    if origins is not None:
        if origin is None:
            return "unanswered"
        if origin not in origins:
            return "excluded"

    destinations = requirement.destination_jurisdictions
    if destinations is not None:
        if destination is None:
            return "unanswered"
        if destination not in destinations:
            return "excluded"

    return "applies"


def _out_of_scope(requirement: Requirement, common: dict[str, Any]) -> EvaluatedRequirement:
    """A rule this person is outside the scope of. Never a failure they can act on."""
    return EvaluatedRequirement(
        **common,
        result="not_applicable",
        reason="this rule is for qualifications from elsewhere, so it does not apply to you",
    )


def _scope_unanswered(
    requirement: Requirement, common: dict[str, Any], *, answerable: bool
) -> EvaluatedRequirement:
    """A rule we cannot place yet. Undetermined, and it says what is missing."""
    if answerable:
        return EvaluatedRequirement(
            **common,
            result="undetermined",
            reason=(
                "whether this rule applies to you depends on where your qualification was awarded, "
                "which is not on file"
            ),
            needs_input=(ORIGIN_FACT_KEY,),
        )
    return EvaluatedRequirement(
        **common,
        result="undetermined",
        reason=(
            "this rule applies only to particular destinations and the destination was not stated "
            "on this request"
        ),
    )


def _scoped(
    requirement: Requirement,
    facts: dict[str, PersonFact],
    *,
    origin: str | None,
    destination: str | None,
) -> EvaluatedRequirement:
    """Evaluate one requirement, or say why it was not evaluated against this person."""
    status = scope_status(requirement, origin=origin, destination=destination)
    if status == "applies":
        return evaluate_requirement(requirement, facts)

    common = {
        "requirement_id": requirement.requirement_id,
        "domain": requirement.domain,
        "imposed_by": requirement.imposed_by,
        "authority": requirement.authority,
        "source_url": requirement.source_url,
        "effective_from": requirement.effective_from.isoformat(),
    }

    if status == "excluded":
        return _out_of_scope(requirement, common)

    # `unanswered` is answerable by the person exactly when it is the origin that is missing.
    return _scope_unanswered(
        requirement,
        common,
        answerable=requirement.origin_jurisdictions is not None and origin is None,
    )


def evaluate_pathway(
    pathway_id: str | None,
    requirements: list[Requirement],
    facts: list[PersonFact],
    as_of: date,
    *,
    licence_gated: bool = False,
    destination: str | None = None,
) -> Verdict:
    """Evaluate every applicable requirement and aggregate one verdict.

    Returns ``unknown`` — not ``met`` — when there is nothing to evaluate, and when a licence-gated
    profession has no recognition requirement **that could be about this person** on file. Returning
    a visa-only verdict to a nurse whose licence does not transfer is the most harmful output this
    product could produce (`docs/architecture/immigration.md`).

    ``destination`` is the jurisdiction the pathway leads to, used only to place rules an origin
    state scopes by destination (ADR-0029). It is not compared against anything the person said.
    """
    by_key = {fact.key: fact for fact in facts}
    origin_fact = by_key.get(ORIGIN_FACT_KEY)
    origin = _normalised(origin_fact.value) if origin_fact is not None else None
    destination_code = _normalised(destination)

    applicable = [r for r in requirements if applicable_on(r, as_of)]
    order = {domain: i for i, domain in enumerate(DOMAIN_ORDER)}
    applicable.sort(key=lambda r: (order.get(r.domain, len(DOMAIN_ORDER)), r.requirement_id))

    evaluated = tuple(
        _scoped(r, by_key, origin=origin, destination=destination_code) for r in applicable
    )
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

    # **Scope decides what counts as "on file" here** (ADR-0029). A recognition rule written for
    # qualifications from somewhere else is not a recognition rule for this person, and treating it
    # as one would hand a nurse the visa answer on the strength of a rule that was never about her —
    # the precise failure this guard exists to prevent. A rule we cannot place because she has not
    # said where she qualified *does* count: it evaluates to `undetermined` and names the question,
    # which is an answer she can move.
    recognition_in_scope = [
        requirement
        for result, requirement in zip(evaluated, applicable, strict=True)
        if requirement.domain == "recognition" and result.result != "not_applicable"
    ]

    if licence_gated and not recognition_in_scope:
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

    pairs = tuple(zip(evaluated, applicable, strict=True))

    if not any(req.route is not None for _, req in pairs):
        # No rule declares a route, so the pathway has exactly one implicit way in — itself. This
        # branch is today's behaviour, unchanged, and a test asserts it stays identical (ADR-0024
        # rule 2). It is also what makes the whole change additive: stored rows keep working.
        return _verdict(
            pathway_id, pairs, _aggregate(pairs), by_key=by_key, as_of=as_of, notes=notes
        )

    outcomes = _route_outcomes(pairs)
    reported = _reported_route(outcomes)

    # A rule belonging only to a closed route is reported as `not_applicable` rather than as
    # whatever it evaluated to. Telling someone they "failed" the €45 934,20 threshold on a route
    # their occupation never opened is false, and it is the exact confusion ADR-0024 rule 3 exists
    # to prevent. The gating right keeps its own result — that is *why* the route is closed.
    closed = {o.route for o in outcomes if o.status == "not_applicable"}
    open_routes = {o.route for o in outcomes if o.status != "not_applicable"}
    evaluated = tuple(
        _as_not_applicable(result, req.route)
        if req.route is not None
        and req.route in closed
        and req.route not in open_routes
        and req.kind != "right"
        else result
        for result, req in pairs
    )

    if any(o.status == "met" for o in outcomes):
        status: Status = "met"
    elif any(o.status == "undetermined" for o in outcomes):
        status = "undetermined"
    else:
        # Every route is closed or failed. `not_met` either way: "no way in is open to you" is an
        # answer about this person, and `unknown` would say we have no data, which is not true.
        status = "not_met"

    if all(o.status == "not_applicable" for o in outcomes):
        notes.append("no route into this pathway is open on the facts on file")

    binding = next(
        (
            result.domain
            for result, req in pairs
            if result.result not in ("met", "not_applicable")
            and (req.route is None or reported is None or req.route == reported.route)
        ),
        None,
    )

    return Verdict(
        pathway_id=pathway_id,
        status=status,
        requirements=evaluated,
        blockers=() if status == "met" else (reported.blockers if reported else ()),
        needs_from_user=reported.needs_from_user if reported else (),
        binding_domain=None if status == "met" else binding,
        confidence=_confidence(evaluated, by_key),
        as_of=as_of.isoformat(),
        notes=tuple(notes),
        route=reported.route if reported else None,
        routes=outcomes,
    )


def _as_not_applicable(result: EvaluatedRequirement, route: str | None) -> EvaluatedRequirement:
    return EvaluatedRequirement(
        requirement_id=result.requirement_id,
        domain=result.domain,
        imposed_by=result.imposed_by,
        result="not_applicable",
        authority=result.authority,
        source_url=result.source_url,
        effective_from=result.effective_from,
        reason=f"belongs to route {route!r}, which is not open on the facts on file",
    )


_Pairs = tuple[tuple[EvaluatedRequirement, Requirement], ...]


def _collapse_any_of(pairs: _Pairs) -> tuple[EvaluatedRequirement, ...]:
    """Replace each any-of group with the one result it contributes (ADR-0024 rule 10).

    A group is **one condition** wherever conditions are aggregated, so it is collapsed before
    anything counts `not_met`s. Members keep their own results in the response — the person is
    still shown each alternative and how they did on it — but only this collapsed result decides.

    ``met`` if any member is met; otherwise ``undetermined`` if any is undetermined, because an
    unanswered alternative is never a failure; otherwise ``not_met``, and only when **every** member
    failed.

    ``not_applicable`` members are excluded first. A member that does not apply can neither satisfy
    the condition nor fail it, and a group with nothing left is itself ``not_applicable`` rather
    than ``not_met`` — the distinction ADR-0024 rule 3 draws, applied inside the group.

    **The collapsed result carries the group id, never a member's.** Telling someone "you lack a
    degree" when the requirement was *degree or experience* is the failure mode rule 10 exists to
    prevent, so the blocker and the reason both name the group.
    """
    grouped: dict[str, list[EvaluatedRequirement]] = {}
    out: list[EvaluatedRequirement] = []

    for result, req in pairs:
        group = req.any_of
        if group is None:
            out.append(result)
        else:
            grouped.setdefault(group, []).append(result)

    # Sorted, for the same reason route ids are: one input, one ordering.
    for group in sorted(grouped):
        members = grouped[group]
        live = [m for m in members if m.result != "not_applicable"]

        if not live:
            status: Result = "not_applicable"
            reason = "no alternative applies: " + ", ".join(m.requirement_id for m in members)
            needs: tuple[str, ...] = ()
        elif any(m.result == "met" for m in live):
            status = "met"
            met = next(m for m in live if m.result == "met")
            reason = f"satisfied by {met.requirement_id}"
            needs = ()
        elif any(m.result == "undetermined" for m in live):
            status = "undetermined"
            # Rule 5, one level down: ask for the shortest path first. The other open alternatives
            # keep their own results in the response, so nothing is hidden by choosing one here.
            nearest = min(
                (m for m in live if m.result == "undetermined"),
                key=lambda m: (len(m.needs_input), m.requirement_id),
            )
            reason = "not yet answered: " + ", ".join(
                m.requirement_id for m in live if m.result == "undetermined"
            )
            needs = nearest.needs_input
        else:
            status = "not_met"
            reason = "no alternative is met: " + ", ".join(m.requirement_id for m in live)
            needs = ()

        first = members[0]
        out.append(
            EvaluatedRequirement(
                requirement_id=group,
                domain=first.domain,
                imposed_by=first.imposed_by,
                result=status,
                authority=first.authority,
                source_url=first.source_url,
                effective_from=first.effective_from,
                reason=reason,
                needs_input=needs,
            )
        )

    return tuple(out)


def _aggregate(pairs: _Pairs) -> tuple[Decided, tuple[str, ...], tuple[str, ...]]:
    """Aggregate one set of rules: the status, the blockers, and the inputs that would move it.

    Used for a whole routeless pathway and for one route, because they are the same computation —
    a route *is* a pathway's rules narrowed to one way in.

    A `right` is a benefit the statute grants, not a hurdle. Within this set it does not decide:
    Germany's reduced-threshold occupation list can only ever lower the bar, and letting an
    unanswered one block would reject exactly the people the provision is generous to. Whether the
    right *opens* this route is decided by the caller, before this runs.
    """
    deciding = _collapse_any_of(tuple(pair for pair in pairs if pair[1].kind != "right"))

    # `undetermined` dominates: one unknown makes the whole thing undetermined even when everything
    # else is met. It never rounds toward the friendlier answer.
    if any(r.result == "undetermined" for r in deciding):
        status: Decided = "undetermined"
    elif any(r.result == "not_met" for r in deciding):
        status = "not_met"
    else:
        status = "met"

    blockers = tuple(r.requirement_id for r in deciding if r.result == "not_met")

    # Ordered by the domain pass and de-duplicated keeping first appearance, so the input that
    # unblocks the earliest-blocking domain is named first. Only what would actually resolve the
    # verdict: a right's input is optional by construction, and listing it as "needed" would
    # promise that answering it changes the outcome.
    needs: list[str] = []
    for result in deciding:
        for key in result.needs_input:
            if key not in needs:
                needs.append(key)

    return status, blockers, tuple(needs)


def _route_outcomes(pairs: _Pairs) -> tuple[RouteOutcome, ...]:
    """Evaluate every route the data declares.

    Route ids are discovered from the rules and sorted, never constructed here (ADR-0024 rule 10).
    Sorted so two identical inputs produce one ordering — a verdict that reorders between calls is
    not reproducible, and reproducibility is the whole reason `as_of` is required.
    """
    shared = tuple(pair for pair in pairs if pair[1].route is None)
    route_ids = sorted({req.route for _, req in pairs if req.route is not None})

    outcomes: list[RouteOutcome] = []
    for route_id in route_ids:
        members = tuple(pair for pair in pairs if pair[1].route == route_id) + shared
        gates = tuple(
            result for result, req in members if req.kind == "right" and req.route == route_id
        )

        # **Gates are ANY; conditions are ALL** (ADR-0024 rule 6). A gate answers *may this person
        # attempt this route*; a condition answers *do they satisfy it*. § 18g Abs. 1 S. 2 reaches
        # one legal consequence — the reduced salary threshold — through either a listed occupation
        # **or** a degree earned within three years, so requiring both would deny every recent
        # graduate outside the listed groups.
        if gates and not any(g.result == "met" for g in gates):
            unproven = tuple(g for g in gates if g.result == "undetermined")
            if not unproven:
                # Every way of opening this route has been asked and answered no. Closed — not
                # failed. The person was never on it.
                outcomes.append(
                    RouteOutcome(
                        route=route_id,
                        status="not_applicable",
                        blockers=(),
                        needs_from_user=(),
                        requirement_ids=tuple(result.requirement_id for result, _ in members),
                        reason=(
                            "no qualifying circumstance applies: "
                            + ", ".join(g.requirement_id for g in gates)
                        ),
                    )
                )
                continue

            # Some gate is still unanswered, so whether this route exists for this person is not
            # yet known. Undetermined, never met — and its questions are worth asking, because an
            # answer decides whether this way in is open at all.
            _, blockers, needs = _aggregate(members)
            gate_needs = tuple(key for g in unproven for key in g.needs_input)
            outcomes.append(
                RouteOutcome(
                    route=route_id,
                    status="undetermined",
                    blockers=blockers,
                    needs_from_user=tuple(dict.fromkeys((*gate_needs, *needs))),
                    requirement_ids=tuple(result.requirement_id for result, _ in members),
                )
            )
            continue

        status, blockers, needs = _aggregate(members)

        outcomes.append(
            RouteOutcome(
                route=route_id,
                status=status,
                blockers=blockers,
                needs_from_user=needs,
                requirement_ids=tuple(result.requirement_id for result, _ in members),
            )
        )

    return tuple(outcomes)


def _reported_route(outcomes: tuple[RouteOutcome, ...]) -> RouteOutcome | None:
    """The route the verdict is about.

    A met route if there is one. Otherwise the **nearest open route** — the undetermined one asking
    for the fewest further answers (ADR-0024 rule 5). The others are still reported in full; this
    only decides which one's questions the product puts first, because the union of every route's
    questions is a form nobody finishes.

    Ties break on route id so the choice is stable across identical calls.
    """
    met = [o for o in outcomes if o.status == "met"]
    if met:
        return min(met, key=lambda o: o.route)

    open_routes = [o for o in outcomes if o.status == "undetermined"]
    if open_routes:
        return min(open_routes, key=lambda o: (len(o.needs_from_user), o.route))

    failed = [o for o in outcomes if o.status == "not_met"]
    if failed:
        return min(failed, key=lambda o: (len(o.blockers), o.route))

    return None


def _verdict(
    pathway_id: str | None,
    pairs: _Pairs,
    aggregate: tuple[Decided, tuple[str, ...], tuple[str, ...]],
    *,
    by_key: dict[str, PersonFact],
    as_of: date,
    notes: list[str],
) -> Verdict:
    """The routeless verdict.

    One implicit way in, which is every pathway until one of them declares a route.
    """
    status, blockers, needs = aggregate
    evaluated = tuple(result for result, _ in pairs)
    # Rights are excluded here exactly as they were before routes existed: a benefit nobody claimed
    # is not what binds a verdict.
    binding = next(
        (result.domain for result, req in pairs if req.kind != "right" and result.result != "met"),
        None,
    )

    return Verdict(
        pathway_id=pathway_id,
        status=status,
        requirements=evaluated,
        blockers=blockers,
        needs_from_user=needs,
        binding_domain=binding,
        confidence=_confidence(evaluated, by_key),
        as_of=as_of.isoformat(),
        notes=tuple(notes),
    )
