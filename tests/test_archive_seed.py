"""The bundled release is additive, repeatable and separate from private artwork."""
from __future__ import annotations

import asyncio
import hashlib
import io
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import sessionmaker

from app import main as main_module
from app.db import Base
from app.models import (ArchiveCard, ArchiveFavorite, ArchiveItem, ArchiveLedger,
                        ArchiveOperation, ArchivePack, ArchivePackVersion, RewardLedgerEntry)
from app.services.seed import seed_missions
from app.services.archive_seed import RELEASE_CARD_IDS
from test_archive import create, decide
from test_archive_packs import buy, fund, published
from test_bureau_operations import elevate
from test_player_community import community


HEROES = {"nurse-harrow": "Nurse Harrow", "rat-king": "Rat King", "solomon": "Solomon",
          "deadman-danny": "Deadman Danny", "baba": "Baba", "violet": "Violet"}
SOURCE = "https://www.playdeadlock.com/cityneversleeps"
ARTWORK = Path(__file__).resolve().parents[1] / "app/data/archive/city-never-sleeps"


def restart():
    async def run():
        async with main_module.lifespan(main_module.app):
            pass
    asyncio.run(run())


@pytest.fixture()
def release(community, monkeypatch):
    factory, player = community
    monkeypatch.setattr(main_module, "engine", factory.kw["bind"])
    monkeypatch.setattr(main_module, "SessionLocal", factory)
    return factory, player


def test_startup_adds_six_collectible_cards_with_valid_credited_artwork(release):
    factory, player = release
    _, client = player()
    restart()
    catalog = client.get("/api/archive/cards?q=City Never Sleeps").json()
    assert catalog["total"] == 6
    assert {card["hero"]: card["hero_name"] for card in catalog["items"]} == HEROES
    assert client.get("/api/archive/inventory").json()["total"] == 0
    assert {pack["kind"] for pack in client.get("/api/archive/packs").json()["items"]} == {"NIGHT_ENVELOPE", "SPECIAL_FOLDER"}
    for card in catalog["items"]:
        UUID(card["id"])
        assert card["rank"] == "F" and card["status"] == "PUBLISHED" and card["revision"] == 1
        assert card["artist"] == "Valve" and card["source_url"] == SOURCE and card["published_at"]
        assert card.get("release_poster") is True
        image = client.get(card["image_url"])
        assert image.status_code == 200 and image.headers["content-type"] == "image/webp"
        assert image.content == (ARTWORK / f"{card['hero']}.webp").read_bytes()
        assert len(image.content) <= 300_000
        with Image.open(io.BytesIO(image.content)) as opened:
            assert opened.format == "WEBP" and min(opened.size) >= 240 and max(opened.size) <= 2048
            assert getattr(opened, "n_frames", 1) == 1
        filtered = client.get(f"/api/archive/cards?hero={card['hero']}&rank=F").json()
        assert filtered["total"] == 1 and filtered["items"][0]["id"] == card["id"]
        with factory() as db:
            row = db.get(ArchiveCard, card["id"])
            assert row.creator_id is None and row.rights_confirmed is False
            assert row.image_digest == hashlib.sha256(image.content).hexdigest()


def test_replaced_release_artwork_is_not_presented_as_the_original_poster(release):
    factory, player = release
    _, client = player()
    restart()
    card = client.get("/api/archive/cards?hero=nurse-harrow").json()["items"][0]
    replacement = io.BytesIO()
    Image.new("RGB", (240, 360), "#c47373").save(replacement, format="WEBP")
    with factory() as db:
        row = db.get(ArchiveCard, card["id"])
        row.title = "Curator replacement"
        row.image_data = replacement.getvalue()
        # A maintenance edit must not be misclassified even if the cached digest
        # and original source attribution were left unchanged.
        row.revision += 1
        db.commit()
    restart()
    updated = client.get("/api/archive/cards?hero=nurse-harrow").json()["items"][0]
    assert updated.get("release_poster") is False
    assert updated["title"] == "Curator replacement"
    assert client.get(updated["image_url"]).content == replacement.getvalue()


def test_release_ids_are_repeatable_on_restart_and_fresh_install(release):
    factory, _ = release
    restart()
    with factory() as db:
        before = {row.hero: (row.id, row.created_at, row.updated_at, row.image_digest)
                  for row in db.scalars(select(ArchiveCard).where(ArchiveCard.id.in_(RELEASE_CARD_IDS.values())))}
    assert len(before) == 6
    restart()
    with factory() as db:
        assert {row.hero: (row.id, row.created_at, row.updated_at, row.image_digest)
                for row in db.scalars(select(ArchiveCard).where(ArchiveCard.id.in_(RELEASE_CARD_IDS.values())))} == before
        # This isolated database has no owned items: recreate the release as a fresh install would.
        db.execute(delete(ArchiveCard))
        db.commit()
    restart()
    with factory() as db:
        assert {row.hero: row.id for row in db.scalars(select(ArchiveCard).where(ArchiveCard.id.in_(RELEASE_CARD_IDS.values())))} == {
            hero: values[0] for hero, values in before.items()}


def test_restart_preserves_admin_archival_and_existing_collection_state(release):
    factory, player = release
    user_id, client = player()
    admin_id, admin = player()
    elevate(factory, admin_id, admin, role="ADMIN")
    existing_id = published(factory, rank="A")
    fund(factory, user_id, 500)
    receipt = buy(client, existing_id, price=380).json()
    assert client.put(f"/api/archive/favorites/{existing_id}", json={"favorite": True}).status_code == 200
    config = {"title": "Existing pool", "description": "Keep this release", "price": 30, "draws": 1,
              "entries": [{"card_id": existing_id, "rank": "A", "weight": 7}], "price_model": 1}
    with factory() as db:
        pack = ArchivePack(active=True, starter=True, revision=4)
        db.add(pack); db.flush()
        pack_id = pack.id
        db.add(ArchivePackVersion(pack_id=pack_id, revision=4, config=config))
        db.commit()
    restart()
    release_cards = client.get("/api/archive/cards?hero=nurse-harrow").json()["items"]
    assert len(release_cards) == 1
    new_card = release_cards[0]
    archived = decide(admin, new_card, "ARCHIVE")
    assert archived.status_code == 200, archived.text
    with factory() as db:
        card = db.get(ArchiveCard, new_card["id"])
        # Preserve administrator maintenance as well as normal moderation transitions.
        card.title = "Curator-maintained title"
        card.artist = "Curator-maintained credit"
        db.commit()
    restart()
    assert client.get("/api/archive/cards?hero=nurse-harrow").json()["total"] == 0
    assert client.get("/api/archive/cards?q=City Never Sleeps").json()["total"] == 5
    assert client.get("/api/archive/cards?q=Released A").json()["items"][0]["id"] == existing_id
    assert client.get("/api/archive/wallet").json()["balance"] == 120
    inventory = client.get("/api/archive/inventory").json()
    assert inventory["total"] == 1
    assert inventory["items"][0]["card"]["id"] == existing_id
    assert inventory["items"][0]["quantity"] == 1 and inventory["items"][0]["favorite"] is True
    with factory() as db:
        card = db.get(ArchiveCard, new_card["id"])
        assert card.status == "ARCHIVED" and card.revision == 2 and card.reviewed_by == admin_id
        assert card.title == "Curator-maintained title" and card.artist == "Curator-maintained credit"
        assert db.scalar(select(ArchivePackVersion).where(ArchivePackVersion.pack_id == pack_id)).config == config
        assert db.get(ArchivePack, pack_id).revision == 4
        assert db.get(ArchiveOperation, receipt["id"]).result == receipt
        assert db.scalar(select(func.count()).select_from(ArchiveFavorite)) == 1
        assert db.scalar(select(func.count()).select_from(ArchiveItem)) == 1
        assert db.scalar(select(func.count()).select_from(RewardLedgerEntry)) == 0


def test_concurrent_startups_insert_only_one_of_each_release_card(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'startup.db'}", connect_args={"timeout": 15})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(main_module, "engine", engine)
    monkeypatch.setattr(main_module, "SessionLocal", factory)
    # This task changes archive startup. Prepare unrelated mission defaults before the race.
    with factory() as db:
        seed_missions(db)
    barrier = Barrier(2)
    def start(_):
        barrier.wait(timeout=10)
        restart()
    try:
        with ThreadPoolExecutor(max_workers=2) as workers:
            list(workers.map(start, range(2)))
        with factory() as db:
            cards = db.scalars(select(ArchiveCard).where(ArchiveCard.id.in_(RELEASE_CARD_IDS.values()))).all()
            assert len(cards) == 6 and {card.hero for card in cards} == set(HEROES)
    finally:
        engine.dispose()


def test_public_posters_allow_only_six_files_and_keep_custom_art_private(release):
    factory, player = release
    _, author = player()
    private_card = create(author)
    restart()
    with TestClient(main_module.app) as anonymous:
        for hero in HEROES:
            response = anonymous.get(f"/api/archive/releases/city-never-sleeps/{hero}.webp")
            assert response.status_code == 200, response.text
            assert response.content == (ARTWORK / f"{hero}.webp").read_bytes()
            assert response.headers["content-type"] == "image/webp"
            assert response.headers["x-content-type-options"] == "nosniff"
            assert response.headers["cache-control"].startswith("public,")
        for filename in ("abrams", private_card["id"], "manifest", "Nurse-Harrow", "nurse_harrow",
                         "%2E%2E%2Fmain.py", "%2E%2E%5Cmain.py", "nurse-harrow.webp"):
            assert anonymous.get(f"/api/archive/releases/city-never-sleeps/{filename}.webp").status_code == 404
        assert anonymous.get(private_card["image_url"]).status_code == 401
        assert anonymous.get("/api/archive/cards").status_code == 401
    with factory() as db:
        assert db.get(ArchiveCard, private_card["id"]).status == "DRAFT"
        assert db.scalar(select(func.count()).select_from(ArchiveItem)) == 0
        assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 0


def test_seeded_card_purchase_retry_uses_original_receipt_without_double_charge(release):
    factory, player = release
    user_id, client = player()
    restart()
    card = client.get("/api/archive/cards?hero=violet").json()["items"]
    assert len(card) == 1
    card_id = card[0]["id"]
    fund(factory, user_id, 30)
    request_key = str(uuid4())
    first = buy(client, card_id, key=request_key)
    assert first.status_code == 200, first.text
    restart()
    replay = buy(client, card_id, key=request_key)
    assert replay.status_code == 200 and replay.json() == first.json()
    assert first.json()["delta"] == -25 and first.json()["balance_after"] == 5
    assert first.json()["items"][0]["card"]["hero_name"] == "Violet"
    assert client.get("/api/archive/wallet").json()["balance"] == 5
    inventory = client.get("/api/archive/inventory").json()
    assert inventory["total"] == 1 and inventory["items"][0]["quantity"] == 1
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveOperation)) == 1
        assert db.scalar(select(func.count()).select_from(ArchiveItem)) == 1
        assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 2
