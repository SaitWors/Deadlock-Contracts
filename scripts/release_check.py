#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


# Development/runtime artefacts are deliberately excluded: this gate validates
# the repository release payload, not an engineer's local environment.
IGNORED_DIRS = {
    ".git",
    ".mypy_cache",
    ".pip-audit-cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "node_modules",
    "dist",
    "release",
    "runtime",
}
FORBIDDEN_DIRS = {"secrets", "backups", "dumps"}
FORBIDDEN_NAMES = {".env", ".env.production", "id_rsa", "id_ed25519"}
FORBIDDEN_SUFFIXES = {".bak", ".before", ".db", ".dump", ".key", ".old", ".opk", ".pem", ".sql", ".zip"}
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\bgh[opsu]_[A-Za-z0-9]{30,}\b"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "Discord webhook": re.compile(r"https://(?:canary\.|ptb\.)?discord(?:app)?\.com/api/webhooks/\d{10,}/[A-Za-z0-9._-]{20,}"),
    "Telegram bot token": re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b"),
}


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]).resolve()
    errors: list[str] = []
    required = [
        ".env.production.example",
        "INSTALL_0.10.1_ALPHA8_RU.md",
        "TESTING_AND_PRODUCTION_RUNBOOK_RU.md",
        "release.json",
        "requirements-dev.txt",
        "alembic.ini",
        "app/migrate.py",
        "alembic/versions/0007_mission_localization.py",
        "compose.prod.yaml",
        "Dockerfile",
        "app/main.py",
        "app/maintenance.py",
        "frontend/package.json",
        "frontend/src/Landing.tsx",
        "frontend/src/Dashboard.tsx",
        "scripts/init-secrets.sh",
    ]
    for relative in required:
        if not (root / relative).is_file():
            fail(errors, f"missing required file: {relative}")

    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if any(part in IGNORED_DIRS for part in relative.parts):
            continue
        if path.is_symlink():
            fail(errors, f"symlink is not allowed: {relative}")
            continue
        if path.is_dir():
            if path.name.lower() in FORBIDDEN_DIRS:
                fail(errors, f"forbidden directory: {relative}")
            continue
        lower = path.name.lower()
        if lower in FORBIDDEN_NAMES or (path.suffix.lower() in FORBIDDEN_SUFFIXES and lower != ".env.production.example"):
            fail(errors, f"forbidden file: {relative}")
            continue
        if path.stat().st_size > 8 * 1024 * 1024:
            fail(errors, f"unexpected file larger than 8 MiB: {relative}")
        if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".woff2", ".ico"}:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(content):
                fail(errors, f"possible {label} in {relative}")

    if not errors:
        config = text(root / "app/config.py")
        compose = text(root / "compose.prod.yaml")
        dockerfile = text(root / "Dockerfile")
        package = text(root / "frontend/package.json")
        workflow = text(root / ".github/workflows/ci.yml")
        release = json.loads(text(root / "release.json"))
        expected = str(release["web_version"])
        if f'"{expected}"' not in config or f"APP_VERSION: {expected}" not in compose or f'"version": "{expected}"' not in package:
            fail(errors, "release version is not aligned across backend, Compose, and frontend")
        if "--forwarded-allow-ips=*" in dockerfile or "FORWARDED_ALLOW_IPS: \"*\"" in compose:
            fail(errors, "reverse-proxy trust must not allow every source")
        if dockerfile.count("@sha256:") < 2:
            fail(errors, "Dockerfile base images must be pinned by digest")
        if compose.count("@sha256:") < 3:
            fail(errors, "production service images must be pinned by digest")
        for action in re.findall(r"^\s*uses:\s*([^\s#]+)", workflow, re.MULTILINE):
            if not re.fullmatch(r"[^@]+@[0-9a-f]{40}", action):
                fail(errors, f"GitHub Action is not pinned by commit SHA: {action}")

        companion_version = str(release["companion_version"])
        companion_manifest_version = str(release["companion_manifest_version"])
        companion_provenance = json.loads(
            text(root / "COMPANION_SOURCE_PROVENANCE.json")
        )
        companion_manifest = json.loads(text(root / "companion/manifest.json"))
        companion_index = text(root / "companion/index.html")
        companion_desktop = text(root / "companion/src/desktop.js")
        companion_notices = text(root / "companion/THIRD_PARTY_NOTICES.txt")
        if companion_manifest.get("meta", {}).get("version") != companion_manifest_version:
            fail(errors, "Companion manifest version is not aligned with release.json")
        if companion_provenance.get("runtime_version") != companion_version:
            fail(errors, "Companion source provenance runtime is not aligned with release.json")
        if companion_provenance.get("manifest_version") != companion_manifest_version:
            fail(errors, "Companion source provenance manifest is not aligned with release.json")
        if f"<b>{companion_version}</b>" not in companion_index:
            fail(errors, "Companion build mark is not aligned with release.json")
        if f"version: '{companion_version}'" not in companion_desktop:
            fail(errors, "Companion fallback version is not aligned with release.json")
        if not companion_notices.startswith(f"Deadlock Contracts Companion {companion_version}\n"):
            fail(errors, "Companion notices header is not aligned with release.json")

        sources = "\n".join([
            text(root / "frontend/src/index.css"),
            text(root / "frontend/src/vnext.css"),
            text(root / "app/security.py"),
        ])
        if "fonts.googleapis.com" in sources or "fonts.gstatic.com" in sources:
            fail(errors, "remote Google Fonts dependency is still present")

        landing = text(root / "frontend/src/Landing.tsx")

        if 'href="#"' in landing:
            fail(
                errors,
                "landing still contains dead href=# links",
            )

        if (
            "INTERACTIVE PREVIEW / NOT SAVED"
            not in landing
        ):
            fail(
                errors,
                "landing preview is not marked as non-persistent",
            )

        if (
            "ПРЕДПРОСМОТР · НЕ СОХРАНЯЕТСЯ"
            not in landing
        ):
            fail(
                errors,
                "landing preview CTA is still action-like",
            )

        for marker in ("const RECENT_RESULTS", "const LEADERBOARD:"):
            if marker in landing:
                fail(errors, f"fabricated landing dataset remains: {marker}")

        main_source = text(root / "app/main.py")
        if "{ id: 'leaderboards', label: 'LEADERBOARD' }" in landing and '@app.get("/api/public/leaderboard")' not in main_source:
            fail(errors, "leaderboard navigation is public but the real server endpoint is missing")
        for endpoint in (
            '/api/desktop/v1/bootstrap',
            '/api/desktop/v1/boards/lock',
            '/api/desktop/v1/boards/{mode}/reroll',
        ):
            if endpoint not in main_source:
                fail(errors, f"desktop endpoint missing: {endpoint}")

    if errors:
        print("[release-check] FAIL")
        for item in sorted(set(errors)):
            print(f" - {item}")
        return 1
    print(f"[release-check] PASS: {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
