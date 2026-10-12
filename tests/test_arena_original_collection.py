"""Original physical collection cards, images and rules remain separate."""
import hashlib
import io
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import func, select

from app.battle_models import BattleArtwork, BattleDefinitionVersion
from app.models import ArchiveCard, ArchiveItem, ArchiveOperation
from app.services import battle_service as arena
from app.services.archive import battle_metadata
from app.services.battle_catalog import seed_battle_catalogue
from test_card_battle_service import db, player  # noqa: F401
from test_player_community import community  # noqa: F401


def acquisition(db, user):
    operation = ArchiveOperation(user_id=user.id, request_key=str(uuid4()), signature="original-purchase",
                                 kind="DIRECT_CARD", scope="REAL", result={"original": True})
    db.add(operation); db.flush()
    return operation.id


def originals(db, user=None, *, rank="F", status="PUBLISHED"):
    cards, slots = [], []
    operation_id = acquisition(db, user) if user else None
    for index, key in enumerate(arena.STARTER):
        image = io.BytesIO()
        Image.new("RGB", (240, 360), (40 + index * 20, 90, 130)).save(image, format="WEBP")
        artwork = image.getvalue()
        card = ArchiveCard(hero=key, rank=rank, title=f"Original {key}", artist="Original artist",
                           image_data=artwork, image_digest=hashlib.sha256(artwork).hexdigest(), status=status)
        db.add(card); db.flush(); cards.append(card)
        if user:
            item = ArchiveItem(user_id=user.id, card_id=card.id, operation_id=operation_id,
                               scope="REAL", state="OWNED", cost_basis=70)
            db.add(item); db.flush()
            slots.append({"item_id": item.id, "line": index // 2, "position": "FRONT" if index % 2 == 0 else "BACK"})
    return cards, slots


def assert_webp(response, expected):
    assert response.status_code == 200, response.text
    assert response.content == expected
    assert response.headers["content-type"] == "image/webp"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.format == "WEBP" and image.size == (240, 360)


def test_rules_seed_creates_no_parallel_archive_cards(db):
    seed_battle_catalogue(db); seed_battle_catalogue(db)
    assert db.scalar(select(func.count()).select_from(ArchiveCard)) == 0
    assert db.scalar(select(func.count()).select_from(BattleDefinitionVersion)) == 14


@pytest.mark.parametrize("status", ["PUBLISHED", "ARCHIVED"])
def test_original_owned_cards_keep_exact_instances_and_images_in_battle(db, status):
    seed_battle_catalogue(db)
    user = player(db)
    cards, slots = originals(db, user, rank="D", status=status)
    before = [(card.id, card.image_data, card.image_digest, card.rank, card.revision) for card in cards]
    view = arena.bootstrap(db, user.id)
    original_ids = {card.id for card in cards}
    assert {row["card"]["id"] for row in view["inventory"]} == original_ids
    assert set(battle_metadata(db, cards)) == original_ids
    arena.save_squad(db, user.id, 0, "REAL", None, slots)
    match = arena.start_match(db, user.id, {"request_key": str(uuid4()), "mode": "TRAINING", "scope": "REAL",
                                          "squad_revision": 1, "base_item_id": None})["match"]
    heroes = match["state"]["sides"][0]["heroes"]
    assert {hero["item_id"] for hero in heroes} == {slot["item_id"] for slot in slots}
    assert {hero["card"]["id"] for hero in heroes} == original_ids
    assert all(hero["definition_id"] and hero["definition_version"] == 1 for hero in heroes)
    assert [(card.id, card.image_data, card.image_digest, card.rank, card.revision) for card in cards] == before
    assert len(list(db.scalars(select(ArchiveItem).where(ArchiveItem.user_id == user.id)))) == 6


def test_original_starter_uses_existing_catalogue_ids_and_does_not_create_cards(db):
    seed_battle_catalogue(db)
    cards, _ = originals(db)
    user = player(db); key = str(uuid4())
    result = arena.claim_starter(db, user.id, key)
    assert {item["card"]["id"] for item in result["receipt"]["items"]} == {card.id for card in cards}
    assert db.scalar(select(func.count()).select_from(ArchiveCard)) == 6
    assert arena.claim_starter(db, user.id, key) == result


def test_missing_original_starter_is_reported_before_any_issuance(db):
    seed_battle_catalogue(db); user = player(db)
    view = arena.bootstrap(db, user.id)
    assert view["starter"] == {"claimed": False, "available": False, "missing_heroes": list(arena.STARTER)}
    with pytest.raises(Exception) as error:
        arena.claim_starter(db, user.id, str(uuid4()))
    assert error.value.status_code == 409
    assert db.scalar(select(func.count()).select_from(ArchiveItem)) == 0
    assert db.scalar(select(func.count()).select_from(ArchiveOperation)) == 0


def test_explicit_revocation_or_mismatch_cannot_fall_back_to_default_rules(db):
    seed_battle_catalogue(db)
    cards, _ = originals(db)
    abrams = cards[0]
    assert arena.approved_definition(db, abrams).key == "abrams"
    definition = db.scalar(select(BattleDefinitionVersion).where(BattleDefinitionVersion.key == "abrams"))
    link = BattleArtwork(card_id=abrams.id, definition_id=definition.id, approved=False)
    db.add(link); db.flush()
    assert arena.approved_definition(db, abrams) is None
    link.approved = True
    link.definition_id = db.scalar(select(BattleDefinitionVersion.id).where(BattleDefinitionVersion.key == "bebop"))
    db.flush()
    assert arena.approved_definition(db, abrams) is None
    assert abrams.id not in battle_metadata(db, cards)


def test_unsupported_owned_hero_is_visible_as_unavailable_without_aliasing(db):
    seed_battle_catalogue(db); user = player(db)
    card = ArchiveCard(hero="nurse-harrow", rank="F", title="Original Nurse Harrow", status="PUBLISHED")
    db.add(card); db.flush()
    item = ArchiveItem(user_id=user.id, card_id=card.id, operation_id=acquisition(db, user),
                       scope="REAL", state="OWNED", cost_basis=25)
    db.add(item); db.flush()
    view = arena.bootstrap(db, user.id)
    assert not view["inventory"]
    assert view["unavailable_inventory"][0]["item_id"] == item.id
    assert view["unavailable_inventory"][0]["card"]["hero"] == "nurse-harrow"
    assert view["unavailable_inventory"][0]["reason"] == "UNSUPPORTED_HERO"


def test_owned_ex_uses_its_original_art_instead_of_a_seeded_placeholder(db):
    seed_battle_catalogue(db); user = player(db)
    _, slots = originals(db, user)
    card = ArchiveCard(hero="HIDDEN_KING", rank="EX", title="Original patron", status="PUBLISHED",
                       image_data=b"original-patron", image_digest="original-patron")
    db.add(card); db.flush()
    definition = db.scalar(select(BattleDefinitionVersion).where(BattleDefinitionVersion.key == "HIDDEN_KING"))
    db.add(BattleArtwork(card_id=card.id, definition_id=definition.id, approved=True))
    base = ArchiveItem(user_id=user.id, card_id=card.id, operation_id=acquisition(db, user),
                       scope="REAL", state="OWNED", cost_basis=1800)
    db.add(base); db.flush()
    arena.save_squad(db, user.id, 0, "REAL", base.id, slots)
    match = arena.start_match(db, user.id, {"request_key": str(uuid4()), "mode": "TRAINING", "scope": "REAL",
                                          "squad_revision": 1, "base_item_id": base.id})["match"]
    assert str(card.id) in match["state"]["sides"][0]["base"]["image_url"]


def test_default_presentation_does_not_reference_nonexistent_geometry_ids(db):
    seed_battle_catalogue(db); user = player(db)
    view = arena.bootstrap(db, user.id)
    assert not any(definition.get("image_url") for definition in view["rules"]["heroes"].values())
    cards, _ = originals(db)
    view = arena.bootstrap(db, user.id)
    assert str(cards[0].id) in view["rules"]["heroes"]["abrams"]["image_url"]


def test_borrowed_artwork_obeys_explicit_revocation_and_ex_approval(db):
    seed_battle_catalogue(db)
    cards, _ = originals(db)
    definition = db.scalar(select(BattleDefinitionVersion).where(BattleDefinitionVersion.key == "abrams"))
    db.add(BattleArtwork(card_id=cards[0].id, definition_id=definition.id, approved=False))
    patron = ArchiveCard(hero="HIDDEN_KING", rank="EX", title="Unapproved patron art", status="PUBLISHED",
                         image_data=cards[0].image_data, image_digest=cards[0].image_digest)
    db.add(patron); db.flush()
    rules = arena.display_rules(db)
    assert not rules["heroes"]["abrams"].get("image_url")
    assert not rules["bases"]["HIDDEN_KING"].get("image_url")


def test_original_archived_opponent_art_is_private_to_battle_participants(community):
    from app.models import User
    factory, make_player = community
    first_id, first = make_player(); second_id, second = make_player(); _, outsider = make_player()
    with factory() as session:
        seed_battle_catalogue(session)
        for user_id in (first_id, second_id):
            _, slots = originals(session, session.get(User, user_id), status="ARCHIVED")
            arena.save_squad(session, user_id, 0, "REAL", None, slots)
    room = first.post("/api/arena/rooms", json={"request_key": str(uuid4()), "scope": "REAL"}).json()["room"]
    code = room["code"]
    assert second.post(f"/api/arena/rooms/{code}/join", json={"request_key": str(uuid4())}).status_code == 200
    for client in (first, second):
        response = client.post(f"/api/arena/rooms/{code}/confirm", json={"request_key": str(uuid4()), "squad_revision": 1})
        assert response.status_code == 200, response.text
    match_id = response.json()["room"]["match_id"]
    match = first.get(f"/api/arena/matches/{match_id}").json()["match"]
    enemy = match["state"]["sides"][1]["heroes"][0]["card"]
    with factory() as session:
        artwork = session.get(ArchiveCard, enemy["id"]).image_data
    assert_webp(first.get(enemy["image_url"]), artwork)
    assert outsider.get(enemy["image_url"]).status_code == 404
    assert first.get(f"/api/archive/cards/{enemy['id']}/image").status_code == 404
    assert first.get(f"/api/arena/matches/{match_id}/cards/{uuid4()}/image").status_code == 404


def test_purchased_original_art_flows_through_catalog_inventory_squad_and_battle(community):
    from test_archive_packs import buy, fund

    factory, make_player = community
    user_id, client = make_player()
    with factory() as session:
        seed_battle_catalogue(session)
        cards, _ = originals(session)
        expected = {card.id: card.image_data for card in cards}
        session.commit()
    fund(factory, user_id, 500)
    catalog = client.get("/api/archive/cards").json()
    assert catalog["total"] == 6
    slots = []
    for index, card in enumerate(catalog["items"]):
        assert_webp(client.get(card["image_url"]), expected[card["id"]])
        key = str(uuid4())
        receipt = buy(client, card["id"], key=key)
        assert receipt.status_code == 200, receipt.text
        assert buy(client, card["id"], key=key).json() == receipt.json()
        slots.append({"item_id": receipt.json()["items"][0]["id"], "line": index // 2,
                      "position": "FRONT" if index % 2 == 0 else "BACK"})
    inventory = client.get("/api/arena/bootstrap").json()["inventory"]
    assert {row["item_id"] for row in inventory} == {slot["item_id"] for slot in slots}
    for row in inventory:
        assert_webp(client.get(row["card"]["image_url"]), expected[row["card"]["id"]])
    squad = client.put("/api/arena/squad", json={"expected_revision": 0, "scope": "REAL",
        "base_item_id": None, "slots": slots})
    assert squad.status_code == 200, squad.text
    response = client.post("/api/arena/matches", json={"request_key": str(uuid4()), "mode": "TRAINING",
        "scope": "REAL", "squad_revision": 1})
    assert response.status_code == 200, response.text
    for hero in response.json()["match"]["state"]["sides"][0]["heroes"]:
        assert_webp(client.get(hero["image_url"]), expected[hero["card"]["id"]])
    assert client.get("/api/archive/wallet").json()["balance"] == 350
    assert client.get("/api/archive/inventory").json()["total"] == 6
