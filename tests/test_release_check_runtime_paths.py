from __future__ import annotations

import subprocess
from pathlib import Path

from scripts.release_check import forbidden_parent, git_tracked_files
from scripts.package_release import include


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def test_release_payload_uses_tracked_files_only(tmp_path: Path) -> None:
    _git(tmp_path, "init")

    (tmp_path / ".gitignore").write_text(
        ".env.production\nsecrets/\nbackups/\n",
        encoding="utf-8",
    )
    (tmp_path / "tracked.txt").write_text("release payload\n", encoding="utf-8")
    _git(tmp_path, "add", ".gitignore", "tracked.txt")

    (tmp_path / "secrets").mkdir()
    (tmp_path / "secrets" / "session_secret.txt").write_text(
        "runtime-only\n",
        encoding="utf-8",
    )
    (tmp_path / "backups").mkdir()
    (tmp_path / "backups" / "before.sql").write_text(
        "runtime-only\n",
        encoding="utf-8",
    )
    (tmp_path / ".env.production").write_text(
        "DOMAIN=example.invalid\n",
        encoding="utf-8",
    )

    tracked = git_tracked_files(tmp_path)

    assert tracked is not None
    assert ".gitignore" in tracked
    assert "tracked.txt" in tracked
    assert ".env.production" not in tracked
    assert "secrets/session_secret.txt" not in tracked
    assert "backups/before.sql" not in tracked


def test_forbidden_parent_still_rejects_tracked_secret_paths() -> None:
    assert forbidden_parent(Path("secrets/session_secret.txt")) == Path("secrets")
    assert forbidden_parent(Path("nested/backups/pre.sql")) == Path("nested/backups")
    assert forbidden_parent(Path("app/main.py")) is None


def test_source_archive_keeps_unified_docs_and_release_gate_inputs() -> None:
    for relative in (
        "README.md",
        "PROJECT.md",
        "COMPANION_SOURCE_PROVENANCE.json",
        "requirements-dev.txt",
        ".github/workflows/ci.yml",
        "shared/public-pages.json",
        "companion/manifest.json",
        "docs/design/occult-bureau/desktop.png",
    ):
        assert include(Path(relative)), relative
    for relative in (
        ".env.production",
        "secrets/session_secret.txt",
        "companion/release/previous-QA.zip",
        "companion/dist/previous.opk",
        "companion/qa-evidence/old.png",
        "frontend/node_modules/package/index.js",
    ):
        assert not include(Path(relative)), relative
