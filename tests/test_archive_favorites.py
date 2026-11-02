from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.main import app
from app.models import ArchiveItem, ArchiveLedger, ArchiveOperation, SessionToken, User, utcnow
from app.services.auth import COOKIE_NAME, csrf_token, hash_token
from test_archive_packs import published

pytest_plugins = ("test_player_community",)


def owned(factory, user_id, card_id):
    """Seed an existing collection item without invoking retired acquisition."""
    with factory() as db:
        operation = ArchiveOperation(user_id=user_id, request_key=str(uuid4()), signature="fixture",
                                     kind="OWNER_CARD", scope="REAL", result={"historical": True})
        db.add(operation); db.flush()
        db.add(ArchiveItem(user_id=user_id, card_id=card_id, operation_id=operation.id, cost_basis=25, scope="REAL"))
        db.commit()



def test_favorite_owned_card_is_private_idempotent_and_removable(community):
    factory, player = community
    user_id, client = player("Collector")
    _, other = player("Other")
    card_id = published(factory)
    owned(factory, user_id, card_id)

    with factory() as db:
        before = (
            db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == user_id)),
            db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id)),
            db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == user_id)),
        )

    saved = client.put(f"/api/archive/favorites/{card_id}", json={"favorite": True})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"card_id": card_id, "favorite": True}
    assert saved.headers["cache-control"] == "private, no-store"
    assert client.put(f"/api/archive/favorites/{card_id}", json={"favorite": True}).json() == saved.json()
    with factory() as db:
        assert db.scalar(text("SELECT count(*) FROM archive_favorites")) == 1
    favorites = client.get("/api/archive/favorites")
    assert favorites.json() == {"card_ids": [card_id]}
    assert favorites.headers["cache-control"] == "private, no-store"
    assert other.get("/api/archive/favorites").json() == {"card_ids": []}
    assert other.put(f"/api/archive/favorites/{card_id}", json={"favorite": True}).status_code == 404

    removed = client.put(f"/api/archive/favorites/{card_id}", json={"favorite": False})
    assert removed.json() == {"card_id": card_id, "favorite": False}
    assert client.put(f"/api/archive/favorites/{card_id}", json={"favorite": False}).json() == removed.json()
    assert client.get("/api/archive/favorites").json() == {"card_ids": []}
    with factory() as db:
        after = (
            db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == user_id)),
            db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id)),
            db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == user_id)),
        )
    assert after == before


def test_favorite_requires_auth_csrf_and_strict_payload(community):
    factory, player = community
    user_id, client = player()
    card_id = published(factory)
    owned(factory, user_id, card_id)

    csrf = client.headers.pop("X-CSRF-Token")
    assert client.put(f"/api/archive/favorites/{card_id}", json={"favorite": True}).status_code == 403
    client.headers["X-CSRF-Token"] = csrf
    assert client.put(f"/api/archive/favorites/{card_id}", json={"favorite": 1}).status_code == 422
    assert client.put(f"/api/archive/favorites/{card_id}", json={"favorite": True, "extra": 1}).status_code == 422
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/archive/favorites").status_code == 401
        assert anonymous.put(f"/api/archive/favorites/{card_id}", json={"favorite": True}).status_code in (401, 403)


def test_inventory_marks_and_filters_favorites_before_total_and_pagination(community):
    factory, player = community
    user_id, client = player()
    favorite = published(factory, rank="A", hero="haze")
    other = published(factory, rank="A", hero="haze")
    unrelated = published(factory, rank="F", hero="abrams")
    for card_id in (favorite, other, unrelated):
        owned(factory, user_id, card_id)
    assert client.put(f"/api/archive/favorites/{favorite}", json={"favorite": True}).status_code == 200

    inventory = client.get("/api/archive/inventory?hero=haze&rank=A&q=Released").json()
    assert inventory["total"] == 2
    assert {row["card"]["id"]: row["favorite"] for row in inventory["items"]} == {favorite: True, other: False}
    filtered = client.get("/api/archive/inventory?favorites_only=true&hero=haze&rank=A&q=Released").json()
    assert filtered["total"] == 1
    assert [row["card"]["id"] for row in filtered["items"]] == [favorite]
    assert filtered["items"][0]["favorite"] is True


def test_favorite_survives_retired_recycling_and_deletes_with_account(community):
    factory, player = community
    user_id, client = player()
    _, other = player()
    card_id = published(factory)
    owned(factory, user_id, card_id)
    owned(factory, user_id, card_id)
    assert client.put(f"/api/archive/favorites/{card_id}", json={"favorite": True}).status_code == 200
    duplicate = client.get("/api/archive/inventory").json()["items"][0]["recycle"]
    assert client.post(f"/api/archive/items/{duplicate['id']}/recycle", json={"request_key": str(uuid4())}).status_code == 410
    client.close()

    token = uuid4().hex
    with factory() as db:
        db.add(SessionToken(token_hash=hash_token(token), user_id=user_id, expires_at=utcnow() + timedelta(hours=1)))
        db.commit()
    with TestClient(app) as reopened:
        reopened.cookies.set(COOKIE_NAME, token)
        reopened.headers["X-CSRF-Token"] = csrf_token(token)
        assert reopened.get("/api/archive/favorites").json() == {"card_ids": [card_id]}
        inventory = reopened.get("/api/archive/inventory").json()
        assert inventory["items"][0]["favorite"] is True
        assert other.get("/api/archive/favorites").json() == {"card_ids": []}

        with factory() as db:
            for item in db.scalars(select(ArchiveItem).where(ArchiveItem.user_id == user_id, ArchiveItem.state == "OWNED")):
                item.state = "RECYCLED"
            db.commit()
        assert reopened.put(f"/api/archive/favorites/{card_id}", json={"favorite": False}).json() == {
            "card_id": card_id, "favorite": False}

        assert reopened.post("/api/account/delete", json={"confirmation": "DELETE"}).status_code == 200
    with factory() as db:
        assert db.get(User, user_id) is None
        assert db.scalar(text("SELECT count(*) FROM archive_favorites")) == 0
