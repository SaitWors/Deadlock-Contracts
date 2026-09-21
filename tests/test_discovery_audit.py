"""The deployment probe must catch index blockers, not promise indexing."""
from email.message import Message
from unittest.mock import MagicMock, patch

from scripts.audit_discovery import fetch, inspect_document

GOOD = '''<html lang="ru"><head><title>Deadlock Contracts</title>
<meta name="description" content="Match contracts and cards">
<link rel="canonical" href="https://example.com/ru/">
<meta name="robots" content="index, follow"></head>
<body><h1>Deadlock Contracts</h1><p>Public content.</p></body></html>'''


def test_accepts_complete_public_html():
    assert inspect_document(GOOD, "https://example.com/ru/", {}) == []


def test_rejects_wrong_canonical_and_http_noindex():
    errors = inspect_document(GOOD, "https://example.com/en/", {"x-robots-tag": "noindex"})
    assert any("canonical" in error for error in errors)
    assert any("noindex" in error for error in errors)


def test_detects_duplicate_metadata_and_bot_specific_exclusion():
    html = GOOD.replace('</head>', '<title>Duplicate</title><meta name="googlebot" content="none"></head>')
    errors = inspect_document(html, "https://example.com/ru/", {})
    assert any("title" in error for error in errors)
    assert any("googlebot" in error for error in errors)


def test_script_strings_are_not_visible_content():
    html = GOOD.replace('<h1>Deadlock Contracts</h1><p>Public content.</p>', '<script>"<h1>Fake</h1>"</script>')
    assert any("h1" in error for error in inspect_document(html, "https://example.com/ru/", {}))


def test_repeated_http_robot_headers_preserve_every_restriction():
    response = MagicMock()
    response.__enter__.return_value = response
    response.status = 200
    response.geturl.return_value = "https://example.com/ru/"
    response.read.return_value = GOOD.encode()
    response.headers = Message()
    response.headers.add_header("X-Robots-Tag", "noindex")
    response.headers.add_header("X-Robots-Tag", "nofollow")
    with patch("scripts.audit_discovery.urlopen", return_value=response):
        _, url, headers, source = fetch("https://example.com/ru/", "Audit", 1)
    errors = inspect_document(source.decode(), url, {key.lower(): value for key, value in headers.items()})
    assert any("noindex" in error for error in errors)
