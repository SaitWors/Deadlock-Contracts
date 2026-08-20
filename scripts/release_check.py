#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


IGNORED_DIRS = {".git", ".pytest_cache", "__pycache__", "node_modules", "dist", "runtime"}
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
        "INSTALL_0.10.1_ALPHA7_RU.md",
        "compose.prod.yaml",
        "Dockerfile",
        "app/main.py",
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
        package = text(root / "frontend/package.json")
        expected = "0.10.1-alpha.7"
        if f'"{expected}"' not in config or f"APP_VERSION: {expected}" not in compose or f'"version": "{expected}"' not in package:
            fail(errors, "release version is not aligned across backend, Compose, and frontend")

        sources = "\n".join([
            text(root / "frontend/src/index.css"),
            text(root / "frontend/src/vnext.css"),
            text(root / "app/security.py"),
        ])
        if "fonts.googleapis.com" in sources or "fonts.gstatic.com" in sources:
            fail(errors, "remote Google Fonts dependency is still present")

        landing = text(root / "frontend/src/Landing.tsx")
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
