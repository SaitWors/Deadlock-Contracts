from __future__ import annotations

import hashlib
from http.cookies import SimpleCookie
from types import SimpleNamespace

from starlette.requests import Request
from starlette.responses import Response

from app.config import Settings
from app.services import auth


def _settings(code: str, until: str = "2099-01-01T00:00:00Z") -> SimpleNamespace:
    return SimpleNamespace(
        overwolf_qa_access_enabled=True,
        overwolf_qa_access_code_hash=hashlib.sha256(code.encode("utf-8")).hexdigest(),
        overwolf_qa_access_until=until,
        session_secret="x" * 64,
        cookie_secure=True,
    )


def _request_with_cookie(name: str, value: str) -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/auth/steam/callback",
        "raw_path": b"/auth/steam/callback",
        "query_string": b"",
        "headers": [(b"cookie", f"{name}={value}".encode("ascii"))],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 443),
    }
    return Request(scope)


def test_reviewer_code_is_hashed_and_cookie_is_signed(monkeypatch):
    code = "QA-REVIEW-ACCESS-0123456789-ABCDEFGHIJ"
    fake = _settings(code)
    monkeypatch.setattr(auth, "settings", fake)

    assert auth.reviewer_access_available() is True
    assert auth.verify_reviewer_access_code(code) is True
    assert auth.verify_reviewer_access_code(code + "X") is False

    response = Response()
    auth.issue_reviewer_access(response)
    header = response.headers["set-cookie"]
    assert "HttpOnly" in header
    assert "Secure" in header
    assert code not in header

    parsed = SimpleCookie()
    parsed.load(header)
    cookie_name = auth.REVIEWER_COOKIE_NAME
    value = parsed[cookie_name].value
    request = _request_with_cookie(cookie_name, value)
    assert auth.has_reviewer_access(request) is True

    tampered = value[:-1] + ("0" if value[-1] != "0" else "1")
    assert auth.has_reviewer_access(_request_with_cookie(cookie_name, tampered)) is False


def test_reviewer_gateway_expires(monkeypatch):
    code = "QA-REVIEW-ACCESS-0123456789-ABCDEFGHIJ"
    monkeypatch.setattr(auth, "settings", _settings(code, "2020-01-01T00:00:00Z"))
    assert auth.reviewer_access_available() is False
    assert auth.verify_reviewer_access_code(code) is False


def test_closed_alpha_qa_configuration_validates():
    code_hash = hashlib.sha256(b"x" * 40).hexdigest()
    settings = Settings(
        app_env="development",
        app_base_url="https://deadlock-contracts.online",
        cookie_secure=True,
        trusted_hosts=("deadlock-contracts.online", "www.deadlock-contracts.online"),
        closed_alpha=True,
        alpha_allowed_steam_ids=("76561198980887041",),
        overwolf_qa_access_enabled=True,
        overwolf_qa_access_code_hash=code_hash,
        overwolf_qa_access_until="2099-01-01T00:00:00Z",
        session_secret="x" * 64,
        provider="mock",
        admin_steam_ids=(),
        admin_totp_secret="",
    )
    settings.validate()
