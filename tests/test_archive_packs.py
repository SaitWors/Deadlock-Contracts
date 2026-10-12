from dataclasses import replace
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app import main as main_module
from app.models import (ArchiveCard, ArchiveItem, ArchiveLedger, ArchiveOperation, ArchivePack,
                        ArchivePackVersion, AuditLog, PublicProfile, RewardLedgerEntry, User)
from app.services import archive, archive_packs as service
from app.services.permissions import role_has_permission
from test_archive import design
from test_bureau_operations import elevate
from test_player_community import community


@pytest.fixture()
def owner(community, monkeypatch):
    factory, player = community
    owner_id, client = player("Owner")
    steam_id = 76561198000000034
    with factory() as db:
        db.get(User, owner_id).steam_id64 = steam_id
        db.commit()
    monkeypatch.setattr(main_module, "settings", replace(main_module.settings, admin_steam_ids=(str(steam_id),)))
    elevate(factory, owner_id, client, role="PLAYER")
    return owner_id, client


def published(factory, rank="F", hero="abrams"):
    image = archive.image_bytes(design()["image"])
    with factory() as db:
        card = ArchiveCard(hero=hero, rank=rank, title="Released " + rank, artist="Fixture", rights_confirmed=True,
                           status="PUBLISHED", image_data=image, image_digest="fixture")
        db.add(card); db.commit()
        return card.id


def fund(factory, user_id, amount=300):
    with factory() as db:
        db.add(ArchiveLedger(user_id=user_id, source="fixture:" + str(uuid4()), reason="TEST", delta=amount)); db.commit()


def definition(card_id, **changes):
    return {"title": "Night envelopes", "description": "Test release", "price": 30, "draws": 2,
            "active": True, "starter": False, "entries": [{"card_id": card_id, "weight": 1}], **changes}


def pack(client, card_id, **changes):
    result = client.post("/api/owner/archive/packs", json=definition(card_id, **changes))
    assert result.status_code == 200, result.text
    return result.json()["pack"]


def opening(client, item, *, key=None, starter=False):
    return client.post(f"/api/archive/packs/{item['id']}/open", json={"request_key": key or str(uuid4()), "revision": item["revision"], "starter": starter})


def buy(client, card_id, price=25, key=None):
    return client.post(f"/api/archive/cards/{card_id}/acquire", json={"request_key": key or str(uuid4()), "expected_price": price})


def test_owner_is_allowlisted_identity_and_requires_elevation(community, owner):
    factory, player = community
    card_id = published(factory)
    for role in ("PLAYER", "TESTER", "MODERATOR", "ADMIN", "OWNER"):
        user_id, client = player(role)
        elevate(factory, user_id, client, role=role)
        assert client.post("/api/owner/archive/packs", json=definition(card_id)).status_code == 403
        assert client.post("/api/owner/archive/tokens", json={"request_key": str(uuid4()), "delta": 10, "note": "Test grant"}).status_code == 403
        assert client.post(f"/api/owner/archive/cards/{card_id}/grant", json={"request_key": str(uuid4()), "quantity": 1, "note": "Test grant"}).status_code == 403
    for permission in ("packs.manage", "archive.grant_self"):
        assert role_has_permission("OWNER", permission)
        assert not role_has_permission("ADMIN", permission)
    owner_id, client = owner
    elevate(factory, owner_id, client, role="PLAYER", elevated=False)
    assert client.get("/api/owner/archive/packs").status_code == 403
    elevate(factory, owner_id, client, role="PLAYER")
    assert client.get("/api/owner/archive/packs").status_code == 200


def test_recommendation_matches_pool_weights_and_owner_can_choose_price(community, owner):
    factory, _ = community
    _, client = owner
    common = published(factory); rare = published(factory, "SSS")
    body = definition(common, price=31, draws=3, entries=[{"card_id": common, "weight": 100}, {"card_id": rare, "weight": 1}])
    response = client.post("/api/owner/archive/packs/preview", json=body)
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["recommendation"]["price"] == 85
    assert preview["recommendation"]["expected_direct_cost"] == 151.49
    assert [row["rank"] for row in preview["odds"]] == ["F", "SSS"]
    assert preview["odds"][0]["weight"] == 100 and preview["odds"][0]["total_weight"] == 101
    created = client.post("/api/owner/archive/packs", json=body).json()["pack"]
    assert created["price"] == 31 and created["recommendation"]["price"] == 85


def test_pack_config_validation_and_csrf(community, owner):
    factory, _ = community
    _, client = owner
    card_id = published(factory)
    invalid = [dict(price=0), dict(price=True), dict(draws=6), dict(entries=[]),
               dict(entries=[{"card_id": card_id, "weight": 0}]),
               dict(entries=[{"card_id": card_id, "weight": 1}] * 2), dict(price_model=99)]
    for changes in invalid:
        assert client.post("/api/owner/archive/packs", json=definition(card_id, **changes)).status_code == 422
    saved = client.headers.pop("X-CSRF-Token")
    assert client.post("/api/owner/archive/packs", json=definition(card_id)).status_code == 403
    client.headers["X-CSRF-Token"] = saved
    with factory() as db:
        db.get(ArchiveCard, card_id).status = "DRAFT"; db.commit()
    assert client.post("/api/owner/archive/packs", json=definition(card_id)).status_code == 422


def test_paid_opening_is_atomic_private_and_idempotent_even_after_pack_edit(community, owner):
    factory, player = community
    user_id, client = player(); _, other = player()
    card_id = published(factory)
    item = pack(owner[1], card_id, price=37, draws=3)
    fund(factory, user_id, 100)
    key = str(uuid4())
    response = opening(client, item, key=key)
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert receipt["delta"] == -37 and receipt["balance_after"] == 63
    assert [card["duplicate"] for card in receipt["items"]] == [False, True, True]
    assert opening(client, item, key=key).json() == receipt
    update = owner[1].put(f"/api/owner/archive/packs/{item['id']}", json={**definition(card_id, price=77), "revision": 1})
    assert update.status_code == 200, update.text
    assert opening(client, item, key=key).json() == receipt
    assert opening(client, item).status_code == 409
    assert client.get(f"/api/archive/requests/{key}").json()["operation"] == receipt
    assert other.get(f"/api/archive/requests/{key}").json()["operation"] is None
    assert other.get("/api/archive/inventory").json()["total"] == 0
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == user_id)) == 1
        assert db.scalar(select(func.sum(ArchiveItem.cost_basis)).where(ArchiveItem.user_id == user_id)) == 37
        versions = db.scalars(select(ArchivePackVersion).where(ArchivePackVersion.pack_id == item["id"]).order_by(ArchivePackVersion.revision)).all()
        assert [v.config["price"] for v in versions] == [37, 77]
        assert db.get(User, user_id).xp == 0 and db.scalar(select(func.count()).select_from(RewardLedgerEntry)) == 0


def test_no_funds_unavailable_cards_and_unpublished_packs_do_not_charge(community, owner):
    factory, player = community
    user_id, client = player()
    card_id = published(factory)
    item = pack(owner[1], card_id)
    assert opening(client, item).status_code == 409
    fund(factory, user_id, 100)
    with factory() as db:
        db.get(ArchiveCard, card_id).status = "ARCHIVED"; db.commit()
    assert not client.get(f"/api/archive/packs/{item['id']}").json()["pack"]["ready"]
    assert opening(client, item).status_code == 409
    assert owner[1].post(f"/api/owner/archive/packs/{item['id']}/pause", json={"revision": 1}).status_code == 200
    assert client.get(f"/api/archive/packs/{item['id']}").status_code == 404
    assert client.get("/api/archive/wallet").json()["balance"] == 100
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == user_id)) == 0
        assert db.scalar(select(func.count()).select_from(ArchiveItem)) == 0


def test_starter_is_once_per_account_across_packs(community, owner):
    factory, player = community
    user_id, client = player()
    card_id = published(factory)
    first = pack(owner[1], card_id, starter=True)
    second = pack(owner[1], card_id, starter=True)
    key = str(uuid4())
    receipt = opening(client, first, key=key, starter=True)
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["delta"] == 0 and receipt.json()["balance_after"] == 0
    assert opening(client, first, key=key, starter=True).json() == receipt.json()
    assert opening(client, second, starter=True).status_code == 409
    assert client.get("/api/archive/packs").json()["starter_claimed"]
    with factory() as db:
        assert db.scalar(select(func.sum(ArchiveItem.cost_basis)).where(ArchiveItem.user_id == user_id)) == 0


def test_direct_acquisition_quote_and_duplicate_refund_cannot_remove_last_copy(community, owner):
    factory, player = community
    user_id, client = player(); _, other = player()
    card_id = published(factory)
    fund(factory, user_id, 100)
    assert buy(client, card_id, price=1).status_code == 409
    first = buy(client, card_id)
    assert first.status_code == 200, first.text
    key = str(uuid4()); second = buy(client, card_id, key=key)
    assert second.status_code == 200, second.text
    assert buy(client, card_id, key=key).json() == second.json()
    inventory = client.get("/api/archive/inventory?hero=abrams&rank=F&q=Released").json()
    assert inventory["total"] == 1 and inventory["items"][0]["quantity"] == 2
    duplicate = inventory["items"][0]["recycle"]
    assert duplicate["value"] == 5
    url = f"/api/archive/items/{duplicate['id']}/recycle"
    body = {"request_key": str(uuid4())}
    assert other.post(url, json=body).status_code == 409
    receipt = client.post(url, json=body)
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["balance_after"] == 55
    assert client.post(url, json=body).json() == receipt.json()
    assert client.post(url, json={"request_key": str(uuid4())}).status_code == 409
    with factory() as db:
        last = db.scalar(select(ArchiveItem).where(ArchiveItem.user_id == user_id, ArchiveItem.state == "OWNED"))
        last_id = last.id
    assert client.post(f"/api/archive/items/{last_id}/recycle", json={"request_key": str(uuid4())}).status_code == 409


def test_owner_grants_are_self_only_audited_bounded_and_not_recyclable(community, owner):
    factory, player = community
    owner_id, client = owner
    other_id, _ = player()
    card_id = published(factory, "SSS")
    body = {"request_key": str(uuid4()), "delta": 150, "note": "Test first envelope"}
    first = client.post("/api/owner/archive/tokens", json=body)
    assert first.status_code == 200, first.text
    assert client.post("/api/owner/archive/tokens", json=body).json() == first.json()
    assert client.post("/api/owner/archive/tokens", json={**body, "delta": 500}).status_code == 409
    assert client.post("/api/owner/archive/tokens", json={**body, "user_id": other_id}).status_code == 422
    assert client.post("/api/owner/archive/tokens", json={**body, "request_key": str(uuid4()), "delta": -151}).status_code == 409
    grant = {"request_key": str(uuid4()), "quantity": 3, "note": "Testing card layout"}
    cards = client.post(f"/api/owner/archive/cards/{card_id}/grant", json=grant)
    assert cards.status_code == 200, cards.text
    assert client.post(f"/api/owner/archive/cards/{card_id}/grant", json=grant).json() == cards.json()
    assert client.get("/api/archive/inventory").json()["items"] == []
    inventory = client.get("/api/archive/inventory?scope=SANDBOX").json()["items"][0]
    assert inventory["quantity"] == inventory["test_count"] == 3 and inventory["recycle"] is None
    item_id = cards.json()["items"][0]["id"]
    assert client.post(f"/api/archive/items/{item_id}/recycle", json={"request_key": str(uuid4())}).status_code == 409
    with factory() as db:
        rows = db.scalars(select(AuditLog).where(AuditLog.action.like("archive.owner_grant_%"))).all()
        assert len(rows) == 2 and all(row.data["recipient_id"] == owner_id for row in rows)
        assert service.balance(db, other_id) == 0


def test_archived_owned_art_survives_and_showcase_respects_both_privacy_switches(community, owner):
    factory, player = community
    user_id, client = player(public=True); _, other = player()
    card_id = published(factory); other_card = published(factory, "A")
    fund(factory, user_id)
    assert buy(client, card_id).status_code == 200
    body = {"revision": 0, "card_ids": [other_card], "is_public": True}
    assert client.put("/api/archive/showcase", json=body).status_code == 422
    assert client.put("/api/archive/showcase", json={**body, "card_ids": [card_id]}).status_code == 200
    with factory() as db:
        profile = db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id)); slug = profile.slug
        db.get(ArchiveCard, card_id).status = "ARCHIVED"; db.commit()
    image_url = f"/api/archive/cards/{card_id}/image"
    assert client.get(image_url).status_code == 200 and other.get(image_url).status_code == 404
    public_image = f"/api/public/players/{slug}/archive/cards/{card_id}/image"
    assert other.get(public_image).status_code == 200
    with factory() as db:
        profile = db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id))
        payload = main_module._public_profile_payload(db, db.get(User, user_id), profile)
        assert payload["cards"][0]["image_url"] == public_image
        profile.is_public = False; db.commit()
    assert other.get(public_image).status_code == 404
    assert client.put("/api/archive/showcase", json={"revision": 1, "card_ids": [card_id], "is_public": False}).status_code == 200
    with factory() as db:
        profile = db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id)); profile.is_public = True; db.commit()
        payload = main_module._public_profile_payload(db, db.get(User, user_id), profile)
        assert payload["cards"] == [] and not payload["show_cards"]
    assert other.get(public_image).status_code == 404


def test_inventory_and_receipts_delete_with_account_but_released_design_remains(community, owner):
    factory, player = community
    user_id, client = player()
    card_id = published(factory)
    fund(factory, user_id)
    assert buy(client, card_id).status_code == 200
    assert client.post("/api/account/delete", json={"confirmation": "DELETE"}).status_code == 200
    with factory() as db:
        assert db.get(ArchiveCard, card_id) is not None
        assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id)) == 0
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == user_id)) == 0


def test_draw_weights_respect_ticket_boundaries(monkeypatch):
    tickets = iter([0, 1, 2])
    monkeypatch.setattr(service.secrets, "randbelow", lambda total: next(tickets))
    assert service.choose([{"card_id": "common", "weight": 2}, {"card_id": "rare", "weight": 1}], 3) == ["common", "common", "rare"]
