#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


LIMITS = {
    "javascript_total": 450_000,
    "css_total": 240_000,
    "largest_image": 600_000,
    "assets_total": 2_300_000,
}
IMAGE_SUFFIXES = {".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"}


def main() -> int:
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else "frontend/dist").resolve()
    assets = dist / "assets"
    if not assets.is_dir():
        print(f"[frontend-budget] missing build directory: {assets}", file=sys.stderr)
        return 2

    files = [path for path in assets.rglob("*") if path.is_file()]
    javascript_total = sum(path.stat().st_size for path in files if path.suffix == ".js")
    css_total = sum(path.stat().st_size for path in files if path.suffix == ".css")
    images = [path for path in files if path.suffix.lower() in IMAGE_SUFFIXES]
    largest_image = max((path.stat().st_size for path in images), default=0)
    assets_total = sum(path.stat().st_size for path in files)
    observed = {
        "javascript_total": javascript_total,
        "css_total": css_total,
        "largest_image": largest_image,
        "assets_total": assets_total,
    }

    failed = False
    for name, maximum in LIMITS.items():
        actual = observed[name]
        print(f"[frontend-budget] {name}: {actual} / {maximum} bytes")
        if actual > maximum:
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
