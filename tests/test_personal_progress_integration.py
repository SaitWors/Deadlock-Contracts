from http.cookies import SimpleCookie
from time import time_ns

from fastapi import Response
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import User
from app.services.auth import COOKIE_NAME, create_session
from app.services.companion import create_pairing


def test_live_progress_route_requires_session_and_uses_only_its_account():
    with TestClient(app) as client:
        assert client.get("/api/personal-progress").status_code == 401
        with SessionLocal() as db:
            unique = time_ns() % 1_000_000_000
            user = User(account_id=8_600_000_000 + unique,
                        steam_id64=76_561_198_100_000_000 + unique,
                        display_name="Private progress")
            db.add(user)
            db.commit()
            response = Response()
            create_session(db, user, response)
        cookies = SimpleCookie(response.headers["set-cookie"])
        client.cookies.set(COOKIE_NAME, cookies[COOKIE_NAME].value)
        # Boards must be the same existing server offers that signing accepts.
        boards = client.get("/api/boards/today").json()["boards"]
        standard = next(item for item in boards if item["game_match_mode"] == "STANDARD")
        result = client.get("/api/personal-progress?mode=STANDARD&intent=PRACTICE&account_id=17")
        assert result.status_code == 200
        assert result.headers["cache-control"] == "private, no-store"
        progress = result.json()
        assert progress["sample_size"] == 0
        assert progress["debrief"] is None
        assert progress["heroes"] == []
        assert progress["board"]["id"] == standard["id"]
        offered = {item["id"] for item in standard["options"]}
        assert progress["goal"]["option_id"] in offered
        assert all(item["option_id"] in offered for item in progress["alternatives"])
        assert client.get("/api/personal-progress?mode=UNKNOWN").status_code == 422
        assert client.get("/api/personal-progress?intent=INVALID").status_code == 422


def test_desktop_bootstrap_delivers_the_same_private_progress_projection():
    with TestClient(app) as client:
        unique = time_ns() % 1_000_000_000
        with SessionLocal() as db:
            user = User(account_id=8_700_000_000 + unique,
                        steam_id64=76_561_198_200_000_000 + unique,
                        display_name="Desktop progress")
            db.add(user)
            db.commit()
            code, _ = create_pairing(db, user)
        claim = client.post("/api/companion/pairing/claim", json={
            "code": code, "device_id": f"progress-{unique}",
            "label": "Progress test", "version": "0.5.2-alpha.18",
        }, headers={"Origin": "www.overwolf.com://deadlockcontracts"})
        assert claim.status_code == 200
        response = client.get("/api/desktop/v1/bootstrap", headers={
            "Authorization": f"Bearer {claim.json()['token']}",
            "Origin": "www.overwolf.com://deadlockcontracts",
        })
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
        payload = response.json()
        assert "personal_progress_v1" in payload["desktop_features"]
        assert set(payload["personal_progress"]) == {"STANDARD", "RANKED", "STREET_BRAWL"}
        boards = {item["game_match_mode"]: item for item in payload["boards"]}
        for mode, progress in payload["personal_progress"].items():
            assert progress["version"] == "personal-progress-1"
            assert progress["mode"] == mode
            assert progress["board"]["id"] == boards[mode]["id"]
            assert progress["sample_size"] == 0
            assert progress["debrief"] is None
