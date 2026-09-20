#!/usr/bin/env python3
"""Preview an IndexNow request; submit only with --submit after deployment.

Standard-library only, so the owner can run it on the server without installing
the application dependencies. No automatic retries or background submissions.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.seo import indexable_paths, valid_indexnow_key

ENDPOINT = "https://api.indexnow.org/indexnow"
MAX_RESPONSE = 1024 * 1024


def payload_for(base: str, key: str, urls: list[str] | None) -> dict:
    parsed = urlsplit(base)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment
            or parsed.port not in (None, 443)):
        raise ValueError("APP_BASE_URL must be a public HTTPS origin without credentials, path or query")
    if not valid_indexnow_key(key):
        raise ValueError("INDEXNOW_KEY must contain 8–128 ASCII letters, digits or hyphens")
    base = base.rstrip("/")
    allowed = [base + path for path in indexable_paths()]
    selected = list(dict.fromkeys(urls or allowed))
    if not selected or any(url not in allowed for url in selected):
        raise ValueError("Only canonical, indexable product/service URLs from this release may be submitted")
    return {"host": parsed.hostname, "key": key, "keyLocation": f"{base}/{key}.txt", "urlList": selected}


def get_public(url: str) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "DeadlockContracts-IndexNow/1.0"}), timeout=15) as response:
        if response.status != 200:
            raise ValueError(f"Preflight returned HTTP {response.status}")
        data = response.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE:
            raise ValueError("Preflight response exceeded 1 MiB")
        return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.getenv("APP_BASE_URL", "https://deadlock-contracts.online"))
    parser.add_argument("--key", default=os.getenv("INDEXNOW_KEY", ""))
    parser.add_argument("--url", action="append", help="Changed canonical URL; repeat for multiple pages. Default: all indexable pages.")
    parser.add_argument("--submit", action="store_true", help="Verify deployed key/sitemap, then send one request. Default: offline dry run.")
    args = parser.parse_args(argv)
    try:
        payload = payload_for(args.base_url, args.key, args.url)
    except ValueError as error:
        print(f"[indexnow] {error}", file=sys.stderr)
        return 2
    if not args.submit:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    try:
        if get_public(payload["keyLocation"]).decode("utf-8").strip() != args.key:
            raise ValueError("The deployed key file does not match INDEXNOW_KEY; deploy configuration first")
        document = ET.fromstring(get_public(args.base_url.rstrip("/") + "/sitemap.xml"))
        live_urls = {item.text for item in document.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc")}
        if any(url not in live_urls for url in payload["urlList"]):
            raise ValueError("Requested URLs are missing from the live sitemap; deploy this release first")
        request = Request(ENDPOINT, data=json.dumps(payload).encode("utf-8"),
                          headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
        with urlopen(request, timeout=15) as response:
            if response.status not in (200, 202):
                raise ValueError(f"Unexpected HTTP {response.status}")
            print(f"[indexnow] HTTP {response.status}: {len(payload['urlList'])} URLs received. Indexing is not guaranteed.")
        return 0
    except (HTTPError, URLError, OSError, ValueError, ET.ParseError) as error:
        print(f"[indexnow] Submission stopped; no automatic retry: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
