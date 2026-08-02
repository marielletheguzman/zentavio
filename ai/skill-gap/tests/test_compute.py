"""The gap's arithmetic.

Every rule in `docs/features/skill-gap-analysis.md`'s "What it never does" section is a test here,
because those are the failures that produce a *plausible* wrong answer rather than a visible one. A
gap that quietly pads itself, or orders by weight instead of prerequisites, looks entirely
reasonable and sends someone to spend months on the wrong thing.
"""

from __future__ import annotations

from skill_gap.compute import (
    SCORER_VERSION,
    compute_gap,
    order_by_prerequisites,
    scope_requirements,
    strongest_transfer,
)
from skill_gap.ports import Edge, GapRequest, HeldSkill, RequiredSkill


def require(skill: str, weight: float | None = 0.8, **kwargs: object) -> RequiredSkill:
    return RequiredSkill(
        skill_id=skill, weight=weight, cluster=kwargs.pop("cluster", "core"), **kwargs
    )  # type: ignore[arg-type]


def held(skill: str, status: str = "evidenced") -> HeldSkill:
    return HeldSkill(skill_id=skill, status=status)


def edge(from_skill: str, to_skill: str, edge_type: str, weight: float = 0.8) -> Edge:
    return Edge(from_skill_id=from_skill, to_skill_id=to_skill, edge_type=edge_type, weight=weight)


def request(**kwargs: object) -> GapRequest:
    base: dict = {"target_id": "cloud-platform-engineer", "target_kind": "career"}
    base.update(kwargs)
    return GapRequest(**base)  # type: ignore[arg-type]


class TestUnknownPath:
    """A target nobody modelled is not a gap of zero."""

    def test_an_unmodelled_target_returns_unknown(self) -> None:
        result = compute_gap(request(requirements=(), held=(held("docker"),)))
        assert result.status == "unknown"
        assert result.items == ()
        assert result.missing
        assert result.reason is not None

    def test_unknown_names_the_market_it_could_not_answer_for(self) -> None:
        # "We have no data for Berlin" and "we have no data at all" are different answers.
        result = compute_gap(
            request(requirements=(require("german", market_scope="FR"),), market="DE")
        )
        assert result.status == "unknown"
        assert "DE" in result.missing[0]

    def test_an_empty_profile_still_produces_a_gap_and_says_why_it_is_uncertain(self) -> None:
        result = compute_gap(request(requirements=(require("kubernetes"),), held=()))
        assert result.status == "ok"
        assert len(result.items) == 1
        assert result.confidence == "low"
        assert any("no skills" in m for m in result.missing)


class TestNoGap:
    def test_meeting_every_requirement_is_said_plainly(self) -> None:
        # "You're a great fit!" with no detail is a failure. `no_gap` is a real answer with the
        # held skills attached so the claim is checkable.
        result = compute_gap(request(requirements=(require("docker"),), held=(held("docker"),)))
        assert result.status == "no_gap"
        assert result.items == ()
        assert [h.skill_id for h in result.held] == ["docker"]

    def test_a_claimed_skill_does_not_close_a_gap(self) -> None:
        # The evidenced/claimed split exists so a padded skills list cannot close a gap. If this
        # ever passes with `claimed`, readiness inflates for everyone who lists without describing.
        result = compute_gap(
            request(requirements=(require("docker"),), held=(held("docker", "claimed"),))
        )
        assert result.status == "ok"
        assert [i.skill_id for i in result.items] == ["docker"]


class TestMarketScoping:
    def test_a_market_specific_requirement_is_absent_from_a_global_gap(self) -> None:
        # German is a real requirement in Berlin and simply not one for remote-worldwide. Carrying
        # it anyway would put it in every gap everywhere.
        scoped = scope_requirements((require("german", market_scope="DE"),), market=None)
        assert scoped == ()

    def test_a_market_specific_requirement_wins_over_the_global_one(self) -> None:
        scoped = scope_requirements(
            (
                require("kubernetes", weight=0.8, market_scope=None),
                require("kubernetes", weight=0.95, market_scope="DE"),
            ),
            market="DE",
        )
        assert len(scoped) == 1
        assert scoped[0].weight == 0.95

    def test_another_markets_requirement_is_dropped(self) -> None:
        scoped = scope_requirements((require("french", market_scope="FR"),), market="DE")
        assert scoped == ()


class TestCollapsing:
    def test_holding_the_broader_skill_covers_the_narrower_one(self) -> None:
        # Without this the gap double-counts and tells someone to learn what they already have
        # under another name.
        result = compute_gap(
            request(
                requirements=(require("incident-response"),),
                held=(held("sre-practices"),),
                edges=(edge("sre-practices", "incident-response", "subsumes", 0.7),),
            )
        )
        assert result.status == "no_gap"

    def test_a_claimed_broader_skill_does_not_collapse_anything(self) -> None:
        result = compute_gap(
            request(
                requirements=(require("incident-response"),),
                held=(held("sre-practices", "claimed"),),
                edges=(edge("sre-practices", "incident-response", "subsumes", 0.7),),
            )
        )
        assert [i.skill_id for i in result.items] == ["incident-response"]


class TestPartialCredit:
    def test_a_transfer_edge_gives_partial_credit_without_closing_the_gap(self) -> None:
        # A half-closed gap is still a gap. Folding the transfer into the weight would decide on
        # the user's behalf that the transfer is real for them.
        result = compute_gap(
            request(
                requirements=(require("azure"),),
                held=(held("aws"),),
                edges=(edge("aws", "azure", "transfers_to", 0.65),),
            )
        )
        assert [i.skill_id for i in result.items] == ["azure"]
        assert result.items[0].partial == 0.65
        assert result.items[0].partial_from == "aws"

    def test_the_strongest_transfer_wins_and_ties_break_stably(self) -> None:
        transfer = strongest_transfer(
            "gcp",
            frozenset({"aws", "azure"}),
            (
                edge("azure", "gcp", "transfers_to", 0.60),
                edge("aws", "gcp", "transfers_to", 0.60),
            ),
        )
        assert transfer == (0.60, "aws")

    def test_adjacency_is_not_partial_credit(self) -> None:
        # Adjacency is not evidence of competence. Treating it as credit closes gaps nobody closed.
        result = compute_gap(
            request(
                requirements=(require("kubernetes"),),
                held=(held("docker"),),
                edges=(edge("docker", "kubernetes", "adjacent_to", 0.6),),
            )
        )
        assert result.items[0].partial is None


class TestOrdering:
    def test_prerequisites_come_first_even_when_they_matter_less(self) -> None:
        # The failure this prevents: ordering by weight tells someone to learn Kubernetes before
        # containers, which is not a plan.
        result = compute_gap(
            request(
                requirements=(require("kubernetes", 0.95), require("containers", 0.5)),
                edges=(edge("kubernetes", "containers", "requires", 0.9),),
            )
        )
        assert [i.skill_id for i in result.items] == ["containers", "kubernetes"]
        assert result.items[1].prerequisites == ("containers",)

    def test_weight_orders_what_prerequisites_do_not(self) -> None:
        result = compute_gap(
            request(requirements=(require("a", 0.2), require("b", 0.9), require("c", 0.5)))
        )
        assert [i.skill_id for i in result.items] == ["b", "c", "a"]

    def test_a_prerequisite_the_person_already_has_does_not_delay_anything(self) -> None:
        result = compute_gap(
            request(
                requirements=(require("kubernetes"),),
                held=(held("containers"),),
                edges=(edge("kubernetes", "containers", "requires", 0.9),),
            )
        )
        assert [i.skill_id for i in result.items] == ["kubernetes"]
        assert result.items[0].prerequisites == ()

    def test_a_cycle_still_produces_an_answer(self) -> None:
        # A data defect in the graph must not make the feature unavailable to the person in front
        # of it. The order stops being meaningful; the gap does not stop existing.
        order = order_by_prerequisites(
            ("a", "b"),
            (edge("a", "b", "requires"), edge("b", "a", "requires")),
            {"a": 0.5, "b": 0.9},
        )
        assert sorted(order) == ["a", "b"]

    def test_an_unweighted_requirement_sorts_after_weighted_peers(self) -> None:
        # An unknown importance is not evidence of high importance.
        result = compute_gap(request(requirements=(require("a", None), require("b", 0.1))))
        assert [i.skill_id for i in result.items] == ["b", "a"]


class TestHonesty:
    def test_an_unweighted_requirement_is_listed_rather_than_defaulted(self) -> None:
        # A default weight is an invented market fact.
        result = compute_gap(
            request(requirements=(require("terraform", None),), held=(held("go"),))
        )
        assert result.items[0].weight is None
        assert result.unweighted == ("terraform",)
        assert result.confidence == "low"

    def test_unresolved_profile_phrases_are_reported(self) -> None:
        result = compute_gap(
            request(
                requirements=(require("kubernetes"),),
                held=(held("docker"),),
                unresolved=("Pulumi", "OpenTofu"),
            )
        )
        assert any("could not be resolved" in m for m in result.missing)

    def test_held_lists_only_what_is_relevant_to_this_target(self) -> None:
        # A profile's unrelated skills are not evidence about this gap, and listing them pads the
        # answer with things the user did not ask about.
        result = compute_gap(
            request(
                requirements=(require("kubernetes"),),
                held=(held("kubernetes"), held("postgresql"), held("french")),
            )
        )
        assert [h.skill_id for h in result.held] == ["kubernetes"]

    def test_confidence_is_stated_and_reflects_the_evidence(self) -> None:
        mostly_claimed = compute_gap(
            request(
                requirements=(require("kubernetes"),),
                held=(held("docker", "claimed"), held("go", "claimed"), held("aws")),
            )
        )
        assert mostly_claimed.confidence == "medium"

        mostly_evidenced = compute_gap(
            request(
                requirements=(require("kubernetes"),),
                held=(held("docker"), held("go"), held("aws", "claimed")),
            )
        )
        assert mostly_evidenced.confidence == "high"

    def test_nothing_is_invented_beyond_the_supplied_requirements(self) -> None:
        # Never pads with adjacent nice-to-haves: the gap is the scope, and padding makes a
        # reachable target look unreachable.
        result = compute_gap(
            request(
                requirements=(require("kubernetes"),),
                edges=(
                    edge("kubernetes", "helm", "adjacent_to"),
                    edge("terraform", "kubernetes", "transfers_to"),
                ),
            )
        )
        assert [i.skill_id for i in result.items] == ["kubernetes"]


class TestReproducibility:
    """Determinism is a correctness property: M1b names it not-cuttable."""

    def _rich_request(self) -> GapRequest:
        return request(
            requirements=(
                require("kubernetes", 0.95),
                require("containers", 0.92),
                require("terraform", 0.78),
                require("aws", 0.65),
                require("helm", 0.58),
                require("german", 0.7, market_scope="DE"),
                require("observability", None),
            ),
            held=(held("docker"), held("linux-fundamentals"), held("azure", "claimed")),
            edges=(
                edge("kubernetes", "containers", "requires", 0.9),
                edge("helm", "kubernetes", "requires", 0.95),
                edge("docker", "containers", "tooling_of", 0.9),
                edge("azure", "aws", "transfers_to", 0.7),
                edge("docker", "kubernetes", "adjacent_to", 0.6),
            ),
            market="DE",
            knowledge_as_of="2026-08-03T00:00:00Z",
        )

    def test_the_same_inputs_produce_the_same_gap(self) -> None:
        first = compute_gap(self._rich_request())
        for _ in range(20):
            assert compute_gap(self._rich_request()) == first

    def test_the_order_of_the_inputs_does_not_change_the_answer(self) -> None:
        # Rows arrive from a database in whatever order the planner chose. A gap that depends on
        # that is irreproducible from its recorded scorerVersion.
        base = self._rich_request()
        shuffled = GapRequest(
            target_id=base.target_id,
            target_kind=base.target_kind,
            requirements=tuple(reversed(base.requirements)),
            held=tuple(reversed(base.held)),
            edges=tuple(reversed(base.edges)),
            market=base.market,
            knowledge_as_of=base.knowledge_as_of,
        )
        assert compute_gap(shuffled) == compute_gap(base)

    def test_every_result_records_the_scorer_that_produced_it(self) -> None:
        result = compute_gap(self._rich_request())
        assert result.scorer_version == SCORER_VERSION
        assert result.knowledge_as_of == "2026-08-03T00:00:00Z"

    def test_positions_are_dense_and_start_at_one(self) -> None:
        result = compute_gap(self._rich_request())
        assert [i.position for i in result.items] == list(range(1, len(result.items) + 1))
