from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import main
from app.db import Base, get_db


@pytest.fixture
def preview_client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'preview.db'}", connect_args={"check_same_thread": False})
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "SessionLocal", factory)

    def database():
        with factory() as session:
            yield session

    monkeypatch.setitem(main.app.dependency_overrides, get_db, database)
    try:
        with TestClient(main.app) as client:
            yield client
    finally:
        engine.dispose()


def test_preview_page_is_available_only_in_explicit_demo_development(preview_client, monkeypatch):
    response = preview_client.get("/dev/preview")
    assert response.status_code == 200
    assert "Открыть тестовый кабинет" in response.text
    assert response.headers["cache-control"] == "no-store"
    for changes in (
        {"allow_demo_auth": False},
        {"app_env": "production"},
        {"app_env": "staging"},
    ):
        with monkeypatch.context() as context:
            context.setattr(main, "settings", replace(main.settings, **changes))
            assert preview_client.get("/dev/preview").status_code == 404


def test_demo_session_can_lock_a_case_using_the_normal_csrf_protected_api(preview_client):
    client = preview_client
    assert client.post("/api/auth/demo").status_code == 200
    session = client.get("/api/me").json()
    boards = client.get("/api/boards/today").json()["boards"]
    board = next(item for item in boards if item["status"] == "OFFERED")
    selected = [option["id"] for option in board["options"][:2]]
    payload = {"mode": board["game_match_mode"], "option_ids": selected}
    assert client.post("/api/board/today/lock", json=payload).status_code == 403
    response = client.post(
        "/api/board/today/lock", json=payload,
        headers={"X-CSRF-Token": session["csrf_token"]},
    )
    assert response.status_code == 200
    receipt = response.json()
    assert receipt["id"] == board["id"]
    assert receipt["status"] == "LOCKED"
    assert {item["id"] for item in receipt["options"] if item["selected"]} == set(selected)
    assert receipt["locked_at"] and receipt["expires_at"] and receipt["max_attempts"] > 0
