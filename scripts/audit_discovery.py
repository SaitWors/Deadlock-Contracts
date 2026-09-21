"""Read-only production discovery check. No submissions, credentials or writes.

Passing means these URLs are technically crawlable from this network, not that
Google/Bing indexed them or an AI product will recommend them.
"""
from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.message import Message
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser


class Document(HTMLParser):
    def __init__(self, source: str):
        super().__init__()
        self.tags: list[tuple[str, dict]] = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

    def select(self, tag, **attrs):
        return [values for name, values in self.tags if name == tag
                and all(values.get(key) == value for key, value in attrs.items())]


def inspect_document(source: str, url: str, headers: dict) -> list[str]:
    doc = Document(source)
    errors = []
    for tag, attrs in (("title", {}), ("h1", {}), ("meta", {"name": "description"})):
        if len(doc.select(tag, **attrs)) != 1:
            errors.append(f"Expected one {attrs.get('name', tag)}")
    canonical = doc.select("link", rel="canonical")
    if len(canonical) != 1 or canonical[0].get("href") != url:
        errors.append("Missing, duplicate or incorrect canonical")
    directives = [("HTTP X-Robots-Tag", headers.get("x-robots-tag", ""))]
    directives.extend((meta.get("name", ""), meta.get("content", ""))
                      for meta in doc.select("meta")
                      if meta.get("name", "").lower() in
                      {"robots", "googlebot", "bingbot", "yandex", "oai-searchbot"})
    for name, value in directives:
        tokens = value.lower().replace(",", " ").replace(":", " ").split()
        if "noindex" in tokens or "none" in tokens:
            errors.append(f"Indexing blocked by {name}: {value}")
    return errors


def combined_headers(headers: Message) -> dict[str, str]:
    # Proxies may append another X-Robots-Tag instead of replacing it.
    return {name.lower(): ", ".join(headers.get_all(name, [])) for name in headers}


def fetch(url: str, user_agent: str, timeout: float):
    try:
        with urlopen(Request(url, headers={"User-Agent": user_agent}), timeout=timeout) as response:
            return response.status, response.geturl(), combined_headers(response.headers), response.read(2_000_001)
    except HTTPError as error:
        return error.code, error.geturl(), combined_headers(error.headers), b""


def audit(base: str, user_agent: str, timeout: float) -> dict:
    checks = []

    def read(path):
        url = base + path
        status, final, headers, data = fetch(url, user_agent, timeout)
        if status != 200 or final != url:
            raise ValueError(f"{url}: HTTP {status}, final URL {final}")
        if len(data) > 2_000_000:
            raise ValueError(f"{url}: response exceeds 2 MB")
        return {key.lower(): value for key, value in headers.items()}, data.decode("utf-8")

    try:
        _, robots_text = read("/robots.txt")
        parser = RobotFileParser()
        parser.parse(robots_text.splitlines())
        expected_sitemap = base + "/sitemap.xml"
        checks.append({"url": base + "/robots.txt", "errors": [] if expected_sitemap in (parser.site_maps() or []) else ["Missing sitemap directive"]})
        _, xml = read("/sitemap.xml")
        root = ET.fromstring(xml)
        locations = [item.text or "" for item in root.findall("{*}url/{*}loc")]
        if not locations or len(locations) > 200 or len(set(locations)) != len(locations):
            raise ValueError("Sitemap must contain 1–200 unique URLs for this project")
        origin = urlsplit(base)
        for url in locations:
            parsed = urlsplit(url)
            if (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc) or parsed.query or parsed.fragment:
                raise ValueError(f"Unexpected sitemap URL: {url}")
        checks.append({"url": expected_sitemap, "urls": len(locations), "errors": []})

        def inspect(url):
            errors = []
            if not parser.can_fetch(user_agent, url):
                errors.append("Disallowed by robots.txt for the requested user agent")
            try:
                headers, source = read(urlsplit(url).path)
                if "text/html" not in headers.get("content-type", ""):
                    errors.append("Expected text/html")
                errors.extend(inspect_document(source, url, headers))
            except (OSError, URLError, ValueError) as error:
                errors.append(str(error))
            return {"url": url, "errors": errors}

        with ThreadPoolExecutor(max_workers=4) as pool:
            checks.extend(pool.map(inspect, locations))
    except (OSError, URLError, ValueError, ET.ParseError) as error:
        checks.append({"url": base, "errors": [str(error)]})
    return {"base": base, "user_agent": user_agent,
            "crawlable": all(not row["errors"] for row in checks),
            "indexing_status": "unknown — use webmaster tools", "checks": checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="https://deadlock-contracts.online")
    parser.add_argument("--user-agent", default="DeadlockContracts-DiscoveryAudit/1.0")
    parser.add_argument("--timeout", type=float, default=15)
    args = parser.parse_args()
    base = args.base.rstrip("/")
    url = urlsplit(base)
    if url.scheme not in {"https", "http"} or not url.netloc or url.path or url.query or url.fragment or url.username or url.password:
        parser.error("--base must be an HTTP(S) origin without credentials, path, query or fragment")
    if not 0 < args.timeout <= 60:
        parser.error("--timeout must be between 0 and 60 seconds")
    report = audit(base, args.user_agent, args.timeout)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["crawlable"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
