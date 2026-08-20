#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


VERSION = "0.10.1-alpha.7"
ARCHIVE_ROOT = f"deadlock-contracts-web-vnext-{VERSION}"
TOP_FILES = {
    ".dockerignore", ".env.production.example", ".gitignore",
    "BUILD_INFO_0.10.1-alpha.7.txt", "Caddyfile", "Dockerfile",
    "INSTALL_0.10.1_ALPHA7_RU.md", "Makefile", "README.md",
    "RELEASE_NOTES_0.10.1_ALPHA7_RU.md", "SECURITY_AND_TRUST_RU.md",
    "TEST_REPORT_0.10.1_ALPHA7_RU.md", "THIRD_PARTY_NOTICES.md",
    "compose.prod.yaml", "compose.yaml", "requirements.txt",
}
TOP_DIRS = {"app", "frontend", "licenses", "scripts", "tests"}
SKIP_DIRS = {".git", ".pytest_cache", "__pycache__", "dist", "node_modules", "runtime"}
SKIP_SUFFIXES = {".pyc", ".pyo"}


def include(relative: Path) -> bool:
    if any(part in SKIP_DIRS for part in relative.parts):
        return False
    if relative.suffix.lower() in SKIP_SUFFIXES:
        return False
    return relative.parts[0] in TOP_DIRS or relative.as_posix() in TOP_FILES


def main() -> int:
    source = Path(__file__).resolve().parents[1]
    output_dir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else source.parent / "release"
    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f"{ARCHIVE_ROOT}.zip"

    with tempfile.TemporaryDirectory(prefix="dc-web-release-") as temp:
        staging = Path(temp) / ARCHIVE_ROOT
        staging.mkdir()
        for path in source.rglob("*"):
            relative = path.relative_to(source)
            if not include(relative) or path.is_dir():
                continue
            destination = staging / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)

        subprocess.run([sys.executable, str(source / "scripts/release_check.py"), str(staging)], check=True)
        if archive.exists():
            archive.unlink()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for path in sorted(staging.rglob("*")):
                if path.is_file():
                    bundle.write(path, path.relative_to(staging.parent))

    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = archive.with_suffix(archive.suffix + ".sha256")
    checksum.write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
    print(archive)
    print(checksum)
    print(digest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
