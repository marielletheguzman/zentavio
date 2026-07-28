"""promptVersion integrity check.

Built against real temporary git repositories rather than a mocked `git diff`, because the
thing under test is how git reports a change — a mock would assert my assumption about that
rather than the behaviour.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from check_prompt_versions import is_prompt_file, main

PROMPT = "ai/resume-parser/prompts/skill-extract-2026-07-01.md"


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)  # noqa: S603, S607


def write(repo: Path, rel: str, text: str) -> None:
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "test")
    write(tmp_path, PROMPT, "Role: extract skills.\n")
    write(tmp_path, "README.md", "probe\n")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-m", "initial")
    return tmp_path


def check(repo: Path, base: str = "HEAD~1") -> int:
    return main(["--repo", str(repo), "--base", base])


# ── the violation this check exists for ──────────────────────────────────────


def test_editing_a_prompt_without_renaming_it_fails(repo: Path):
    write(repo, PROMPT, "Role: extract skills. Also infer seniority.\n")
    git(repo, "commit", "-am", "tweak the prompt")

    assert check(repo) == 1


def test_deleting_a_prompt_version_fails(repo: Path):
    # Old versions stay, so a past output remains explicable.
    git(repo, "rm", "-q", PROMPT)
    git(repo, "commit", "-m", "remove old prompt")

    assert check(repo) == 1


# ── what must not be flagged ─────────────────────────────────────────────────


def test_copying_to_a_new_version_passes(repo: Path):
    # The intended workflow: copy, edit the copy, leave the old version in place.
    write(repo, "ai/resume-parser/prompts/skill-extract-2026-08-01.md", "Role: extract. New.\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "new prompt version")

    assert check(repo) == 0


def test_moving_a_prompt_fails_because_it_removes_the_old_version(repo: Path):
    # git mv looks like a version bump but deletes the version that produced past outputs.
    # evals.md and conventions.md both require old versions to stay, so this is a violation
    # and the check says so rather than letting the policy hold only on paper.
    new = "ai/resume-parser/prompts/skill-extract-2026-08-01.md"
    git(repo, "mv", PROMPT, new)
    git(repo, "commit", "-am", "move prompt")

    assert check(repo) == 1


def test_moving_with_a_heavy_edit_also_fails(repo: Path):
    # git reports this as delete+add rather than a rename once similarity drops, so both
    # paths through the check must catch it.
    new = "ai/resume-parser/prompts/skill-extract-2026-08-01.md"
    git(repo, "mv", PROMPT, new)
    write(repo, new, "Entirely different content, nothing like the original prompt.\n")
    git(repo, "commit", "-am", "move and rewrite")

    assert check(repo) == 1


def test_adding_a_new_prompt_passes(repo: Path):
    write(repo, "ai/skill-gap/prompts/gap-explain-2026-07-01.md", "Role: explain.\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "add a prompt")

    assert check(repo) == 0


def test_editing_a_non_prompt_file_passes(repo: Path):
    write(repo, "README.md", "changed\n")
    git(repo, "commit", "-am", "docs")

    assert check(repo) == 0


def test_a_markdown_file_outside_a_prompts_directory_passes(repo: Path):
    write(repo, "ai/resume-parser/README.md", "notes\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "service readme")
    write(repo, "ai/resume-parser/README.md", "notes, revised\n")
    git(repo, "commit", "-am", "revise")

    assert check(repo) == 0


def test_no_changes_passes(repo: Path):
    write(repo, "other.md", "x\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "unrelated")

    assert check(repo) == 0


# ── environment handling ─────────────────────────────────────────────────────


def test_missing_base_ref_is_not_a_failure(repo: Path):
    # A single-commit repository has no previous version to contradict.
    assert main(["--repo", str(repo), "--base", "does-not-exist"]) == 0


def test_not_a_git_repository_is_a_usage_error(tmp_path: Path):
    assert main(["--repo", str(tmp_path)]) == 2


def test_several_violations_are_all_reported(repo: Path, capsys):
    second = "ai/skill-gap/prompts/gap-explain-2026-07-01.md"
    write(repo, second, "Role: explain.\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "add second prompt")

    write(repo, PROMPT, "edited\n")
    write(repo, second, "edited\n")
    git(repo, "commit", "-am", "edit both")

    assert check(repo) == 1
    err = capsys.readouterr().err
    assert "skill-extract-2026-07-01.md" in err
    assert "gap-explain-2026-07-01.md" in err


# ── path classification ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "ai/resume-parser/prompts/skill-extract-2026-07-01.md",
        "ai/shared/prompts/evidence-explain-2026-07-01.md",
    ],
)
def test_recognises_a_prompt_path(path: str):
    assert is_prompt_file(path)


@pytest.mark.parametrize(
    "path",
    [
        "ai/resume-parser/README.md",
        "docs/prompts/conventions.md",
        "ai/prompts/loose.md",
        "ai/resume-parser/prompts/notes.txt",
        "prompts/skill-extract.md",
    ],
)
def test_rejects_a_non_prompt_path(path: str):
    # docs/prompts/ is documentation about prompts, not a prompt.
    assert not is_prompt_file(path)
