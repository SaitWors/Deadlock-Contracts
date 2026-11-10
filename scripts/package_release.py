#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1]

RELEASE = json.loads(
    (SOURCE / "release.json").read_text(
        encoding="utf-8"
    )
)

VERSION = str(RELEASE["web_version"])

ARCHIVE_ROOT = (
    f"deadlock-contracts-web-vnext-{VERSION}"
)

TOP_FILES = {
    ".dockerignore",
    ".env.production.example",
    ".gitignore",
    "alembic.ini",
    f"BUILD_INFO_{VERSION}.txt",
    "Caddyfile",
    "Dockerfile",
    "Makefile",
    "README.md",
    "PROJECT.md",
    "COMPANION_SOURCE_PROVENANCE.json",
    "compose.prod.yaml",
    "compose.yaml",
    "release.json",
    "requirements.txt",
    "requirements-dev.txt",
}

TOP_DIRS = {
    ".github",
    "companion",
    "docs",
    "shared",
    "alembic",
    "app",
    "frontend",
    "licenses",
    "scripts",
    "tests",
}

SKIP_DIRS = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    "dist",
    "node_modules",
    "runtime",
    "release",
    "qa-evidence",
    ".qa",
    ".venv",
    ".ruff_cache",
}

SKIP_SUFFIXES = {
    ".pyc",
    ".pyo",
}


def include(relative: Path) -> bool:
    if any(
        part in SKIP_DIRS
        for part in relative.parts
    ):
        return False

    if (
        relative.suffix.lower()
        in SKIP_SUFFIXES
    ):
        return False

    return (
        relative.parts[0] in TOP_DIRS
        or relative.as_posix()
        in TOP_FILES
    )


def main() -> int:
    output_dir = (
        Path(sys.argv[1]).resolve()
        if len(sys.argv) > 1
        else SOURCE.parent / "release"
    )

    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    archive = (
        output_dir
        / f"{ARCHIVE_ROOT}.zip"
    )

    with tempfile.TemporaryDirectory(
        prefix="dc-web-release-"
    ) as temp:
        staging = (
            Path(temp) / ARCHIVE_ROOT
        )

        staging.mkdir()

        for path in SOURCE.rglob("*"):
            relative = path.relative_to(
                SOURCE
            )

            if (
                not include(relative)
                or path.is_dir()
            ):
                continue

            destination = (
                staging / relative
            )

            destination.parent.mkdir(
                parents=True,
                exist_ok=True,
            )

            shutil.copy2(
                path,
                destination,
            )

        subprocess.run(
            [
                sys.executable,
                str(
                    SOURCE
                    / "scripts/release_check.py"
                ),
                str(staging),
            ],
            check=True,
        )

        if archive.exists():
            archive.unlink()

        with zipfile.ZipFile(
            archive,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as bundle:
            for path in sorted(
                staging.rglob("*")
            ):
                if path.is_file():
                    bundle.write(
                        path,
                        path.relative_to(
                            staging.parent
                        ),
                    )

    digest = hashlib.sha256(
        archive.read_bytes()
    ).hexdigest()

    checksum = archive.with_suffix(
        archive.suffix + ".sha256"
    )

    checksum.write_text(
        f"{digest}  {archive.name}\n",
        encoding="utf-8",
    )

    print(archive)
    print(checksum)
    print(digest)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
