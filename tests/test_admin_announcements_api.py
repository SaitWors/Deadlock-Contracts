from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import SessionToken, SystemAnnouncement, User, utcnow
from app.services.auth import COOKIE_NAME, hash_token


@pytest.fixture()
def isolated_api():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)

    def override_db():
        with factory() as db:
            yield db

    tracked_settings = {
        "admin_steam_ids": settings.admin_steam_ids,
        "announcements_enabled": settings.announcements_enabled,
        "announcements_site_enabled": settings.announcements_site_enabled,
        "announcements_companion_enabled": settings.announcements_companion_enabled,
        "announcements_telegram_mirror_enabled": settings.announcements_telegram_mirror_enabled,
    }
    object.__setattr__(settings, "admin_steam_ids", ("76561198083722456",))
    object.__setattr__(settings, "announcements_enabled", True)
    object.__setattr__(settings, "announcements_site_enabled", True)
    object.__setattr__(settings, "announcements_companion_enabled", True)
    object.__setattr__(settings, "announcements_telegram_mirror_enabled", False)
    app.dependency_overrides[get_db] = override_db
    try:
        yield factory
    finally:
        app.dependency_overrides.pop(get_db, None)
        for name, value in tracked_settings.items():
            object.__setattr__(settings, name, value)
        engine.dispose()


def _elevate(client: TestClient, factory: sessionmaker) -> None:
    raw = client.cookies.get(COOKIE_NAME)
    assert raw
    with factory() as db:
        browser_session = db.get(SessionToken, hash_token(raw))
        assert browser_session is not None
        browser_session.admin_verified_at = utcnow()
        db.commit()


def _draft_payload() -> dict:
    return {
        "severity": "MAINTENANCE",
        "presentation": "BANNER",
        "effect": "SCANLINE_ONCE",
        "dismiss_policy": "ACK_REQUIRED",
        "title_ru": "Проверка API уведомлений",
        "body_ru": "Проверки матчей могут выполняться немного дольше.",
        "title_en": "Announcement API check",
        "body_en": "Match verification may take a little longer.",
        "cta_label_ru": "Статус",
        "cta_label_en": "Status",
        "cta_url": "/status",
        "surfaces": ["SITE_PUBLIC", "SITE_DASHBOARD", "COMPANION_DESKTOP"],
        "audiences": ["ALL"],
        "priority": 80,
        "show_countdown": True,
    }


def test_admin_api_rbac_csrf_lifecycle_receipts_and_public_redaction(
    isolated_api,
) -> None:
    factory = isolated_api
    with TestClient(app) as client:
        assert client.post("/api/auth/demo").status_code == 200
        assert client.get("/api/admin/announcements").status_code == 403
        _elevate(client, factory)
        me = client.get("/api/me").json()
        assert me["user"]["access_role"] == "OWNER"
        csrf = {"X-CSRF-Token": me["csrf_token"]}

        assert (
            client.post("/api/admin/announcements", json=_draft_payload()).status_code
            == 403
        )
        created_response = client.post(
            "/api/admin/announcements",
            json=_draft_payload(),
            headers=csrf,
        )
        assert created_response.status_code == 200
        item = created_response.json()["item"]
        assert item["phase"] == "DRAFT"

        with factory() as db:
            user = db.get(User, me["user"]["id"])
            assert user is not None
            user.access_role = "ADMIN"
            db.commit()
        object.__setattr__(settings, "admin_steam_ids", ())

        admin_me = client.get("/api/me").json()
        assert "announcements.drafts.manage" in admin_me["user"]["permissions"]
        assert "announcements.publish" not in admin_me["user"]["permissions"]
        updated_payload = {
            **_draft_payload(),
            "expected_revision": item["revision"],
            "title_ru": "Обновлённая проверка API",
        }
        updated_response = client.patch(
            f"/api/admin/announcements/{item['id']}",
            json=updated_payload,
            headers=csrf,
        )
        assert updated_response.status_code == 200
        item = updated_response.json()["item"]

        now = utcnow()
        publish_payload = {
            "expected_revision": item["revision"],
            "starts_at": (now - timedelta(minutes=1)).isoformat(),
            "ends_at": (now + timedelta(hours=1)).isoformat(),
            "reason": "API integration test",
            "confirm_text": "PUBLISH",
        }
        denied = client.post(
            f"/api/admin/announcements/{item['id']}/publish",
            json=publish_payload,
            headers=csrf,
        )
        assert denied.status_code == 403

        with factory() as db:
            user = db.get(User, me["user"]["id"])
            assert user is not None
            user.access_role = "MODERATOR"
            db.commit()
        assert client.get("/api/admin/announcements").status_code == 403

        object.__setattr__(settings, "admin_steam_ids", ("76561198083722456",))
        published_response = client.post(
            f"/api/admin/announcements/{item['id']}/publish",
            json=publish_payload,
            headers=csrf,
        )
        assert published_response.status_code == 200
        published = published_response.json()["item"]
        assert published["phase"] == "ACTIVE"

        active_response = client.get(
            "/api/announcements/active?surface=SITE_PUBLIC",
            headers={"Accept-Language": "en"},
        )
        assert active_response.status_code == 200
        assert active_response.headers["cache-control"] == "no-store"
        public_item = active_response.json()["items"][0]
        assert public_item["id"] == item["id"]
        assert public_item["title"] == "Announcement API check"
        assert set(public_item) == {
            "id",
            "revision",
            "phase",
            "severity",
            "presentation",
            "effect",
            "dismiss_policy",
            "priority",
            "title",
            "body",
            "cta",
            "starts_at",
            "ends_at",
            "show_countdown",
        }

        receipt_url = f"/api/announcements/{item['id']}/receipt"
        receipt_payload = {
            "revision": published["revision"],
            "surface": "SITE_PUBLIC",
            "action": "ACKNOWLEDGED",
        }
        assert client.post(receipt_url, json=receipt_payload).status_code == 403
        assert (
            client.post(receipt_url, json=receipt_payload, headers=csrf).status_code
            == 200
        )
        assert (
            client.post(receipt_url, json=receipt_payload, headers=csrf).status_code
            == 200
        )
        assert (
            client.get("/api/announcements/active?surface=SITE_PUBLIC").json()["items"]
            == []
        )

        metrics = client.get(f"/api/admin/announcements/{item['id']}/metrics").json()
        assert metrics["totals"]["acknowledged_users"] == 1
        assert metrics["totals"]["impressions"] == 0

        with factory() as db:
            stored = db.get(SystemAnnouncement, item["id"])
            assert stored is not None
            assert stored.body_ru == _draft_payload()["body_ru"]
