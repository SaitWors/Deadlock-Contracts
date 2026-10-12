"""Original collectible artwork supplies future packs without rewriting purchases."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import ArchiveCard, ArchiveItem, ArchiveLedger, ArchiveOperation, ArchivePack, ArchivePackVersion, AuditLog, User, utcnow
from app.pack_models import PackGuaranteeState
from app.services import archive_packs as packs
from app.services.pack_rules import RANKS


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as session:
        yield session
    engine.dispose()


def originals(db, hero="baba", ranks=RANKS):
    image = BytesIO()
    Image.new("RGB", (240, 360), "#79594d").save(image, format="WEBP")
    artwork = image.getvalue()
    result = []
    for rank in ranks:
        card = ArchiveCard(hero=hero, rank=rank, title=f"Original {hero} {rank}", artist="Original artist",
                           status="PUBLISHED", image_data=artwork, image_digest=sha256(artwork).hexdigest())
        db.add(card); db.flush()
        result.append({"card_id": card.id, "hero": hero, "rank": rank, "weight": 1})
    return result


def historical_preset(db, *, active=True, edited=False):
    """Reproduce the released PR50 database, independent of today's startup seed."""
    from app.battle_models import BattleArtwork, BattleDefinitionVersion

    heroes = ("abrams", "bebop", "dynamo", "haze", "ivy", "kelvin", "seven", "infernus", "wraith", "mcginnis", "lady-geist", "venator")
    assets = Path(__file__).resolve().parents[1] / "app/data/archive/bureau-arena"
    now = utcnow()
    entries = []
    for hero in heroes:
        artwork = (assets / f"{hero}.webp").read_bytes()
        definition_id = str(uuid5(NAMESPACE_URL, "deadlock-bureau-arena-v1:definition:" + hero))
        db.add(BattleDefinitionVersion(id=definition_id, key=hero, category="HERO", version=1, approved=True, rules={}))
        db.flush()
        for rank in RANKS:
            identifier = str(uuid5(NAMESPACE_URL, "deadlock-bureau-arena-v1:card:" + hero + ":" + rank))
            db.add(ArchiveCard(id=identifier, hero=hero, rank=rank,
                title="Bureau Arena · " + hero.replace("-", " ").title(),
                description="Оригинальная символическая иллюстрация / Original symbolic artwork",
                artist="Bureau Arena", source_url="", rights_confirmed=False,
                image_data=artwork, image_digest=sha256(artwork).hexdigest(), status="PUBLISHED",
                revision=1, created_at=now, updated_at=now, published_at=now))
            db.flush()
            db.add(BattleArtwork(card_id=identifier, definition_id=definition_id, approved=True))
            entries.append({"card_id": identifier, "hero": hero, "rank": rank, "weight": 1})
    # McGinnis is the only seeded name not reproduced by title casing.
    db.flush()
    for card in db.scalars(select(ArchiveCard).where(ArchiveCard.hero == "mcginnis")):
        card.title = "Bureau Arena · McGinnis"
    config = {"kind": "NIGHT_ENVELOPE", "rule_version": "packs-v2", "price_model": 3,
        "title": "Ночной конверт / Night envelope",
        "description": "Оплаченные карты с общими гарантиями / Paid cards with shared guarantees",
        "price": 180, "draws": 3, "slots": ["ORDINARY", "ORDINARY", "ORDINARY"],
        "entries": sorted(entries, key=lambda entry: (entry["rank"], entry["hero"], entry["card_id"]))}
    if edited:
        config["title"] = "Curator pack"
    identifier = str(uuid5(NAMESPACE_URL, "deadlock-contracts:pack-v2:NIGHT_ENVELOPE"))
    version_id = str(uuid5(NAMESPACE_URL, "deadlock-contracts:pack-v2-version:NIGHT_ENVELOPE"))
    pack = ArchivePack(id=identifier, revision=1, active=active, starter=False)
    db.add(pack); db.flush()
    db.add(ArchivePackVersion(id=version_id, pack_id=identifier, revision=1, config=config))
    db.commit()
    return pack, deepcopy(config)


def test_collectible_hero_without_battle_rules_is_ready_for_paid_pack(db):
    entries = originals(db)
    cards = packs.cards_for_pool(db, entries)
    assert packs.ready_v2_pool(db, entries, cards)


@pytest.mark.parametrize("change", ["unknown-hero", "missing-image", "invalid-rank", "mixed-weight"])
def test_paid_pack_rejects_invalid_original_pool(db, change):
    entries = originals(db)
    cards = packs.cards_for_pool(db, entries)
    if change == "unknown-hero":
        cards[entries[0]["card_id"]].hero = entries[0]["hero"] = "unknown-hero"
    elif change == "missing-image":
        cards[entries[0]["card_id"]].image_data = None
    elif change == "invalid-rank":
        cards[entries[0]["card_id"]].rank = entries[0]["rank"] = "EX"
    else:
        duplicate = originals(db, ranks=("F",))[0]
        duplicate["weight"] = 2
        entries.append(duplicate)
        cards.update(packs.cards_for_pool(db, [duplicate]))
    assert not packs.ready_v2_pool(db, entries, cards)


def test_fresh_presets_use_original_art_without_battle_links(db):
    entries = originals(db)
    packs.seed_pack_v2(db)
    db.commit()
    versions = list(db.scalars(select(ArchivePackVersion)))
    assert len(versions) == 2
    assert all({entry["card_id"] for entry in version.config["entries"]} == {entry["card_id"] for entry in entries}
               for version in versions)
    assert sorted((version.config["price"], version.config["draws"]) for version in versions) == [(180, 3), (450, 5)]


def test_original_collectible_purchase_keeps_guarantees_and_idempotent_receipt(db):
    from app.archive_packs import OpenPack

    entries = originals(db)
    user = User(); db.add(user); db.flush()
    db.add(ArchiveLedger(user_id=user.id, source="fixture", reason="TEST", delta=5000))
    packs.seed_pack_v2(db); db.commit()
    pack_id = str(uuid5(NAMESPACE_URL, "deadlock-contracts:pack-v2:NIGHT_ENVELOPE"))
    payload = OpenPack(request_key=uuid4(), revision=1, guarantee_revision=0)
    receipt = packs.open_pack(db, user.id, pack_id, payload)
    assert receipt["delta"] == -180 and receipt["balance_after"] == 4820
    assert len(receipt["items"]) == 3
    assert {item["card"]["id"] for item in receipt["items"]} <= {entry["card_id"] for entry in entries}
    assert all(item["card"]["hero"] == "baba" and item["card"]["artist"] == "Original artist" for item in receipt["items"])
    assert packs.open_pack(db, user.id, pack_id, payload) == receipt
    assert db.scalar(select(func.count()).select_from(ArchiveOperation)) == 1
    assert db.scalar(select(func.sum(ArchiveItem.cost_basis))) == 180
    assert packs.guarantee_state(db, user.id, "REAL").revision == 1


def test_geometry_only_catalogue_does_not_seed_future_packs(db):
    pack, _ = historical_preset(db)
    db.delete(db.scalar(select(ArchivePackVersion))); db.delete(pack); db.commit()
    packs.seed_pack_v2(db)
    db.commit()
    assert db.scalar(select(func.count()).select_from(ArchivePack)) == 0


def test_pristine_preset_appends_original_pool_and_preserves_history(db):
    pack, historical = historical_preset(db)
    entries = originals(db)
    user = User(); db.add(user); db.flush()
    receipt = {"kind": "PACK_OPEN", "items": [{"id": "historical-item", "card": {"id": historical["entries"][0]["card_id"]}}]}
    operation = ArchiveOperation(user_id=user.id, request_key=str(uuid4()), signature="historical", kind="PACK_OPEN", result=receipt)
    db.add(operation); db.flush()
    item = ArchiveItem(user_id=user.id, operation_id=operation.id, card_id=historical["entries"][0]["card_id"], cost_basis=60)
    db.add(item)
    db.add(PackGuaranteeState(user_id=user.id, scope="REAL", without_a=17, without_s=40, without_sss=80, revision=8))
    db.commit()
    packs.seed_pack_v2(db); db.commit()
    assert pack.revision == 2 and pack.active
    versions = list(db.scalars(select(ArchivePackVersion).where(ArchivePackVersion.pack_id == pack.id).order_by(ArchivePackVersion.revision)))
    assert len(versions) == 2 and versions[0].config == historical
    assert {entry["card_id"] for entry in versions[1].config["entries"]} == {entry["card_id"] for entry in entries}
    assert db.get(ArchiveOperation, operation.id).result == receipt
    assert db.get(ArchiveItem, item.id).card_id == historical["entries"][0]["card_id"]
    assert db.get(ArchiveItem, item.id).cost_basis == 60
    state = db.scalar(select(PackGuaranteeState).where(PackGuaranteeState.user_id == user.id))
    assert (state.without_a, state.without_s, state.without_sss, state.revision) == (17, 40, 80, 8)
    packs.seed_pack_v2(db); db.commit()
    assert pack.revision == 2
    assert db.scalar(select(func.count()).select_from(ArchivePackVersion).where(ArchivePackVersion.pack_id == pack.id)) == 2


@pytest.mark.parametrize("active,edited", [(False, False), (True, True)])
def test_preset_repair_preserves_paused_and_curator_edited_packs(db, active, edited):
    pack, historical = historical_preset(db, active=active, edited=edited)
    originals(db)
    packs.seed_pack_v2(db); db.commit()
    assert pack.revision == 1 and pack.active == active
    assert packs.pack_version(db, pack).config == historical


@pytest.mark.parametrize("change", ["starter", "creator", "extra-version", "version-id", "weight", "audit"])
def test_preset_repair_requires_untouched_pack_history(db, change):
    pack, historical = historical_preset(db)
    originals(db)
    version = packs.pack_version(db, pack)
    if change == "starter":
        pack.starter = True
    elif change == "creator":
        user = User(); db.add(user); db.flush(); pack.creator_id = user.id
    elif change == "extra-version":
        db.add(ArchivePackVersion(pack_id=pack.id, revision=2, config=historical))
    elif change == "version-id":
        version.id = str(uuid4())
    elif change == "weight":
        historical["entries"][0]["weight"] = 2
        version.config = historical
    else:
        db.add(AuditLog(action="archive.pack_updated", entity_type="archive", entity_id=pack.id, data={}))
    db.commit()
    packs.seed_pack_v2(db); db.commit()
    assert pack.revision == 1
    assert packs.pack_version(db, pack).config == historical


def test_seed_does_not_fill_missing_history_on_existing_paused_pack(db):
    pack, _ = historical_preset(db, active=False)
    db.delete(packs.pack_version(db, pack)); db.commit()
    originals(db)
    packs.seed_pack_v2(db); db.commit()
    assert not pack.active and pack.revision == 1
    assert db.scalar(select(func.count()).select_from(ArchivePackVersion).where(ArchivePackVersion.pack_id == pack.id)) == 0


def test_missing_original_rank_pauses_synthetic_sale_without_payment(db):
    from app.archive_packs import OpenPack
    from fastapi import HTTPException

    pack, historical = historical_preset(db)
    originals(db, ranks=RANKS[:-1])
    user = User(); db.add(user); db.flush()
    db.add(ArchiveLedger(user_id=user.id, source="fixture", reason="TEST", delta=5000))
    db.commit()
    packs.seed_pack_v2(db); db.commit()
    assert pack.revision == 1 and packs.pack_version(db, pack).config == historical
    assert not packs.pack_payload(db, pack, user_id=user.id)["ready"]
    with pytest.raises(HTTPException) as failure:
        packs.open_pack(db, user.id, pack.id, OpenPack(request_key=uuid4(), revision=1, guarantee_revision=0))
    assert failure.value.status_code == 409
    db.rollback()
    assert packs.balance(db, user.id) == 5000
    assert db.scalar(select(func.count()).select_from(ArchiveOperation)) == 0
    assert db.scalar(select(func.count()).select_from(PackGuaranteeState)) == 0
