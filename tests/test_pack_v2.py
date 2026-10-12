"""Paid-card guarantees and typed-slot packs use the actual archive transaction."""
import pytest
from uuid import uuid4

from sqlalchemy import func, select

from app.models import ArchiveCard, ArchiveItem, ArchiveLedger, ArchiveOperation, ArchivePack, ArchivePackVersion
from app.services import archive_packs as packs
from test_player_community import community
from test_archive_packs import owner


def test_thirtieth_paid_card_upgrades_to_a_and_resets_only_its_achieved_threshold():
    from app.services import pack_rules

    draw, counters = pack_rules.draw_slot("ORDINARY", {"without_a": 29, "without_s": 29, "without_sss": 29}, lambda total: 0)
    assert draw == {"slot_kind": "ORDINARY", "natural_rank": "F", "rank": "A", "guaranteed_minimum_rank": "A", "forced": True}
    assert counters == {"without_a": 0, "without_s": 30, "without_sss": 30}


@pytest.mark.parametrize("before,want", [
    ({"without_a": 29, "without_s": 119, "without_sss": 100}, ("S", {"without_a": 0, "without_s": 0, "without_sss": 101})),
    ({"without_a": 29, "without_s": 119, "without_sss": 359}, ("SSS", {"without_a": 0, "without_s": 0, "without_sss": 0})),
])
def test_coincident_guarantees_use_the_strongest_floor(before, want):
    from app.services import pack_rules

    draw, counters = pack_rules.draw_slot("ORDINARY", before, lambda total: 0)
    assert (draw["rank"], counters) == want
    assert draw["forced"]


def test_natural_sss_is_preserved_and_resets_every_counter():
    from app.services import pack_rules

    draw, counters = pack_rules.draw_slot("B_PLUS", {"without_a": 29, "without_s": 70, "without_sss": 359}, lambda total: total - 1)
    assert draw["natural_rank"] == draw["rank"] == "SSS"
    assert draw["guaranteed_minimum_rank"] == "SSS" and not draw["forced"]
    assert counters == {"without_a": 0, "without_s": 0, "without_sss": 0}


def test_next_forced_slot_discloses_actual_distribution():
    from app.services import pack_rules

    odds = {row["rank"]: row["weight"] for row in pack_rules.slot_odds("ORDINARY", "A")}
    assert odds == {"A": 9800, "S": 130, "SS": 55, "SSS": 15}
    assert sum(row["percent"] for row in pack_rules.slot_odds("B_PLUS")) == 100


@pytest.mark.parametrize("ticket,want", [(0, "F"), (3399, "F"), (3400, "E"), (5899, "E"), (5900, "D"), (9984, "SS"), (9985, "SSS"), (9999, "SSS")])
def test_ordinary_rank_probability_ticket_boundaries(ticket, want):
    from app.services import pack_rules

    draw, _ = pack_rules.draw_slot("ORDINARY", {"without_a": 0, "without_s": 0, "without_sss": 0}, lambda total: ticket)
    assert draw["natural_rank"] == draw["rank"] == want


def test_more_illustrations_do_not_increase_the_hero_variant_weight():
    from app.services import pack_rules

    entries = [{"card_id": f"abrams-{i}", "hero": "abrams", "rank": "A", "weight": 1} for i in range(10)]
    entries.append({"card_id": "haze", "hero": "haze", "rank": "A", "weight": 1})
    tickets = iter([1, 0])
    limits = []
    def random_ticket(total):
        limits.append(total)
        return next(tickets)
    assert pack_rules.choose_artwork(entries, "A", random_ticket) == "haze"
    assert limits == [2, 1]


def test_conflicting_weights_for_the_same_hero_variant_are_rejected():
    from app.services import pack_rules

    with pytest.raises(ValueError, match="variant"):
        pack_rules.choose_artwork([{"card_id": "a", "hero": "abrams", "rank": "F", "weight": 1},
                                   {"card_id": "b", "hero": "abrams", "rank": "F", "weight": 2}], "F", lambda total: 0)


def create_v2(factory, kind="NIGHT_ENVELOPE"):
    from app.battle_models import BattleArtwork, BattleDefinitionVersion
    from app.services.pack_rules import PRESETS, RANKS

    with factory() as db:
        definition = db.scalar(select(BattleDefinitionVersion).where(BattleDefinitionVersion.key == "abrams"))
        if definition is None:
            definition = BattleDefinitionVersion(key="abrams", category="HERO", version=1, approved=True, rules={})
            db.add(definition); db.flush()
        cards = []
        for rank in RANKS:
            card = ArchiveCard(hero="abrams", rank=rank, title="Approved " + rank, status="PUBLISHED", image_digest="fixture", image_data=b"fixture")
            db.add(card); db.flush()
            db.add(BattleArtwork(card_id=card.id, definition_id=definition.id, approved=True))
            cards.append({"card_id": card.id, "hero": card.hero, "rank": rank, "weight": 1})
        preset = PRESETS[kind]
        pack = ArchivePack(active=True)
        db.add(pack); db.flush()
        db.add(ArchivePackVersion(pack_id=pack.id, revision=1, config={
            "kind": kind, "rule_version": "packs-v2", "price_model": 3, "title": "Typed pack",
            "description": "Test", "price": preset["price"], "draws": len(preset["slots"]),
            "slots": preset["slots"], "entries": cards,
        }))
        db.commit()
        return pack.id, cards


def fund(factory, user_id, scope="REAL"):
    with factory() as db:
        db.add(ArchiveLedger(user_id=user_id, source="pack-fixture:" + str(uuid4()), reason="TEST", delta=5000, scope=scope))
        db.commit()


def open_v2(client, pack_id, revision, *, key=None, scope="REAL"):
    return client.post(f"/api/archive/packs/{pack_id}/open", json={"request_key": key or str(uuid4()),
        "revision": 1, "guarantee_revision": revision, "scope": scope})


def test_paid_v2_card_guarantees_are_atomic_and_replayed_without_advancing(community, monkeypatch):
    from app.pack_models import PackGuaranteeState

    factory, player = community
    user_id, client = player()
    pack_id, _ = create_v2(factory)
    fund(factory, user_id)
    with factory() as db:
        db.add(PackGuaranteeState(user_id=user_id, scope="REAL", without_a=29, without_s=0, without_sss=0, revision=3))
        db.commit()
    disclosed = client.get(f"/api/archive/packs/{pack_id}").json()["pack"]
    assert disclosed["guarantees"]["next_minimum_rank"] == "A"
    assert disclosed["guarantees"]["revision"] == 3
    monkeypatch.setattr(packs.secrets, "randbelow", lambda total: 0)
    key = str(uuid4())
    first = open_v2(client, pack_id, 3, key=key)
    assert first.status_code == 200, first.text
    receipt = first.json()
    assert receipt["delta"] == -180
    assert [item["card"]["rank"] for item in receipt["items"]] == ["A", "F", "F"]
    assert [item["forced"] for item in receipt["items"]] == [True, False, False]
    assert receipt["pack"]["guarantee_after"]["without_a"] == 2
    assert receipt["pack"]["guarantee_after"]["revision"] == 4
    assert open_v2(client, pack_id, 3, key=key).json() == receipt
    with factory() as db:
        state = db.scalar(select(PackGuaranteeState).where(PackGuaranteeState.user_id == user_id))
        assert (state.without_a, state.without_s, state.without_sss, state.revision) == (2, 3, 3, 4)
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == user_id)) == 1
        assert db.scalar(select(func.sum(ArchiveItem.cost_basis)).where(ArchiveItem.user_id == user_id)) == 180


def test_v2_pack_types_share_counters_but_test_scope_is_separate(community, monkeypatch):
    factory, player = community
    user_id, client = player()
    night, _ = create_v2(factory)
    folder, _ = create_v2(factory, "SPECIAL_FOLDER")
    fund(factory, user_id); fund(factory, user_id, "SANDBOX")
    monkeypatch.setattr(packs.secrets, "randbelow", lambda total: 0)
    assert open_v2(client, night, 0).status_code == 200
    assert open_v2(client, folder, 0).status_code == 409
    receipt = open_v2(client, folder, 1)
    assert receipt.status_code == 200, receipt.text
    assert [item["card"]["rank"] for item in receipt.json()["items"]] == ["F", "F", "F", "F", "B"]
    real = client.get(f"/api/archive/packs/{night}").json()["pack"]["guarantees"]
    assert (real["without_a"], real["revision"]) == (8, 2)
    sandbox = open_v2(client, night, 0, scope="SANDBOX")
    assert sandbox.status_code == 200, sandbox.text
    assert all(item["scope"] == "SANDBOX" for item in sandbox.json()["items"])
    assert client.get(f"/api/archive/packs/{night}").json()["pack"]["guarantees"] == real


def test_missing_promised_rank_stops_sale_without_charge_or_counter_change(community):
    from app.pack_models import PackGuaranteeState

    factory, player = community
    user_id, client = player()
    pack_id, cards = create_v2(factory)
    fund(factory, user_id)
    with factory() as db:
        db.get(ArchiveCard, cards[-1]["card_id"]).status = "ARCHIVED"
        db.commit()
    assert not client.get(f"/api/archive/packs/{pack_id}").json()["pack"]["ready"]
    assert open_v2(client, pack_id, 0).status_code == 409
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == user_id)) == 0
        assert db.scalar(select(func.count()).select_from(PackGuaranteeState).where(PackGuaranteeState.user_id == user_id)) == 0


def test_ex_is_a_base_in_catalogue_and_cannot_bypass_access_with_direct_purchase(community):
    factory, player = community
    user_id, client = player()
    with factory() as db:
        card = ArchiveCard(hero="HIDDEN_KING", rank="EX", title="Unapproved patron artwork", status="PUBLISHED", image_digest="fixture")
        db.add(card); db.commit(); card_id = card.id
    fund(factory, user_id)
    meta = client.get("/api/archive/meta").json()
    assert "EX" in meta["ranks"] and meta["direct_costs"]["EX"] == 1800
    response = client.get("/api/archive/cards?rank=EX")
    assert response.status_code == 200, response.text
    shown = response.json()["items"][0]
    assert shown["category"] == "BASE" and not shown["battle_eligible"]
    assert not shown["ex_access"]["eligible"]
    purchase = client.post(f"/api/archive/cards/{card_id}/acquire", json={"request_key": str(uuid4()), "expected_price": 1800})
    assert purchase.status_code == 409, purchase.text
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id)) == 0
        assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id)) == 5000


def test_author_identity_change_does_not_keep_combat_approval_or_pack_readiness(community):
    factory, player = community
    user_id, client = player()
    pack_id, cards = create_v2(factory)
    fund(factory, user_id)
    with factory() as db:
        db.get(ArchiveCard, cards[0]["card_id"]).hero = "haze"
        db.commit()
    shown = client.get("/api/archive/cards?hero=haze").json()["items"][0]
    assert not shown["battle_eligible"]
    assert not client.get(f"/api/archive/packs/{pack_id}").json()["pack"]["ready"]
    assert open_v2(client, pack_id, 0).status_code == 409


def test_direct_and_free_starter_cards_neither_advance_nor_reset_paid_counters(community, monkeypatch):
    factory, player = community
    user_id, client = player()
    pack_id, cards = create_v2(factory)
    fund(factory, user_id)
    monkeypatch.setattr(packs.secrets, "randbelow", lambda total: 0)
    assert open_v2(client, pack_id, 0).status_code == 200
    before = client.get(f"/api/archive/packs/{pack_id}").json()["pack"]["guarantees"]
    direct = client.post(f"/api/archive/cards/{cards[-1]['card_id']}/acquire", json={"request_key": str(uuid4()), "expected_price": 2600})
    assert direct.status_code == 200, direct.text
    with factory() as db:
        starter = ArchivePack(active=True, starter=True)
        db.add(starter); db.flush()
        db.add(ArchivePackVersion(pack_id=starter.id, revision=1, config={"title": "Free", "description": "",
            "price": 10, "draws": 1, "entries": [cards[-1]], "price_model": 2}))
        db.commit(); starter_id = starter.id
    free = client.post(f"/api/archive/packs/{starter_id}/open", json={"request_key": str(uuid4()), "revision": 1, "starter": True})
    assert free.status_code == 200, free.text
    assert client.get(f"/api/archive/packs/{pack_id}").json()["pack"]["guarantees"] == before


def test_v2_rename_keeps_algorithm_progress_and_original_receipt(community, owner, monkeypatch):
    factory, player = community
    user_id, client = player()
    pack_id, cards = create_v2(factory)
    fund(factory, user_id)
    monkeypatch.setattr(packs.secrets, "randbelow", lambda total: 0)
    key = str(uuid4())
    first = open_v2(client, pack_id, 0, key=key).json()
    update = owner[1].put(f"/api/owner/archive/packs/{pack_id}", json={"revision": 1, "title": "Renamed v2",
        "description": "Same rules", "price": 180, "draws": 3, "active": True,
        "entries": [{"card_id": entry["card_id"], "weight": 1} for entry in cards]})
    assert update.status_code == 200, update.text
    assert update.json()["pack"]["kind"] == "NIGHT_ENVELOPE"
    assert client.get(f"/api/archive/packs/{pack_id}").json()["pack"]["guarantees"]["without_a"] == 3
    assert open_v2(client, pack_id, 0, key=key).json() == first


def test_v2_seed_is_idempotent_and_does_not_unpause_or_rewrite_versions(community):
    from test_pack_collection_repair import originals

    factory, _ = community
    with factory() as db:
        originals(db)
        packs.seed_pack_v2(db)
        db.commit()
        seeded = list(db.scalars(select(ArchivePack)))
        assert len(seeded) == 2
        versions = list(db.scalars(select(ArchivePackVersion)))
        assert sorted((row.config["price"], row.config["draws"]) for row in versions) == [(180, 3), (450, 5)]
        assert all(len(row.config["entries"]) == 9 and all(entry["rank"] != "EX" for entry in row.config["entries"]) for row in versions)
        seeded[0].active = False
        db.commit()
        packs.seed_pack_v2(db)
        db.commit()
        assert not db.get(ArchivePack, seeded[0].id).active
        assert db.scalar(select(func.count()).select_from(ArchivePackVersion)) == 2


def test_owner_v2_preview_uses_slot_values_and_rejects_incomplete_or_ex_pools(community, owner):
    factory, _ = community
    _, cards = create_v2(factory)
    body = {"kind": "NIGHT_ENVELOPE", "title": "Reviewed v2", "description": "", "price": 180,
            "draws": 3, "entries": [{"card_id": entry["card_id"], "weight": 1} for entry in cards]}
    preview = owner[1].post("/api/owner/archive/packs/preview", json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()["recommendation"]["expected_direct_cost"] == 270.75
    folder = owner[1].post("/api/owner/archive/packs/preview", json={**body, "kind": "SPECIAL_FOLDER", "price": 450, "draws": 5})
    assert folder.json()["recommendation"]["expected_direct_cost"] == 685.5
    assert owner[1].post("/api/owner/archive/packs", json={**body, "entries": body["entries"][:-1]}).status_code == 422
    with factory() as db:
        base = ArchiveCard(hero="HIDDEN_KING", rank="EX", title="Patron", status="PUBLISHED", image_digest="fixture")
        db.add(base); db.commit(); base_id = base.id
    assert owner[1].post("/api/owner/archive/packs", json={**body, "kind": "LEGACY", "entries": [{"card_id": base_id, "weight": 1}]}).status_code == 422


def test_owner_grants_do_not_reset_sandbox_paid_card_guarantees(community, owner, monkeypatch):
    factory, _ = community
    owner_id, client = owner
    pack_id, cards = create_v2(factory)
    fund(factory, owner_id, "SANDBOX")
    monkeypatch.setattr(packs.secrets, "randbelow", lambda total: 0)
    assert open_v2(client, pack_id, 0, scope="SANDBOX").status_code == 200
    before = client.get(f"/api/archive/packs/{pack_id}?scope=SANDBOX").json()["pack"]["guarantees"]
    grant = client.post(f"/api/owner/archive/cards/{cards[-1]['card_id']}/grant", json={
        "request_key": str(uuid4()), "quantity": 1, "note": "Layout verification"})
    assert grant.status_code == 200, grant.text
    assert client.get(f"/api/archive/packs/{pack_id}?scope=SANDBOX").json()["pack"]["guarantees"] == before


def test_failed_pack_transaction_rolls_back_cards_payment_and_guarantees(community, monkeypatch):
    from app.archive_packs import OpenPack
    from app.pack_models import PackGuaranteeState

    factory, player = community
    user_id, _ = player()
    pack_id, _ = create_v2(factory)
    fund(factory, user_id)
    finish = packs.finish
    def crash(*args, **kwargs):
        raise RuntimeError("Delivery interrupted before commit")
    monkeypatch.setattr(packs, "finish", crash)
    payload = OpenPack(request_key=uuid4(), revision=1, guarantee_revision=0)
    with factory() as db:
        with pytest.raises(RuntimeError, match="interrupted"):
            packs.open_pack(db, user_id, pack_id, payload)
        db.rollback()
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id)) == 0
        assert db.scalar(select(func.count()).select_from(PackGuaranteeState).where(PackGuaranteeState.user_id == user_id)) == 0
        assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id)) == 5000
    monkeypatch.setattr(packs, "finish", finish)
    with factory() as db:
        assert len(packs.open_pack(db, user_id, pack_id, payload)["items"]) == 3


def test_inventory_offers_an_unreserved_duplicate_and_recycling_invalidates_saved_squad(community):
    from app.battle_models import BattleItemReservation, BattleMatch, BattleSquad

    factory, player = community
    user_id, client = player()
    _, cards = create_v2(factory)
    fund(factory, user_id)
    for _ in range(2):
        bought = client.post(f"/api/archive/cards/{cards[0]['card_id']}/acquire", json={
            "request_key": str(uuid4()), "expected_price": 25})
        assert bought.status_code == 200, bought.text
    original = client.get("/api/archive/inventory").json()["items"][0]["recycle"]["id"]
    with factory() as db:
        match = BattleMatch(user_id=user_id, mode="TRAINING", state={}, snapshot={})
        db.add(match); db.flush()
        db.add(BattleItemReservation(item_id=original, match_id=match.id))
        other = db.scalar(select(ArchiveItem).where(ArchiveItem.user_id == user_id, ArchiveItem.id != original))
        db.add(BattleSquad(user_id=user_id, scope="REAL", revision=1, slots=[{"item_id": other.id, "line": 0, "position": "FRONT"}]))
        db.commit(); other_id = other.id
    offered = client.get("/api/archive/inventory").json()["items"][0]["recycle"]
    assert offered["id"] == other_id
    blocked = client.post(f"/api/archive/items/{original}/recycle", json={"request_key": str(uuid4())})
    assert blocked.status_code == 409
    recycled = client.post(f"/api/archive/items/{other_id}/recycle", json={"request_key": str(uuid4())})
    assert recycled.status_code == 200, recycled.text
    with factory() as db:
        squad = db.scalar(select(BattleSquad).where(BattleSquad.user_id == user_id))
        assert squad.slots == [] and squad.revision == 2
