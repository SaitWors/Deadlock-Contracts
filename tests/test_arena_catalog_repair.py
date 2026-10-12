"""Retire the accidental arena release without changing a player's collection."""
import importlib.util
import os
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from threading import Barrier
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session

from app.battle_models import (
    BattleArtwork,
    BattleDefinitionVersion,
    BattleItemReservation,
    BattleMatch,
    BattleSquad,
)
from app.db import Base
from app.models import (
    ArchiveCard,
    ArchiveFavorite,
    ArchiveItem,
    ArchiveLedger,
    ArchiveOperation,
    ArchivePack,
    ArchivePackVersion,
    AuditLog,
    User,
)

ROOT = Path(__file__).resolve().parents[1]
LEGACY_HEROES = {
    "abrams": "Abrams", "bebop": "Bebop", "dynamo": "Dynamo", "haze": "Haze",
    "ivy": "Ivy", "kelvin": "Kelvin", "seven": "Seven", "infernus": "Infernus",
    "wraith": "Wraith", "mcginnis": "McGinnis", "lady-geist": "Lady Geist", "venator": "Venator",
    "HIDDEN_KING": "Hidden King: Court of Shadows", "ARCHMOTHER": "Archmother: Glass Cathedral",
}
LEGACY_RANKS = ("F", "E", "D", "C", "B", "A", "S", "SS", "SSS")
RELEASED_AT = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)


def legacy_id(*parts):
    return str(uuid5(NAMESPACE_URL, "deadlock-bureau-arena-v1:" + ":".join(parts)))


def seed_legacy_geometry(db):
    """The old release fixture is independent of today's production seeder."""
    links = []
    for hero, name in LEGACY_HEROES.items():
        base = hero in {"HIDDEN_KING", "ARCHMOTHER"}
        definition_id = legacy_id("definition", hero)
        db.add(BattleDefinitionVersion(id=definition_id, key=hero, category="BASE" if base else "HERO",
            approved=True, version=1, rules={"key": hero}, created_at=RELEASED_AT))
        artwork = (ROOT / "app/data/archive/bureau-arena" / f"{hero}.webp").read_bytes()
        for rank in ("EX",) if base else LEGACY_RANKS:
            card_id = legacy_id("card", hero, rank)
            db.add(ArchiveCard(id=card_id, hero=hero, rank=rank, title=f"Bureau Arena · {name}",
                description="Оригинальная символическая иллюстрация / Original symbolic artwork",
                artist="Bureau Arena", source_url="", rights_confirmed=False, image_data=artwork,
                image_digest=sha256(artwork).hexdigest(), status="PUBLISHED", revision=1,
                created_at=RELEASED_AT, updated_at=RELEASED_AT, published_at=RELEASED_AT))
            links.append(BattleArtwork(card_id=card_id, definition_id=definition_id, approved=True))
    # These models have scalar foreign keys, not ORM relationships that establish
    # unit-of-work ordering. Persist both parents before inserting their links.
    db.flush()
    db.add_all(links)
    db.commit()


@pytest.fixture()
def db():
    postgres_url = os.environ.get("ARENA_REPAIR_TEST_DATABASE_URL")
    schema = "arena_repair_test_" + uuid4().hex if postgres_url else None
    engine = sa.create_engine(postgres_url, connect_args={"options": f"-c search_path={schema}"}) \
        if postgres_url else sa.create_engine("sqlite://")
    try:
        if schema:
            assert engine.dialect.name == "postgresql", "Repair test URL must name a disposable PostgreSQL database"
            with engine.begin() as connection:
                connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        Base.metadata.create_all(engine)
        with Session(engine, autoflush=False) as session:
            seed_legacy_geometry(session)
            yield session
    finally:
        if schema:
            with engine.begin() as connection:
                connection.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        engine.dispose()


def repair():
    from app.services import arena_catalog_repair
    return arena_catalog_repair


def table_snapshot(db, name):
    table = Base.metadata.tables[name]
    return [deepcopy(dict(row)) for row in db.execute(sa.select(table).order_by(*table.primary_key.columns)).mappings()]


def add_owned_history(db):
    user = User(display_name="Existing collector")
    db.add(user); db.flush()
    pack = ArchivePack(active=True, revision=1)
    db.add(pack); db.flush()
    config = {"entries": [{"card_id": legacy_id("card", "abrams", "F"), "rank": "F", "weight": 1}],
              "price": 25, "title": "Historical paid pool"}
    version = ArchivePackVersion(pack_id=pack.id, revision=1, config=config)
    db.add(version); db.flush()
    receipt = {"items": [{"id": "paid-instance", "card": {"id": legacy_id("card", "abrams", "F"),
        "image_url": "/api/archive/cards/old/image?r=1"}}], "delta": -25, "balance_after": 75}
    paid = ArchiveOperation(user_id=user.id, request_key="paid-request", signature="paid-signature",
        kind="OPEN_PACK", pack_version_id=version.id, result=receipt)
    free = ArchiveOperation(user_id=user.id, request_key="free-request", signature="free-signature",
        kind="BATTLE_STARTER", result={"items": ["free-instance"]}, benefit_key="battle_starter_v1")
    sandbox = ArchiveOperation(user_id=user.id, request_key="sandbox-request", signature="sandbox-signature",
        kind="OWNER_CARD", scope="SANDBOX", result={"items": ["sandbox-instance"]})
    db.add_all([paid, free, sandbox]); db.flush()
    db.add_all([
        ArchiveItem(id="paid-instance", user_id=user.id, card_id=legacy_id("card", "abrams", "F"),
            operation_id=paid.id, cost_basis=25),
        ArchiveItem(id="free-instance", user_id=user.id, card_id=legacy_id("card", "ivy", "F"),
            operation_id=free.id, cost_basis=0),
        ArchiveItem(id="sandbox-instance", user_id=user.id, card_id=legacy_id("card", "haze", "SSS"),
            operation_id=sandbox.id, cost_basis=2600, scope="SANDBOX", test_grant=True),
        ArchiveLedger(user_id=user.id, source="earned", reason="CIPHER", delta=100),
        ArchiveLedger(user_id=user.id, source="operation:" + paid.id, reason="OPEN_PACK", delta=-25),
        ArchiveFavorite(user_id=user.id, card_id=legacy_id("card", "abrams", "F")),
        BattleSquad(user_id=user.id, slots=[{"item_id": "paid-instance", "line": 0, "position": "FRONT"}]),
    ])
    match = BattleMatch(user_id=user.id, mode="TRAINING", status="ACTIVE",
        state={"sides": [{"heroes": [{"item_id": "paid-instance", "rank": "F"}]}]},
        snapshot={"A": {"item_ids": ["paid-instance"], "definitions": {"abrams": {"hp": 650}}}})
    db.add(match); db.flush()
    db.add(BattleItemReservation(item_id="paid-instance", match_id=match.id))
    db.commit()


@pytest.mark.parametrize("runner", ["startup", "migration"])
def test_retirement_preserves_items_money_receipts_and_active_battle_snapshots(db, runner):
    add_owned_history(db)
    db.add(ArchiveCard(hero="abrams", rank="F", title="Original uploaded artwork", status="PUBLISHED",
                       image_data=b"original-untouched", image_digest="original-digest"))
    from app.services.archive_seed import seed_archive_cards
    seed_archive_cards(db)
    db.commit()
    before_cards = table_snapshot(db, "archive_cards")
    preserved_tables = ("archive_items", "archive_ledger", "archive_operations", "archive_favorites",
        "archive_packs", "archive_pack_versions", "battle_artworks", "battle_definition_versions",
        "battle_squads", "battle_matches", "battle_item_reservations")
    before = {name: table_snapshot(db, name) for name in preserved_tables}
    if runner == "startup":
        assert repair().retire_arena_placeholders(db) == 110
        assert repair().retire_arena_placeholders(db) == 0
    else:
        run_migration(db)
        run_migration(db)
    db.expire_all()
    for name in preserved_tables:
        assert table_snapshot(db, name) == before[name], name
    expected = deepcopy(before_cards)
    for card in expected:
        if card["artist"] == "Bureau Arena":
            card["status"] = "ARCHIVED"
    assert table_snapshot(db, "archive_cards") == expected
    assert db.scalar(sa.select(sa.func.sum(ArchiveLedger.delta))) == 75


@pytest.mark.parametrize("field,value", [
    ("id", "a-different-id"), ("hero", "baba"), ("rank", "SSS"), ("title", "Curator title"),
    ("description", "Curator description"), ("artist", "Curator credit"), ("source_url", "https://example.org/art"),
    ("rights_confirmed", True), ("image_data", b"replacement-with-original-cached-digest"),
    ("image_digest", "replacement-digest"), ("crop_x", 20), ("crop_y", 80), ("zoom", 1.5),
    ("frame_version", 2), ("status", "REMOVED"), ("revision", 2), ("review_note", "Reviewed explicitly"),
    ("creator_id", "curator"), ("reviewed_by", "curator"),
    ("submitted_at", RELEASED_AT), ("updated_at", RELEASED_AT + timedelta(seconds=1)),
    ("published_at", RELEASED_AT + timedelta(seconds=1)),
])
def test_fingerprint_rejects_a_seed_with_any_curator_change(db, field, value):
    card = db.get(ArchiveCard, legacy_id("card", "abrams", "F"))
    assert repair().is_pristine_arena_card(card)
    setattr(card, field, value)
    assert not repair().is_pristine_arena_card(card)


def test_fingerprint_recognizes_retired_seed_without_using_title_or_cached_digest_alone(db):
    card = db.get(ArchiveCard, legacy_id("card", "abrams", "F"))
    card.status = "ARCHIVED"
    assert repair().is_pristine_arena_card(card)
    card.image_data = b"curator-art"
    assert not repair().is_pristine_arena_card(card)


@pytest.mark.parametrize("runner", ["startup", "migration"])
@pytest.mark.parametrize("edit", ["archived", "title", "image", "approval", "definition", "audit"])
def test_retirement_keeps_curated_seed_or_explicit_moderation_untouched(db, runner, edit):
    identifier = legacy_id("card", "abrams", "F")
    card = db.get(ArchiveCard, identifier)
    if edit == "archived":
        card.status = "ARCHIVED"; card.revision = 2; card.review_note = "Curator archived this"
    elif edit == "title":
        card.title = "Curator-owned title"
    elif edit == "image":
        card.image_data = b"curator replacement"  # Cached digest deliberately remains original.
    elif edit == "approval":
        db.get(BattleArtwork, identifier).approved = False
    elif edit == "definition":
        replacement = BattleDefinitionVersion(key="abrams", category="HERO", approved=True, version=2, rules={"hp": 700})
        db.add(replacement); db.flush()
        db.get(BattleArtwork, identifier).definition_id = replacement.id
    else:
        db.add(AuditLog(action="arena.artwork_approval", entity_type="archive", entity_id=identifier,
                        data={"approved": True}))
    db.commit()
    before = next(row for row in table_snapshot(db, "archive_cards") if row["id"] == identifier)
    if runner == "startup":
        assert repair().retire_arena_placeholders(db) == 109
    else:
        run_migration(db)
    db.expire_all()
    assert next(row for row in table_snapshot(db, "archive_cards") if row["id"] == identifier) == before


def test_startup_repair_never_commits_the_callers_transaction(db):
    identifier = legacy_id("card", "abrams", "F")
    assert repair().retire_arena_placeholders(db) == 110
    db.rollback()
    db.expire_all()
    assert db.get(ArchiveCard, identifier).status == "PUBLISHED"


def run_migration(db, *, downgrade=False):
    path = ROOT / "alembic/versions/0023_restore_original_collection.py"
    specification = importlib.util.spec_from_file_location("restore_original_collection", path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(db.connection())):
        module.downgrade() if downgrade else module.upgrade()


def test_data_migration_downgrade_does_not_republish_retired_artwork(db):
    run_migration(db)
    run_migration(db, downgrade=True)
    db.expire_all()
    assert db.scalar(sa.select(sa.func.count()).select_from(ArchiveCard).where(ArchiveCard.status == "PUBLISHED")) == 0


def test_concurrent_postgresql_retirement_is_idempotent(db):
    if db.get_bind().dialect.name != "postgresql":
        pytest.skip("Set ARENA_REPAIR_TEST_DATABASE_URL to exercise real PostgreSQL row locks")
    barrier = Barrier(2)

    def retire(_):
        with Session(db.get_bind(), autoflush=False) as concurrent:
            barrier.wait(timeout=15)
            count = repair().retire_arena_placeholders(concurrent)
            concurrent.commit()
            return count

    with ThreadPoolExecutor(max_workers=2) as workers:
        counts = list(workers.map(retire, range(2)))
    assert sorted(counts) == [0, 110]
    assert db.scalar(sa.select(sa.func.count()).select_from(ArchiveCard).where(ArchiveCard.status == "ARCHIVED")) == 110
