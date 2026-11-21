from dataclasses import replace
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app import main as main_module
from app.models import ArchiveCard, ArchiveItem, ArchiveLedger, ArchiveOperation, AuditLog, RewardLedgerEntry, User
from app.pack_models import ArchivePackGift
from test_archive_packs import definition, owner, pack, published
from test_bureau_operations import elevate
from test_player_community import community


def grant_body(**fields):
    return {"request_key": str(uuid4()), "revision": 1, "quantity": 1, "reason": "Streamer event", **fields}


def reward_paths(user_id, card_id, pack_id):
    root = f"/api/admin/users/{user_id}"
    return (root + f"/rewards/cards/{card_id}", root + f"/rewards/packs/{pack_id}", root + "/xp-adjust")


def test_reward_owner_is_single_server_steam_identity_and_requires_totp_and_csrf(community, owner, monkeypatch):
    factory, player = community
    owner_id, client = owner
    other_id, other = player("Second owner")
    admin_id, admin = player("Streamer, DB administrator")
    mod_id, moderator = player("Moderator")
    recipient_id, recipient = player("Recipient")
    card_id = published(factory)
    release = pack(client, card_id)
    paths = reward_paths(recipient_id, card_id, release["id"])
    payloads = [grant_body(), grant_body(), {"delta": 100, "reason": "Test XP", "request_key": str(uuid4())}]
    other_steam_id = 76561198000000035
    with factory() as db:
        db.get(User, other_id).steam_id64 = other_steam_id
        db.get(User, admin_id).public_badges = ["STREAMER", "DEVELOPER"]
        db.commit()
    elevate(factory, admin_id, admin, role="ADMIN")
    elevate(factory, mod_id, moderator, role="MODERATOR")
    elevate(factory, other_id, other, role="PLAYER")
    owner_ids = (*main_module.settings.admin_steam_ids, str(other_steam_id))
    original_owner = owner_ids[0]
    monkeypatch.setattr(main_module, "settings", replace(main_module.settings, admin_steam_ids=owner_ids))
    for unauthorized in (recipient, admin, moderator, other, client):
        for path, payload in zip(paths, payloads):
            assert unauthorized.post(path, json=payload).status_code == 403

    monkeypatch.setattr(main_module, "settings", replace(main_module.settings, reward_owner_steam_id=original_owner))
    assert client.get("/api/admin/auth/status").json()["can_grant_rewards"] is True
    assert other.get("/api/admin/auth/status").json()["can_grant_rewards"] is False
    for path, payload in zip(paths, payloads):
        assert other.post(path, json=payload).status_code == 403
    legacy_path = f"/api/owner/archive/cards/{card_id}/grant"
    assert other.post(legacy_path, json={"request_key": str(uuid4()), "scope": "REAL", "quantity": 1, "note": "Legacy"}).status_code == 403

    elevate(factory, owner_id, client, elevated=False, role="PLAYER")
    for path, payload in zip(paths, payloads):
        assert client.post(path, json=payload).status_code == 403
    elevate(factory, owner_id, client, role="PLAYER")
    csrf = client.headers.pop("X-CSRF-Token")
    for path, payload in zip(paths, payloads):
        assert client.post(path, json=payload).status_code == 403
    client.headers["X-CSRF-Token"] = csrf
    for path, payload in zip(paths, payloads):
        result = client.post(path, json=payload)
        assert result.status_code == 200, result.text


def test_direct_grants_are_audited_visible_to_recipient_and_idempotent(community, owner):
    factory, player = community
    owner_id, client = owner
    uid, target = player("Streamer")
    card_id = published(factory)
    card_url, _, xp_url = reward_paths(uid, card_id, uuid4())
    cards = grant_body(quantity=2)
    xp = {"request_key": str(uuid4()), "delta": 350, "reason": "Event participation"}
    first = client.post(card_url, json=cards)
    assert first.status_code == 200, first.text
    assert [item["test_grant"] for item in first.json()["items"]] == [False, False]
    assert client.post(card_url, json=cards).json() == first.json()
    assert client.post(card_url, json={**cards, "quantity": 3}).status_code == 409
    assert client.post(card_url, json={**cards, "request_key": str(uuid4()), "scope": "SANDBOX"}).status_code == 422
    assert client.post(card_url, json=grant_body(revision=2)).status_code == 409
    assert client.post(xp_url, json=xp).json() == {"ok": True, "balance": 350}
    assert client.post(xp_url, json=xp).json() == {"ok": True, "balance": 350}
    assert client.post(xp_url, json={"delta": 350, "reason": xp["reason"]}).status_code == 422
    assert client.post(xp_url, json={**xp, "reason": "Changed reason"}).status_code == 409
    assert target.get("/api/archive/inventory").json()["items"][0]["quantity"] == 2
    with factory() as db:
        assert db.get(User, uid).xp == 350
        ledger, = db.scalars(select(RewardLedgerEntry).where(RewardLedgerEntry.user_id == uid)).all()
        assert ledger.source_type == "ADMIN_ADJUSTMENT"
        assert len(ledger.source_id) <= RewardLedgerEntry.__table__.c.source_id.type.length
        audit = db.get(AuditLog, ledger.id)
        assert audit.user_id == owner_id and audit.entity_id == uid and audit.data["reason"] == xp["reason"]
        card_audit, = db.scalars(select(AuditLog).where(AuditLog.action == "archive.owner_grant_card_to_player")).all()
        assert card_audit.user_id == owner_id and card_audit.data["recipient_id"] == uid


def test_gifts_are_recipient_only_pin_version_and_leave_daily_benefit_available(community, owner):
    factory, player = community
    owner_id, client = owner
    uid, receiver = player("Streamer")
    _, outsider = player("Another player")
    original_card, later_card = published(factory), published(factory, rank="A")
    release = pack(client, original_card)
    _, pack_url, _ = reward_paths(uid, original_card, release["id"])
    body = grant_body(quantity=2)
    result = client.post(pack_url, json=body)
    assert result.status_code == 200, result.text
    gift_id = result.json()["id"]
    assert client.post(pack_url, json=body).json() == result.json()
    change = client.put(f"/api/owner/archive/packs/{release['id']}", json=definition(later_card, title="Rotated pack", revision=1))
    assert change.status_code == 200, change.text
    assert client.post(pack_url, json=grant_body()).status_code == 409
    assert receiver.get("/api/archive/gift-packs").json()["items"] == [
        {"id": gift_id, "remaining": 2, "active": True, "title": release["title"], "draws": 2},
    ]
    assert outsider.get("/api/archive/gift-packs").json()["items"] == []
    assert receiver.get("/api/archive/inventory").json()["total"] == 0
    open_url = f"/api/archive/gift-packs/{gift_id}/open"
    redeem = {"remaining": 2, "request_key": str(uuid4())}
    assert outsider.post(open_url, json=redeem).status_code == 404
    with factory() as db:
        db.get(ArchiveCard, original_card).status = "ARCHIVED"
        db.commit()
    assert receiver.post(open_url, json=redeem).status_code == 409
    assert receiver.get("/api/archive/gift-packs").json()["items"][0]["remaining"] == 2
    with factory() as db:
        db.get(ArchiveCard, original_card).status = "PUBLISHED"
        db.commit()
    opened = receiver.post(open_url, json=redeem)
    assert opened.status_code == 200, opened.text
    receipt = opened.json()
    assert receipt["kind"] == "GIFT_PACK_OPEN" and receipt["pack"]["price"] == 0
    assert {item["card"]["id"] for item in receipt["items"]} == {original_card}
    assert receiver.post(open_url, json=redeem).json() == receipt
    assert receiver.post(open_url, json={**redeem, "request_key": str(uuid4())}).status_code == 409
    assert receiver.get(f"/api/archive/requests/{redeem['request_key']}").json()["operation"] == receipt
    assert receiver.post(open_url, json={"remaining": 1, "request_key": str(uuid4())}).status_code == 200
    assert receiver.get("/api/archive/gift-packs").json()["items"] == []
    assert receiver.get("/api/archive/daily-pack").json()["available"] is True
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == uid)) == 4
        assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == uid)) == 0
        audit, = db.scalars(select(AuditLog).where(AuditLog.action == "archive.owner_grant_pack_to_player")).all()
        assert audit.user_id == owner_id and audit.entity_id == gift_id and audit.data["recipient_id"] == uid


def test_postgresql_two_open_requests_cannot_consume_the_same_gift_count():
    import os
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from fastapi import HTTPException
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.schema import CreateSchema, DropSchema

    from app.archive_packs import OpenGift, OwnerPackGrant
    from app.db import Base
    from app.models import ArchivePack, ArchivePackVersion
    from app.services.owner_rewards import grant_pack, open_gift

    url = os.getenv("OWNER_REWARDS_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set OWNER_REWARDS_TEST_DATABASE_URL for the PostgreSQL test")
    schema = f"owner_rewards_{uuid4().hex}"
    engine = create_engine(url, execution_options={"schema_translate_map": {None: schema}})
    assert engine.dialect.name == "postgresql"
    with engine.begin() as connection:
        connection.execute(CreateSchema(schema))
        Base.metadata.create_all(connection)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    barrier = Barrier(2)
    try:
        with factory() as db:
            owner_user, target = User(), User()
            db.add_all([owner_user, target])
            release = ArchivePack(active=True)
            db.add(release)
            db.flush()
            card_id = published(factory)
            config = definition(card_id, entries=[{"card_id": card_id, "rank": "F", "weight": 1}])
            db.add(ArchivePackVersion(pack_id=release.id, revision=1, config=config))
            db.commit()
            gift_id = grant_pack(db, owner_user.id, target.id, release.id, OwnerPackGrant(**grant_body(quantity=2)))["id"]
            target_id = target.id

        def redeem(_):
            with factory() as db:
                barrier.wait(timeout=10)
                try:
                    return open_gift(db, target_id, gift_id, OpenGift(request_key=uuid4(), remaining=2))["kind"]
                except HTTPException as exc:
                    return str(exc.status_code)

        with ThreadPoolExecutor(max_workers=2) as executor:
            assert set(executor.map(redeem, range(2))) == {"GIFT_PACK_OPEN", "409"}
        with factory() as db:
            assert db.get(ArchivePackGift, gift_id).remaining == 1
            assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.kind == "GIFT_PACK_OPEN")) == 1
    finally:
        with engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        engine.dispose()
