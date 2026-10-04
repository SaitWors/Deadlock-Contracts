"""Run through stdin inside the built image; verify actual shipped SEO assets."""
from html.parser import HTMLParser
import re
from urllib.parse import urlsplit

from app.seo import PAGES, STATIC, frontend_shell, render_public_page


class AssetLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = set()
        self.modules = []
        self.headings = []
        self.in_heading = False

    def handle_starttag(self, tag, attrs):
        if tag == "h1":
            self.in_heading = True
            self.headings.append("")
        attrs = dict(attrs)
        link = attrs.get("src") if tag in {"script", "img"} else attrs.get("href") if tag == "link" else None
        if link and link.startswith("/static/"):
            self.assets.add(link.removeprefix("/static/"))
        if tag == "script" and attrs.get("type") == "module":
            self.modules.append(attrs.get("src"))

    def handle_endtag(self, tag):
        if tag == "h1":
            self.in_heading = False

    def handle_data(self, data):
        if self.in_heading:
            self.headings[-1] += data


shell = frontend_shell()
assert shell == (STATIC / "index.html").read_text(), "Image must serve the Vite build, not the development fallback"

# Separate documents are not Vite entries. Verify their transitive CSS assets in
# the built image too, including relative @imports, font subsets and city art.
pending = [STATIC / "nightshift-documents.css", STATIC / "reviewer.css"]
visited = set()
while pending:
    stylesheet = pending.pop()
    if stylesheet in visited:
        continue
    visited.add(stylesheet)
    assert stylesheet.is_file(), f"Missing document stylesheet: {stylesheet}"
    for value in re.findall(r"url\(\s*['\"]?([^)'\"]+)['\"]?\s*\)", stylesheet.read_text()):
        url = urlsplit(value.strip())
        if url.scheme or url.netloc or not url.path:
            continue
        asset = STATIC / url.path.removeprefix("/static/") if url.path.startswith("/static/") else stylesheet.parent / url.path
        asset = asset.resolve()
        assert asset.is_file(), f"Missing document asset from {stylesheet.name}: {value}"
        if asset.suffix == ".css":
            pending.append(asset)

for language in ("ru", "en"):
    for page, data in PAGES.items():
        document = render_public_page(page, language, "https://deadlock-contracts.online", shell)
        assert 'id="dc-public-page" type="application/json"' in document
        links = AssetLinks()
        links.feed(document)
        assert links.headings == [data[language]["heading"]], "Public heading must be visible HTML, not just JSON"
        assert links.modules, "Public documents lost the interactive application"
        assert any(asset.endswith(".css") for asset in links.assets)
        for asset in links.assets:
            assert (STATIC / asset).is_file(), f"Missing published asset: {asset}"
assert (STATIC / "social-preview.jpg").read_bytes().startswith(b"\xff\xd8")
assert (STATIC.parent.parent / "shared/public-pages.json").is_file()
print("[seo-release] Public HTML, translations, Vite modules, document CSS/fonts/art and social image verified")
