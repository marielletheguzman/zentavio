"""Readiness arithmetic, and the honesty rules around it.

The number is easy. What these tests actually guard is everything the number is not allowed to be:
bare, invented, confidently wrong about a sparse profile, or unmoved by a correction.
"""

from __future__ import annotations

from skill_gap.compute import compute_gap
from skill_gap.ports import Edge, GapRequest, HeldSkill, RequiredSkill
from skill_gap.readiness import CLAIMED_CREDIT, SCORER_VERSION, compute_readiness


def require(skill: str, weight: float | None = 1.0, cluster: str = "core") -> RequiredSkill:
    return RequiredSkill(skill_id=skill, weight=weight, cluster=cluster)


def held(skill: str, status: str = "evidenced") -> HeldSkill:
    return HeldSkill(skill_id=skill, status=status)


def edge(from_skill: str, to_skill: str, edge_type: str, weight: float = 0.8) -> Edge:
    return Edge(from_skill_id=from_skill, to_skill_id=to_skill, edge_type=edge_type, weight=weight)


def request(**kwargs: object) -> GapRequest:
    base: dict = {"target_id": "cloud-platform-engineer", "target_kind": "career"}
    base.update(kwargs)
    return GapRequest(**base)  # type: ignore[arg-type]


def readiness_for(req: GapRequest):
    return compute_readiness(req, compute_gap(req).items)


class TestTheNumber:
    def test_holding_everything_evidenced_is_full_readiness(self) -> None:
        result = readiness_for(
            request(requirements=(require("a"), require("b")), held=(held("a"), held("b")))
        )
        assert result.score == 1.0

    def test_holding_nothing_relevant_is_zero_not_unknown(self) -> None:
        # Zero is a real answer when we *do* know: the profile has skills, none of them count.
        # That is different from having no profile at all.
        result = readiness_for(request(requirements=(require("a"),), held=(held("unrelated"),)))
        assert result.status == "ok"
        assert result.score == 0.0

    def test_weights_decide_how_much_each_requirement_moves_the_number(self) -> None:
        # 0.9 of 1.0 held → 0.9/(0.9+0.1)
        result = readiness_for(
            request(requirements=(require("a", 0.9), require("b", 0.1)), held=(held("a"),))
        )
        assert result.score == 0.9

    def test_a_claimed_skill_counts_for_less_than_an_evidenced_one(self) -> None:
        evidenced = readiness_for(request(requirements=(require("a"),), held=(held("a"),)))
        claimed = readiness_for(request(requirements=(require("a"),), held=(held("a", "claimed"),)))
        assert evidenced.score == 1.0
        assert claimed.score == CLAIMED_CREDIT
        assert claimed.score < evidenced.score

    def test_a_transfer_edge_gives_partial_credit(self) -> None:
        result = readiness_for(
            request(
                requirements=(require("azure"),),
                held=(held("aws"),),
                edges=(edge("aws", "azure", "transfers_to", 0.65),),
            )
        )
        assert result.score == 0.65

    def test_subsumption_credits_fully(self) -> None:
        result = readiness_for(
            request(
                requirements=(require("incident-response"),),
                held=(held("sre-practices"),),
                edges=(edge("sre-practices", "incident-response", "subsumes", 0.7),),
            )
        )
        assert result.score == 1.0

    def test_credit_is_the_best_basis_not_the_sum_of_them(self) -> None:
        # Holding a skill *and* a transfer edge into it does not make someone more than fully
        # credited. Summing would push the score above 1.
        result = readiness_for(
            request(
                requirements=(require("kubernetes"),),
                held=(held("kubernetes"), held("docker")),
                edges=(edge("docker", "kubernetes", "transfers_to", 0.8),),
            )
        )
        assert result.score == 1.0


class TestTheCorrectionLoop:
    """M1c's stated verification: the correction from M1a moves the number, explicably."""

    def _profile(self, terraform_status: str) -> GapRequest:
        return request(
            requirements=(require("terraform", 0.5), require("kubernetes", 0.5)),
            held=(held("terraform", terraform_status), held("kubernetes")),
        )

    def test_correcting_an_overclaim_lowers_readiness(self) -> None:
        # The whole point of the correction path: a person says "I listed Terraform but never used
        # it", and the number they are shown goes down. If it did not, the correction would be
        # theatre.
        before = readiness_for(self._profile("evidenced"))
        after = readiness_for(self._profile("claimed"))
        assert before.score == 1.0
        assert after.score < before.score
        assert after.score == 0.5 + 0.5 * CLAIMED_CREDIT

    def test_the_change_is_explicable_from_the_terms(self) -> None:
        # Not just that it moved — that you can point at *which* term moved and why.
        after = readiness_for(self._profile("claimed"))
        terraform = next(t for t in after.terms if t.skill_id == "terraform")
        assert terraform.basis == "claimed"
        assert terraform.credit == CLAIMED_CREDIT
        assert terraform.source == "terraform"

    def test_every_term_names_its_basis_and_contribution(self) -> None:
        result = readiness_for(
            request(
                requirements=(require("a", 0.4), require("b", 0.6)),
                held=(held("a"),),
            )
        )
        bases = {t.skill_id: t.basis for t in result.terms}
        assert bases == {"a": "evidenced", "b": "missing"}
        # The arithmetic is checkable by hand, which is what makes it arguable.
        assert sum(t.contribution for t in result.terms) == result.score * sum(
            t.weight for t in result.terms
        )


class TestHonesty:
    def test_a_profileless_person_gets_unknown_and_the_input_that_resolves_it(self) -> None:
        # M1c's not-cuttable rule. A zero here reads as "you are not ready" when the truth is
        # "we have not been told anything about you".
        result = readiness_for(request(requirements=(require("a"),), held=()))
        assert result.status == "unknown"
        assert result.score is None
        assert "no skills" in result.missing[0]
        assert result.reason is not None
        assert "Upload a résumé" in result.reason

    def test_an_unmodelled_target_is_unknown_rather_than_zero(self) -> None:
        result = readiness_for(request(requirements=(), held=(held("a"),)))
        assert result.status == "unknown"
        assert result.score is None

    def test_requirements_with_no_weight_are_excluded_rather_than_defaulted(self) -> None:
        # A default weight would move the score by a number nobody chose.
        result = readiness_for(
            request(requirements=(require("a", 1.0), require("b", None)), held=(held("a"),))
        )
        assert result.score == 1.0
        assert any("no weight recorded" in m for m in result.missing)
        assert result.confidence == "low"

    def test_a_target_whose_requirements_are_all_unweighted_is_unknown(self) -> None:
        result = readiness_for(request(requirements=(require("a", None),), held=(held("a"),)))
        assert result.status == "unknown"
        assert result.score is None

    def test_no_timeline_is_invented(self) -> None:
        # `career-philosophy.md`: optimistic timelines are the most damaging thing a career
        # platform can produce, because a person reorganises their life around them. There is no
        # time-to-competence data, so there is no estimate — and the reason is stated.
        result = readiness_for(request(requirements=(require("a"),), held=(held("a"),)))
        assert result.estimated_time_to_ready is None
        assert "not estimated" in result.time_to_ready_basis

    def test_no_binding_constraint_is_asserted_without_computing_one(self) -> None:
        result = readiness_for(request(requirements=(require("a"),), held=(held("a"),)))
        assert result.binding_constraint is None
        assert any("not modelled yet" in m for m in result.missing)

    def test_the_score_says_it_is_about_skills_only(self) -> None:
        # "You are 80% ready" invites reading it as "80% likely to be hired". It is not.
        result = readiness_for(request(requirements=(require("a"),), held=(held("a"),)))
        assert any("rather than whether you would be hired" in m for m in result.missing)

    def test_the_remainder_is_literally_the_gap(self) -> None:
        # Two answers to one question on the same screen is worse than one incomplete answer.
        req = request(
            requirements=(require("a", 0.5), require("b", 0.5)),
            held=(held("a"),),
        )
        gap = compute_gap(req)
        result = compute_readiness(req, gap.items)
        assert [r.skill_id for r in result.remaining] == [i.skill_id for i in gap.items]
        assert [r.position for r in result.remaining] == [i.position for i in gap.items]

    def test_a_thin_profile_never_reports_high_confidence(self) -> None:
        # One evidenced skill against a whole track can produce a plausible-looking number. The
        # number may even be right; our confidence in it should not be high.
        result = readiness_for(
            request(
                requirements=tuple(require(f"s{i}", 0.5) for i in range(10)),
                held=(held("s0"),),
            )
        )
        assert result.confidence in {"low", "medium"}

    def test_a_mostly_claimed_profile_never_reports_high_confidence(self) -> None:
        result = readiness_for(
            request(
                requirements=(require("a"), require("b")),
                held=(held("a", "claimed"), held("b", "claimed"), held("c")),
            )
        )
        assert result.confidence == "medium"


class TestReproducibility:
    def test_the_same_inputs_produce_the_same_score(self) -> None:
        req = request(
            requirements=(require("a", 0.3), require("b", 0.7)),
            held=(held("a"), held("c", "claimed")),
            edges=(edge("c", "b", "transfers_to", 0.4),),
        )
        first = readiness_for(req)
        for _ in range(10):
            assert readiness_for(req) == first

    def test_every_result_records_its_scorer(self) -> None:
        result = readiness_for(request(requirements=(require("a"),), held=(held("a"),)))
        assert result.scorer_version == SCORER_VERSION

    def test_input_order_does_not_change_the_score(self) -> None:
        base = request(
            requirements=(require("a", 0.3), require("b", 0.7)),
            held=(held("a"), held("b", "claimed")),
        )
        shuffled = GapRequest(
            target_id=base.target_id,
            target_kind=base.target_kind,
            requirements=tuple(reversed(base.requirements)),
            held=tuple(reversed(base.held)),
            edges=base.edges,
        )
        assert readiness_for(shuffled).score == readiness_for(base).score
