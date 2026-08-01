"""The parser's deterministic half.

Every rule in ``docs/features/resume-parsing.md``'s "What it never does" section is a test here,
because those are the failures that produce a *plausible* wrong answer rather than a visible one.
"""

from __future__ import annotations

import pytest
from compute import (
    ParseResult,
    extract_skills,
    normalize_phrase,
    parse,
    segment,
)
from ports import ExtractedText, RegisteredSkill


class FakeRegistry:
    """A closed set, supplied the way the real one will be."""

    def __init__(self, skills: tuple[RegisteredSkill, ...]) -> None:
        self._skills = skills

    def all_skills(self) -> tuple[RegisteredSkill, ...]:
        return self._skills


def skill(slug: str, name: str, *aliases: str) -> RegisteredSkill:
    keys = {normalize_phrase(a) for a in (name, *aliases)}
    return RegisteredSkill(slug=slug, name=name, kind="technology", aliases=frozenset(keys))


REGISTRY = FakeRegistry(
    (
        skill("kubernetes", "Kubernetes", "k8s", "Kubernetes (K8s)"),
        skill("terraform", "Terraform", "tf"),
        skill("go", "Go", "golang"),
        skill("gcp", "Google Cloud Platform", "google cloud"),
        skill("postgresql", "PostgreSQL", "postgres"),
    )
)


def text(body: str) -> ExtractedText:
    return ExtractedText(text=body)


class TestNormalizePhrase:
    def test_keeps_plus_and_hash_because_they_are_the_name(self) -> None:
        assert normalize_phrase("C++") == "c++"
        assert normalize_phrase("C#") == "c#"
        assert normalize_phrase("C++") != normalize_phrase("C")

    def test_folds_case_and_punctuation(self) -> None:
        assert normalize_phrase("Kubernetes (K8s)") == "kubernetes k8s"
        assert normalize_phrase("  CI/CD  ") == "ci cd"

    def test_is_idempotent(self) -> None:
        for value in ["Kubernetes (K8s)", "CI/CD", "Node.js", "C#"]:
            assert normalize_phrase(normalize_phrase(value)) == normalize_phrase(value)

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Kubernetes (K8s)", "kubernetes k8s"),
            ("CI/CD", "ci cd"),
            ("C++", "c++"),
            ("C#", "c#"),
            ("  GitLab   CI  ", "gitlab ci"),
            ("---", ""),
        ],
    )
    def test_matches_the_typescript_seed_normalizer(self, raw: str, expected: str) -> None:
        """These cases are duplicated in `packages/db/src/seed.test.ts`.

        The seed writes alias keys with the TypeScript function; this reads them with the
        Python one. If they diverge, resolution misses silently and looks like missing coverage.
        """
        assert normalize_phrase(raw) == expected


class TestSegment:
    def test_labels_a_skills_list_and_an_experience_section(self) -> None:
        sections = segment("Skills\nKubernetes, Terraform\n\nExperience\nLed a migration")
        kinds = {s.kind for s in sections}
        assert "skill-list" in kinds
        assert "experience" in kinds

    def test_text_before_any_heading_is_not_experience(self) -> None:
        # A contact block guessed upward into `experience` becomes evidence of nothing.
        sections = segment("Ada Lovelace\nada@example.invalid\n\nSkills\nGo")
        assert sections[0].kind == "other"


class TestExtractSkills:
    def test_a_listed_skill_is_claimed_not_evidenced(self) -> None:
        result = extract_skills(text("Skills\nKubernetes, Terraform"), REGISTRY)
        assert {f.slug for f in result} == {"kubernetes", "terraform"}
        assert all(f.status == "claimed" for f in result)
        assert all(f.evidence_kind is None for f in result)

    def test_a_skill_used_in_a_role_is_evidenced_and_names_its_evidence(self) -> None:
        result = extract_skills(
            text("Experience\nLed a Kubernetes migration across 40 services"), REGISTRY
        )
        assert len(result) == 1
        assert result[0].status == "evidenced"
        assert result[0].evidence_kind == "role"
        assert result[0].source_span == "Led a Kubernetes migration across 40 services"

    def test_the_strongest_evidence_wins_when_a_skill_appears_twice(self) -> None:
        result = extract_skills(
            text("Skills\nKubernetes\n\nExperience\nRan Kubernetes in production"), REGISTRY
        )
        assert len(result) == 1
        assert result[0].status == "evidenced"

    def test_never_infers_a_skill_from_a_job_title(self) -> None:
        # "Senior DevOps Engineer" is not evidence of Terraform. The heading is not mined, and no
        # skill is invented from a role name.
        result = extract_skills(text("Experience\nSenior Cloud Engineer at ExampleCorp"), REGISTRY)
        assert result == ()

    def test_never_invents_a_slug(self) -> None:
        # Rust is not in the registry, so it stays unrecognised — it does not become the nearest
        # neighbour, and it does not become a new id.
        result = extract_skills(text("Skills\nRust, Kubernetes"), REGISTRY)
        assert {f.slug for f in result} == {"kubernetes"}

    def test_does_not_match_a_skill_inside_a_longer_word(self) -> None:
        # A substring search makes `go` match inside `Django`, which would put Go on the profile of
        # everyone who has used Django.
        result = extract_skills(text("Skills\nDjango"), REGISTRY)
        assert result == ()

    def test_prefers_the_longest_registered_phrase(self) -> None:
        result = extract_skills(text("Skills\nGoogle Cloud Platform"), REGISTRY)
        assert {f.slug for f in result} == {"gcp"}

    def test_resolves_an_alias(self) -> None:
        result = extract_skills(text("Skills\nk8s, golang, postgres"), REGISTRY)
        assert {f.slug for f in result} == {"kubernetes", "go", "postgresql"}

    def test_every_finding_carries_the_line_it_came_from(self) -> None:
        # A claim whose basis the user cannot see is not correctable.
        for finding in extract_skills(text("Skills\nKubernetes and Terraform"), REGISTRY):
            assert finding.source_span == "Kubernetes and Terraform"


class TestParse:
    def test_an_image_only_document_is_unknown_with_a_reason(self) -> None:
        result = parse(ExtractedText(text="", image_only=True), REGISTRY)
        assert result.status == "unknown"
        assert result.skills == ()
        assert result.reason is not None and "scan" in result.reason
        assert result.completeness is None

    def test_empty_text_is_unknown_rather_than_an_empty_profile(self) -> None:
        result = parse(text("   \n  "), REGISTRY)
        assert result.status == "unknown"
        assert result.completeness is None

    def test_readable_but_unrecognised_is_partial_and_says_nothing_was_invented(self) -> None:
        result = parse(text("Skills\nCobol, Fortran"), REGISTRY)
        assert result.status == "partial"
        assert result.skills == ()
        assert result.reason is not None and "invented" in result.reason

    def test_a_degraded_section_makes_the_result_partial_and_lowers_confidence(self) -> None:
        extracted = ExtractedText(text="Skills\nKubernetes", degraded_sections=("Skills",))
        result = parse(extracted, REGISTRY)
        assert result.status == "partial"
        assert result.skills[0].confidence == "low"
        assert result.reason is not None and "Skills" in result.reason

    def test_a_clean_parse_is_ok(self) -> None:
        result = parse(text("Experience\nBuilt a Terraform module library"), REGISTRY)
        assert result.status == "ok"
        assert result.reason is None
        assert result.degraded_sections == ()

    def test_completeness_never_reaches_one(self) -> None:
        # A résumé is never the whole of someone's experience, and a completeness of exactly 1 would
        # invite treating it as one.
        body = "Experience\n" + "\n".join(
            [
                "Ran Kubernetes",
                "Wrote Terraform",
                "Wrote Go",
                "Used Google Cloud Platform",
                "Ran PostgreSQL",
            ]
        )
        result = parse(text(body), REGISTRY)
        assert result.completeness is not None
        assert result.completeness < 1.0

    def test_is_deterministic(self) -> None:
        # The same document must produce the same profile. Anything else makes a score
        # irreproducible, which is the property ADR-0009 is built around.
        body = "Skills\nk8s, tf\n\nExperience\nRan Kubernetes and Go services"
        first: ParseResult = parse(text(body), REGISTRY)
        for _ in range(5):
            assert parse(text(body), REGISTRY) == first
