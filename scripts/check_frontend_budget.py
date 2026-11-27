#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


LIMITS = {
    # Gwent board, targeting/inspection and original illustrated preparation,
    # plus the legacy renderer for already-started matches: measured 823,321 B.
    # The Arena UI is lazy and the public entry remains 301,583 B within its
    # unchanged 310 KB limit. The new feature receives a bounded 30 KB increase.
    # Hero portraits stay separate assets.
    # The authenticated Relay telemetry chunk is loaded by the Relay admin tab.
    # Keep the original limit for every other chunk and cap this feature separately.
    "javascript_total": 840_000,
    "javascript_shared": 830_000,
    "javascript_relay_scheduler": 10_000,
    "initial_javascript": 310_000,
    # Five themes, responsive Gwent board/hand and existing legacy surfaces.
    # Measured 468,676 B; retain a narrow 25 KB increase for the new stylesheet.
    "css_total": 475_000,
    "largest_image": 600_000,
    # Three mascot poses + four city/interior WebPs, all < 290 KB individually.
    # Measured 2.96 MB for every asset including fonts; artwork below fold is lazy.
    "assets_total": 3_100_000,
}
IMAGE_SUFFIXES = {".avif", ".gif", ".jpg", ".jpeg", ".png", ".webp"}
RELAY_SCHEDULER_ENTRY = "src/admin/RelayScheduler.tsx"


class EntryScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths: set[str] = set()

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        source = values.get("src") if tag == "script" else values.get("href") if tag == "link" and values.get("rel") == "modulepreload" else None
        if source and urlsplit(source).path.endswith(".js"):
            self.paths.add(Path(urlsplit(source).path).name)


def relay_scheduler_size(dist: Path, entry: EntryScripts) -> int:
    path = dist / ".vite" / "manifest.json"
    if not path.is_file():
        return 0
    manifest = json.loads(path.read_text(encoding="utf-8"))
    chunk = manifest.get(RELAY_SCHEDULER_ENTRY)
    if chunk is None:
        return 0
    file = Path(chunk["file"])
    if (
        file.parent != Path("assets") or not file.name.startswith("RelayScheduler-") or file.suffix != ".js"
        or chunk.get("isDynamicEntry") is not True or file.name in entry.paths
        or any(RELAY_SCHEDULER_ENTRY in other.get("imports", ()) for other in manifest.values())
    ):
        raise ValueError("Relay scheduler must be a dedicated lazy admin chunk")
    return (dist / file).stat().st_size


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
    try:
        relay_javascript = relay_scheduler_size(dist, entry)
    except (KeyError, OSError, TypeError, ValueError) as error:
        print(f"[frontend-budget] {error}", file=sys.stderr)
        return 2
    initial_javascript = sum((assets / name).stat().st_size for name in entry.paths)
    css_total = sum(path.stat().st_size for path in files if path.suffix == ".css")
    images = [path for path in files if path.suffix.lower() in IMAGE_SUFFIXES]
    largest_image = max((path.stat().st_size for path in images), default=0)
    assets_total = sum(path.stat().st_size for path in files)
    observed = {
        "javascript_total": javascript_total,
        "javascript_shared": javascript_total - relay_javascript,
        "javascript_relay_scheduler": relay_javascript,
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
