from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import event, func, select

from app.main import app
from app.models import ArchiveCard, ArchiveOperation
from app.services import archive_packs as service
from test_archive_packs import owner, pack, published
from test_player_community import community


def test_anonymous_daily_preview_reports_unavailable_without_issuing_cards(community, monkeypatch):
    factory, _ = community
    monkeypatch.setattr(service, "utcnow", lambda: datetime(2026, 11, 13, 23, 59, tzinfo=timezone.utc))
    with TestClient(app) as client:
        response = client.get("/api/public/archive/preview")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.json() == {
        "available": False,
        "next_reset_at": "2026-11-14T00:00:00+00:00",
        "cards": [],
    }
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveOperation)) == 0


def test_preview_is_limited_to_three_illustrated_heroes_from_current_daily_pool(community, owner):
    factory, player = community
    ids = [published(factory, hero=hero) for hero in ("abrams", "bebop", "haze", "ivy")]
    duplicate_hero = published(factory, rank="S", hero="abrams")
    unrelated = published(factory, hero="infernus")
    pack(owner[1], ids[0], entries=[{"card_id": cid, "weight": 1} for cid in [*ids, duplicate_hero]])
    with TestClient(app) as client:
        data = client.get("/api/public/archive/preview").json()
        assert data["available"] is True
        assert len(data["cards"]) == 3
        assert len({card["hero_name"] for card in data["cards"]}) == 3
        assert {card["id"] for card in data["cards"]}.issubset(set(ids))
        assert set(data) == {"available", "next_reset_at", "cards"}
        for card in data["cards"]:
            assert set(card) == {
                "id", "rank", "title", "hero_name", "crop_x", "crop_y", "zoom",
                "source_url", "image_url",
            }
            image = client.get(card["image_url"])
            assert image.status_code == 200
            assert image.headers["content-type"] == "image/webp"
            assert image.headers["cache-control"] == "no-store"
        exposed = {card["id"] for card in data["cards"]}
        for cid in {unrelated, duplicate_hero, *ids} - exposed:
            assert client.get(f"/api/public/archive/preview/{cid}/image").status_code == 404
        assert client.get("/api/archive/cards").status_code == 401
    _, regular = player()
    assert regular.get("/api/archive/cards").status_code == 410
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveOperation)) == 0


def test_withdrawn_card_and_inactive_pack_are_not_public_preview_backdoors(community, owner):
    factory, _ = community
    cid = published(factory)
    created = pack(owner[1], cid)
    with TestClient(app) as client:
        first = client.get("/api/public/archive/preview").json()
        assert first["cards"][0]["id"] == cid
        with factory() as db:
            db.get(ArchiveCard, cid).status = "DRAFT"
            db.commit()
        assert client.get(first["cards"][0]["image_url"]).status_code == 404
        assert client.get("/api/public/archive/preview").json()["cards"] == []
        with factory() as db:
            from app.models import ArchivePack
            db.get(ArchiveCard, cid).status = "PUBLISHED"
            db.get(ArchivePack, created["id"]).active = False
            db.commit()
        assert client.get(first["cards"][0]["image_url"]).status_code == 404
        assert client.get("/api/public/archive/preview").json()["available"] is False


def test_public_metadata_never_fetches_whole_pool_artwork_and_each_image_loads_only_itself(community, owner):
    factory, _ = community
    ids = [published(factory, hero=hero) for hero in ("abrams", "bebop", "haze", "ivy")]
    pack(owner[1], ids[0], entries=[{"card_id": cid, "weight": 1} for cid in ids])
    statements = []
    engine = factory.kw["bind"]

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        with TestClient(app) as client:
            payload = client.get("/api/public/archive/preview").json()
            assert len(payload["cards"]) == 3
            assert not any("archive_cards.image_data AS" in statement for statement in statements)
            for card in payload["cards"]:
                statements.clear()
                assert client.get(card["image_url"]).status_code == 200
                artwork_reads = [statement for statement in statements if "archive_cards.image_data AS" in statement]
                assert len(artwork_reads) == 1
                assert "WHERE archive_cards.id = ?" in artwork_reads[0]
    finally:
        event.remove(engine, "before_cursor_execute", record)
