"""Text extraction from real document formats (ADR-0016).

The tests that matter here are the failure paths, not the happy one. A parser that reads a clean
PDF is table stakes; a parser that turns a scan, a corrupt file, or a two-column layout into a
*confident wrong answer* is the thing that damages someone making an irreversible decision.
"""

from __future__ import annotations

import pytest
from compute import parse
from extract import (
    DOCX_CONTENT_TYPE,
    PDF_CONTENT_TYPE,
    PLAIN_TEXT_CONTENT_TYPE,
    DocumentTextExtractor,
    UnsupportedDocumentError,
    extract,
)
from fixtures import (
    docx_with,
    not_a_document,
    pdf_blank,
    pdf_image_only,
    pdf_with_text,
)
from ports import RegisteredSkill
from test_compute import FakeRegistry, skill

REGISTRY = FakeRegistry(
    (
        skill("kubernetes", "Kubernetes", "k8s"),
        skill("terraform", "Terraform", "tf"),
        skill("go", "Go", "golang"),
    )
)


class TestPdf:
    def test_reads_text(self) -> None:
        result = extract(pdf_with_text(["Skills", "Kubernetes, Terraform"]), PDF_CONTENT_TYPE)
        assert "Kubernetes" in result.text
        assert result.image_only is False
        assert result.degraded_sections == ()

    def test_an_image_only_page_is_detected_as_a_scan(self) -> None:
        # This is the whole reason `_page_has_image` exists. Telling someone "no text could be read"
        # when the honest answer is "this is a scan and we cannot OCR it" sends them to fix the
        # wrong thing.
        result = extract(pdf_image_only(), PDF_CONTENT_TYPE)
        assert result.image_only is True
        assert result.text.strip() == ""

    def test_a_blank_page_is_not_called_a_scan(self) -> None:
        # A genuinely empty page and a scanned page both extract to "". Conflating them would put a
        # misleading reason in front of the user.
        result = extract(pdf_blank(), PDF_CONTENT_TYPE)
        assert result.image_only is False
        assert result.text.strip() == ""

    def test_a_corrupt_file_is_refused_rather_than_raising(self) -> None:
        # Hostile input must not escape as a traceback. The pipeline reports it; nothing crashes.
        result = extract(not_a_document(), PDF_CONTENT_TYPE)
        assert result.text == ""
        assert result.degraded_sections == ("the whole document",)


class TestDocx:
    def test_reads_paragraphs(self) -> None:
        result = extract(docx_with(["Skills", "Kubernetes"]), DOCX_CONTENT_TYPE)
        assert result.text.splitlines() == ["Skills", "Kubernetes"]
        assert result.degraded_sections == ()

    def test_reads_a_table_and_admits_the_layout_was_flattened(self) -> None:
        # Two-column résumés hide their whole skills section in a table. Reading it is necessary;
        # pretending the flattened ordering is meaningful is not.
        result = extract(docx_with(["Experience"], [["Go", "Terraform"]]), DOCX_CONTENT_TYPE)
        assert "Go Terraform" in result.text
        assert result.degraded_sections == ("a table",)

    def test_a_file_that_is_not_a_docx_is_refused(self) -> None:
        result = extract(not_a_document(), DOCX_CONTENT_TYPE)
        assert result.text == ""
        assert result.degraded_sections == ("the whole document",)


class TestContentTypes:
    def test_plain_text_passes_through(self) -> None:
        result = extract(b"Skills\nKubernetes", PLAIN_TEXT_CONTENT_TYPE)
        assert result.text == "Skills\nKubernetes"

    def test_undecodable_bytes_do_not_raise(self) -> None:
        result = extract(b"\xff\xfe\x00Skills", PLAIN_TEXT_CONTENT_TYPE)
        assert "Skills" in result.text

    def test_an_unsupported_type_raises_and_leaks_no_content(self) -> None:
        # The message names the content type and nothing else — never a filename, never a byte of
        # the document (`docs/architecture/privacy.md`).
        with pytest.raises(UnsupportedDocumentError) as caught:
            extract(b"MZ\x90\x00secret resume content", "application/x-msdownload")
        assert "secret" not in str(caught.value)
        assert "application/x-msdownload" in str(caught.value)


class TestPortImplementation:
    def test_satisfies_the_protocol_the_pipeline_depends_on(self) -> None:
        extractor = DocumentTextExtractor()
        assert extractor.extract(b"Skills\nGo", PLAIN_TEXT_CONTENT_TYPE).text == "Skills\nGo"


class TestEndToEnd:
    """Extraction and parsing together — the first point at which a document becomes a profile."""

    def test_a_pdf_becomes_a_profile_with_spans(self) -> None:
        content = pdf_with_text(
            ["Skills", "Kubernetes, Terraform", "Experience", "Ran Go services in production"]
        )
        result = parse(extract(content, PDF_CONTENT_TYPE), REGISTRY)

        assert result.status == "ok"
        by_slug = {finding.slug: finding for finding in result.skills}
        assert by_slug["kubernetes"].status == "claimed"
        assert by_slug["go"].status == "evidenced"
        assert by_slug["go"].source_span == "Ran Go services in production"

    def test_a_scan_becomes_unknown_not_an_empty_profile(self) -> None:
        result = parse(extract(pdf_image_only(), PDF_CONTENT_TYPE), REGISTRY)
        assert result.status == "unknown"
        assert result.skills == ()
        assert result.reason is not None and "scan" in result.reason

    def test_a_docx_table_produces_a_partial_result(self) -> None:
        # The skills are real and are reported; the caveat travels with them.
        content = docx_with(["Experience"], [["Kubernetes", "Terraform"]])
        result = parse(extract(content, DOCX_CONTENT_TYPE), REGISTRY)

        assert result.status == "partial"
        assert {f.slug for f in result.skills} == {"kubernetes", "terraform"}
        assert all(f.confidence == "low" for f in result.skills)

    def test_a_corrupt_document_never_produces_a_confident_profile(self) -> None:
        result = parse(extract(not_a_document(), PDF_CONTENT_TYPE), REGISTRY)
        assert result.status == "unknown"
        assert result.completeness is None


def test_registered_skill_is_hashable_for_the_alias_index() -> None:
    # The index keys on frozenset aliases; a mutable set would make RegisteredSkill unhashable and
    # the failure would surface far from here.
    assert isinstance(
        RegisteredSkill(slug="x", name="X", kind="tool", aliases=frozenset({"x"})).aliases,
        frozenset,
    )
