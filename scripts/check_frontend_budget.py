#!/usr/bin/env python3
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


LIMITS = {
    # Stage 7: a saved guild editor, shared brand components and Lucide SVG nodes.
    # Measured 597 KB total / 305 KB initial; keep the public-entry cap unchanged.
    "javascript_total": 615_000,
    "initial_javascript": 310_000,
    # PR42: staged wrapper/fan opening and multilayer card foil; measured 328 KB.
    # Initial JS and all other limits remain unchanged.
    "css_total": 330_000,
    "largest_image": 600_000,
    # Removed 1.37 MB of bitmap regalia. New build is 1.94 MB including fonts.
    "assets_total": 2_100_000,
}
IMAGE_SUFFIXES = {".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"}


class EntryScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths: set[str] = set()

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        source = values.get("src") if tag == "script" else values.get("href") if tag == "link" and values.get("rel") == "modulepreload" else None
        if source and urlsplit(source).path.endswith(".js"):
            self.paths.add(Path(urlsplit(source).path).name)


def main() -> int:
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else "frontend/dist").resolve()
    assets = dist / "assets"
    if not assets.is_dir():
        print(f"[frontend-budget] missing build directory: {assets}", file=sys.stderr)
        return 2

    files = [path for path in assets.rglob("*") if path.is_file()]
    javascript_total = sum(path.stat().st_size for path in files if path.suffix == ".js")
    entry = EntryScripts()
    entry.feed((dist / "index.html").read_text())
    if not entry.paths:
        print("[frontend-budget] no initial JavaScript found", file=sys.stderr)
        return 2
    initial_javascript = sum((assets / name).stat().st_size for name in entry.paths)
    css_total = sum(path.stat().st_size for path in files if path.suffix == ".css")
    images = [path for path in files if path.suffix.lower() in IMAGE_SUFFIXES]
    largest_image = max((path.stat().st_size for path in images), default=0)
    assets_total = sum(path.stat().st_size for path in files)
    observed = {
        "javascript_total": javascript_total,
        "initial_javascript": initial_javascript,
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
