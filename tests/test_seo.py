"""Exercise crawler-visible HTTP documents, without a browser or JavaScript."""
import json
import xml.etree.ElementTree as ET
from dataclasses import replace
from html.parser import HTMLParser
from urllib.robotparser import RobotFileParser

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import main, security
from app.db import get_db
from app.models import PublicProfile, User

pytest_plugins = ("test_player_community",)


class Document(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.tags = []
        self.text = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

    def handle_data(self, data):
        self.text.append(data)

    def elements(self, tag, **attrs):
        return [a for t, a in self.tags if t == tag and all(a.get(k) == v for k, v in attrs.items())]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(security, "_local_limiter", security.SlidingWindowLimiter())
    with TestClient(main.app) as client:
        yield client


@pytest.mark.parametrize("language", ["ru", "en"])
@pytest.mark.parametrize("slug", ["", "contracts", "how-it-works", "cards", "about", "leaderboard"])
def test_public_document_is_complete_before_javascript(client, language, slug):
    path = f"/{language}/{slug}"
    response = client.get(path, headers={"Accept-Language": "en" if language == "ru" else "ru"})
    assert response.status_code == 200
    doc = Document(response.text)
    assert doc.elements("html", lang=language)
    assert len(doc.elements("h1")) == 1
    assert "Deadlock" in " ".join(doc.text)
    base = main.settings.app_base_url
    assert doc.elements("link", rel="canonical") == [{"rel": "canonical", "href": base + path}]
    assert doc.elements("meta", name="description")[0]["content"]
    assert doc.elements("meta", property="og:url")[0]["content"] == base + path
    assert doc.elements("meta", property="og:image")[0]["content"] == base + "/social-preview.jpg"
    assert doc.elements("meta", name="twitter:card")[0]["content"] == "summary_large_image"
    for other in ("ru", "en"):
        assert doc.elements("link", rel="alternate", hreflang=other)[0]["href"] == f"{base}/{other}/{slug}"
        assert doc.elements("a", href=f"/{other}/{slug}")
    assert doc.elements("a", href=f"/{language}/cards")
    assert len(doc.elements("section")) >= 2
    assert doc.elements("script", type="application/ld+json")
    assert "noindex" not in response.headers.get("x-robots-tag", "")
    assert client.head(path).status_code == 200
    assert not client.head(path).content


def test_public_documents_do_not_depend_on_session_or_database(client):
    def unavailable():
        raise AssertionError("Public content must not open a database session")
    main.app.dependency_overrides[get_db] = unavailable
    try:
        response = client.get("/en/cards?campaign=launch", headers={"Cookie": "session=invalid"})
        assert response.status_code == 200
        assert '<h1' in response.text
        assert "launch" not in Document(response.text).elements("link", rel="canonical")[0]["href"]
    finally:
        main.app.dependency_overrides.pop(get_db, None)


@pytest.mark.parametrize("path,target", [
    ("/contracts", "/ru/contracts"), ("/cards/", "/ru/cards"),
    ("/how", "/ru/how-it-works"), ("/leaderboards", "/ru/leaderboard"),
    ("/en", "/en/"), ("/ru", "/ru/"), ("/en/contracts/", "/en/contracts"),
    ("/ru/leaderboards", "/ru/leaderboard"),
])
def test_legacy_and_duplicate_paths_redirect_once(client, path, target):
    response = client.get(path, follow_redirects=False)
    assert response.status_code == 308
    assert response.headers["location"] == target
    assert client.get(target, follow_redirects=False).status_code == 200


@pytest.mark.parametrize("path", ["/unknown", "/ru/unknown", "/en/cards/arbitrary", "/assets/missing.js", "/wp-admin"])
def test_unknown_paths_are_real_html_404s(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert "noindex" in response.headers["x-robots-tag"]
    assert Document(response.text).elements("a", href="/ru/")
    assert not Document(response.text).elements("link", rel="canonical")
    assert client.head(path).status_code == 404


@pytest.mark.parametrize("path", ["/ru/try", "/en/try", "/ru/campaigns", "/en/campaigns"])
def test_trial_and_unfinished_pages_are_noindex(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["x-robots-tag"] == "noindex, follow"
    assert Document(response.text).elements("meta", name="robots")[0]["content"] == "noindex, follow"


@pytest.mark.parametrize("language", ["ru", "en"])
@pytest.mark.parametrize("slug,article", [("privacy", "privacyDocument"), ("terms", "termsDocument"), ("support", "supportDocument"), ("status", "statusDocument"), ("changelog", "changelogDocument"), ("data-sources", "dataSourcesDocument")])
def test_selected_service_document_is_visible_without_js(client, language, slug, article):
    response = client.get(f"/{language}/{slug}")
    assert response.status_code == 200
    doc = Document(response.text)
    assert len(doc.elements("h1")) == 1
    assert len(doc.elements("article")) == 1
    assert "hidden" not in doc.elements("article", id=article)[0]["class"]
    assert doc.elements("link", rel="canonical")[0]["href"] == f"{main.settings.app_base_url}/{language}/{slug}"
    assert client.head(f"/{language}/{slug}").status_code == 200


def test_root_keeps_public_html_and_social_art_is_shipped(client):
    response = client.get("/")
    assert response.status_code == 200
    doc = Document(response.text)
    assert len(doc.elements("h1")) == 1
    assert doc.elements("link", rel="canonical")[0]["href"].endswith("/ru/")
    art = client.get("/social-preview.jpg")
    assert art.status_code == 200
    assert art.headers["content-type"] == "image/jpeg"
    assert art.content[:2] == b"\xff\xd8"


@pytest.mark.parametrize("path", ["/admin/reviews", "/admin/announcements"])
def test_existing_private_deep_links_keep_a_noindex_session_shell(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert "noindex" in response.headers["x-robots-tag"]
    assert "no-store" in response.headers["cache-control"]
    assert client.get("/admin/unknown-page").status_code == 404


def test_shared_copy_is_embedded_for_react_and_stays_safe(client):
    doc = client.get("/en/cards").text
    assert 'id="dc-public-page" type="application/json"' in doc
    payload = json.loads(doc.split('id="dc-public-page" type="application/json">')[1].split('</script>')[0])
    assert payload["language"] == "en"
    assert payload["page"] == "cards"
    assert payload["content"]["heading"] in doc


@pytest.mark.parametrize("language,question", [
    ("ru", "Это мод для Deadlock или отдельный сайт?"),
    ("en", "Is this a Deadlock mod or a separate website?"),
])
def test_common_questions_are_visible_and_shared_with_react(client, language, question):
    source = client.get(f"/{language}/how-it-works").text
    assert f"<h2>{question}</h2>" in source
    payload = json.loads(source.split('id="dc-public-page" type="application/json">')[1].split('</script>')[0])
    assert any(section["heading"] == question for section in payload["content"]["sections"])


def test_profile_document_respects_visibility_without_leaking_data(community):
    factory, player = community
    user_id, client = player("Visible operative", public=True)
    with factory() as db:
        profile = db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id))
        slug = profile.slug
    shown = client.get(f"/u/{slug}")
    assert shown.status_code == 200
    assert "noindex" in shown.headers["x-robots-tag"]
    assert "no-store" in shown.headers["cache-control"]
    assert client.get("/u/missing-player").status_code == 404
    with factory() as db:
        db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id)).is_public = False
        db.get(User, user_id).display_name = "Must never leak"
        db.commit()
    hidden = client.get(f"/u/{slug}")
    assert hidden.status_code == 404
    assert "Must never leak" not in hidden.text


@pytest.mark.parametrize("path", ["/admin/reviews", "/admin/announcements"])
def test_known_admin_trailing_slashes_redirect_to_the_existing_session_shell(client, path):
    for method in (client.get, client.head):
        response = method(path + "/", follow_redirects=False)
        assert response.status_code == 308
        assert response.headers["location"] == path
        assert "no-store" in response.headers["cache-control"]
    assert client.get("/admin/unknown/").status_code == 404


def test_profile_trailing_slash_redirect_checks_visibility_first(community):
    factory, player = community
    user_id, client = player("Canonical profile", public=True)
    with factory() as db:
        slug = db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id)).slug
    for method in (client.get, client.head):
        response = method(f"/u/{slug}/", follow_redirects=False)
        assert response.status_code == 308
        assert response.headers["location"] == f"/u/{slug}"
        assert "no-store" in response.headers["cache-control"]
    with factory() as db:
        db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id)).is_public = False
        db.commit()
    for path in (f"/u/{slug}/", "/u/missing-player/", "/u/invalid_slug/"):
        response = client.get(path, follow_redirects=False)
        assert response.status_code == 404
        assert "no-store" in response.headers["cache-control"]
        assert "location" not in response.headers


def test_renderer_preserves_built_scripts_and_escapes_metadata():
    from app.seo import render_public_page
    shell = '<!doctype html><html lang="ru"><head><title>Old</title><meta name="description" content="old"><link rel="stylesheet" href="/static/assets/app.css"><script type="module" src="/static/assets/app.js"></script></head><body><div id="root"></div></body></html>'
    html = render_public_page("cards", "en", 'https://example.invalid', shell)
    doc = Document(html)
    assert len(doc.elements("title")) == 1
    assert len(doc.elements("meta", name="description")) == 1
    assert doc.elements("script", src="/static/assets/app.js")
    assert doc.elements("link", href="/static/assets/app.css")
    from app import seo
    original = seo.PAGES["cards"]["en"]["description"]
    try:
        seo.PAGES["cards"]["en"]["description"] = '</script><script>alert("x")</script>'
        html = render_public_page("cards", "en", 'https://example.invalid', shell)
        assert '<script>alert(' not in html
        payload = html.split('<script type="application/ld+json">')[1].split('</script>')[0]
        assert json.loads(payload)
    finally:
        seo.PAGES["cards"]["en"]["description"] = original


def test_sitemap_contains_only_canonical_indexable_documents_and_language_pairs(client):
    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    assert client.head("/sitemap.xml").status_code == 200
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "x": "http://www.w3.org/1999/xhtml"}
    root = ET.fromstring(response.content)
    urls = root.findall("s:url", ns)
    locations = [node.findtext("s:loc", namespaces=ns) for node in urls]
    assert len(locations) == len(set(locations)) == 24
    base = main.settings.app_base_url
    for language in ("ru", "en"):
        for slug in ("", "contracts", "how-it-works", "cards", "about", "leaderboard", "privacy", "terms", "support", "status", "changelog", "data-sources"):
            assert f"{base}/{language}/{slug}" in locations
    for node in urls:
        assert node.find("s:lastmod", ns) is None  # Never pretend a crawl itself is an update.
        pairs = {link.attrib["hreflang"]: link.attrib["href"] for link in node.findall("x:link", ns)}
        assert set(pairs) == {"ru", "en"}
        assert all(url in locations for url in pairs.values())
    assert not any(any(part in url for part in ("/try", "/campaigns", "/api/", "/u/", "/admin", "/reviewer", "?", "#")) for url in locations)
    assert client.get("/sitemap.xml").content == response.content


def test_robots_allows_search_crawlers_but_excludes_service_paths(client):
    response = client.get("/robots.txt")
    parser = RobotFileParser()
    parser.parse(response.text.splitlines())
    assert client.head("/robots.txt").status_code == 200
    assert parser.site_maps() == [main.settings.app_base_url + "/sitemap.xml"]
    for bot in ("Googlebot", "bingbot", "OAI-SearchBot", "ExampleBot"):
        for path in ("/en/cards", "/ru/contracts", "/static/assets/index.js", "/social-preview.jpg"):
            assert parser.can_fetch(bot, main.settings.app_base_url + path)
        for path in ("/api/me", "/api", "/auth/steam", "/reviewer", "/admin/reviews"):
            assert not parser.can_fetch(bot, main.settings.app_base_url + path)


def test_optional_indexnow_key_file_requires_explicit_valid_configuration(client, monkeypatch):
    key = "a1b2c3d4-test-key"
    assert client.get(f"/{key}.txt").status_code == 404
    monkeypatch.setattr(main, "settings", replace(main.settings, indexnow_key=key))
    response = client.get(f"/{key}.txt")
    assert response.status_code == 200
    assert response.text == key
    assert response.headers["content-type"].startswith("text/plain")
    assert "noindex" in response.headers["x-robots-tag"]
    assert client.head(f"/{key}.txt").status_code == 200
    assert client.get("/another-key.txt").status_code == 404
    for invalid in ("short", "../secrets/key", "x" * 129, "<script>alert(1)</script>"):
        configured = replace(main.settings, indexnow_key=invalid)
        with pytest.raises(RuntimeError, match="INDEXNOW_KEY"):
            configured.validate()


def test_llms_summary_points_to_public_documents_and_does_not_claim_official_status(client):
    response = client.get("/llms.txt")
    assert response.status_code == 200
    assert "unofficial" in response.text.lower()
    assert main.settings.app_base_url + "/en/how-it-works" in response.text
    assert "/api/" not in response.text
    assert client.head("/llms.txt").status_code == 200


def test_forwarded_host_cannot_poison_public_canonical_links(client):
    response = client.get('/en/cards?next=https://attacker.invalid/', headers={"X-Forwarded-Host": "attacker.invalid"})
    assert response.status_code == 200
    assert "attacker.invalid" not in response.text


def test_crawlable_pages_share_the_ritual_document_shell_without_obsolete_brand_art():
    from app.seo import render_public_page, render_not_found
    shell = '<!doctype html><html><head></head><body><div id="root"></div></body></html>'
    source = render_public_page("cards", "en", "https://example.invalid", shell)
    doc = Document(source)
    assert doc.elements("link", href="/static/nightshift-documents.css")
    assert doc.elements("script", src="/static/document-appearance.js")
    assert doc.elements("div", **{"class": "city-public bureau-public min-h-screen"})
    assert not doc.elements("img", src="/static/assets/logo-horizontal.svg")
    assert "DEADLOCK CONTRACTS · YOUR MATCH. YOUR TERMS." in " ".join(doc.text)
    assert "CITY NEVER SLEEPS" not in " ".join(doc.text)
    missing = Document(render_not_found("https://example.invalid", "en"))
    assert missing.elements("div", **{"class": "city-public"})
    assert missing.elements("main", **{"class": "public-document city-not-found"})
    assert missing.elements("link", href="/static/nightshift-documents.css")
