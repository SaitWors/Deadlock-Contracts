"""Arena boundary checks against actual authentication and privacy dependencies."""
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import ArchiveCard, ArchiveItem, PublicProfile, User, utcnow
from app.battle_models import BattleArtwork, BattleDefinitionVersion, BattleMatch
from app.services.battle_catalog import seed_battle_catalogue
from arena_fixtures import original_card_id as card_id, seed_original_catalogue
from test_archive_packs import owner  # noqa: F401
from test_bureau_operations import elevate
from test_player_community import community  # noqa: F401


def ready(factory, client, scope="REAL"):
    with factory() as db:
        seed_battle_catalogue(db); seed_original_catalogue(db); db.commit()
    response = client.post("/api/arena/starter", json={"request_key": str(uuid4()), "scope": scope})
    assert response.status_code == 200, response.text
    return response.json()


def begin(client, **extra):
    response = client.post("/api/arena/matches", json={"request_key": str(uuid4()), "mode": "TRAINING",
        "scope": "REAL", "squad_revision": 1, "base_item_id": None, **extra})
    assert response.status_code == 200, response.text
    return response.json()["match"]


def test_auth_csrf_strict_inputs_scoped_request_recovery_and_no_store(community):
    factory, player = community
    first_id, first = player(); _, other = player()
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/arena/bootstrap").status_code == 401
    ready(factory, first)
    key = str(uuid4()); body = {"request_key": key, "mode": "TRAINING", "scope": "REAL", "squad_revision": 1}
    response = first.post("/api/arena/matches", json=body)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert first.post("/api/arena/matches", json=body).json() == response.json()
    assert first.get(f"/api/arena/requests/{key}").json() == {"result": response.json()}
    assert other.get(f"/api/arena/requests/{key}").json() == {"result": None}
    assert other.get(f"/api/arena/matches/{response.json()['match']['id']}").status_code == 404
    assert first.post("/api/arena/matches", json={**body, "winner_side": "A"}).status_code == 422
    assert first.post("/api/arena/matches", json={**body, "mode": "TRIAL"}).status_code == 409
    match = response.json()["match"]
    token = first.headers.pop("X-CSRF-Token")
    assert first.post(f"/api/arena/matches/{match['id']}/plans", json={"request_key": str(uuid4()), "expected_revision": 1, "actions": []}).status_code == 403
    first.headers["X-CSRF-Token"] = token


def test_friendly_plans_are_sealed_until_both_players_submit(community):
    factory, player = community
    _, first = player(); _, second = player(); _, outsider = player()
    ready(factory, first); ready(factory, second)
    room = first.post("/api/arena/rooms", json={"request_key": str(uuid4()), "scope": "REAL"}).json()["room"]
    code = room["code"]
    assert second.post(f"/api/arena/rooms/{code}/join", json={"request_key": str(uuid4())}).status_code == 200
    confirmation = {"request_key": str(uuid4()), "squad_revision": 1, "base_item_id": None}
    own = first.post(f"/api/arena/rooms/{code}/confirm", json=confirmation).json()["room"]
    assert own["match_id"] is None
    assert set(second.get(f"/api/arena/rooms/{code}").json()["room"]) == {"code", "scope", "status", "match_id", "own_confirmed", "opponent_confirmed"}
    assert outsider.get(f"/api/arena/rooms/{code}").status_code == 404
    started = second.post(f"/api/arena/rooms/{code}/confirm", json={**confirmation, "request_key": str(uuid4())}).json()["room"]
    match_id = started["match_id"]
    state = first.get(f"/api/arena/matches/{match_id}").json()["match"]
    hero_id = state["state"]["sides"][0]["heroes"][0]["id"]
    plan = {"request_key": str(uuid4()), "expected_revision": 1, "actions": [{"type": "HERO_ABILITY", "actor_id": hero_id}]}
    accepted = first.post(f"/api/arena/matches/{match_id}/plans", json=plan)
    assert accepted.status_code == 200, accepted.text
    before = second.get(f"/api/arena/matches/{match_id}").json()["match"]
    assert before["opponent_submitted"] and before["round"] == 1
    assert not before["last_events"] and not before["submitted"]
    assert "bot_plan" not in before and "snapshot" not in before and "actions" not in before
    assert first.post(f"/api/arena/matches/{match_id}/plans", json={**plan, "request_key": str(uuid4())}).status_code == 409
    resolved = second.post(f"/api/arena/matches/{match_id}/plans", json={"request_key": str(uuid4()), "expected_revision": 1, "actions": []})
    assert resolved.json()["match"]["round"] == 2


def test_duplicate_heroes_and_unapproved_art_are_rejected_server_side(community):
    factory, player = community
    user_id, client = player(); first = ready(factory, client)
    slots = deepcopy(first["squad"]["slots"])
    slots[1]["item_id"] = slots[0]["item_id"]
    assert client.put("/api/arena/squad", json={"expected_revision": 1, "scope": "REAL", "base_item_id": None, "slots": slots}).status_code == 422
    with factory() as db:
        item = db.get(ArchiveItem, first["squad"]["slots"][0]["item_id"])
        link = db.get(BattleArtwork, item.card_id); link.approved = False; db.commit()
    assert client.post("/api/arena/matches", json={"request_key": str(uuid4()), "mode": "TRAINING", "scope": "REAL", "squad_revision": 1}).status_code == 409


def test_trial_and_sandbox_preserve_real_inventory_and_reservations_block_recycle(community):
    factory, player = community
    user_id, client = player(); ready(factory, client)
    match = begin(client, mode="TRIAL", patron_key="ARCHMOTHER")
    assert match["state"]["sides"][0]["base"]["key"] == "ARCHMOTHER"
    item_id = match["state"]["sides"][0]["heroes"][0]["item_id"]
    assert client.post(f"/api/archive/items/{item_id}/recycle", json={"request_key": str(uuid4())}).status_code == 409
    with factory() as db: assert len(list(db.scalars(select(ArchiveItem).where(ArchiveItem.user_id == user_id)))) == 6
    done = client.post(f"/api/arena/matches/{match['id']}/surrender", json={"request_key": str(uuid4()), "expected_revision": 1})
    assert done.json()["match"]["reward"] is None
    ready(factory, client, "SANDBOX")
    sandbox = begin(client, scope="SANDBOX", mode="TRIAL", patron_key="HIDDEN_KING")
    assert sandbox["scope"] == "SANDBOX"
    assert client.put("/api/arena/showcase", json={"expected_revision": 0, "is_public": True,
        "base_item_id": None, "slots": client.get("/api/arena/bootstrap?scope=SANDBOX").json()["squad"]["slots"]}).status_code == 409


def test_owner_controls_require_existing_totp_elevation_and_matching_artwork(community, owner):
    factory, player = community
    owner_id, client = owner; _, ordinary = player()
    ready(factory, client)
    assert ordinary.get("/api/arena/definitions").status_code == 403
    elevate(factory, owner_id, client, role="PLAYER", elevated=False)
    assert client.get("/api/arena/definitions").status_code == 403
    elevate(factory, owner_id, client, role="PLAYER")
    definitions = client.get("/api/arena/definitions").json()["definitions"]
    assert len(definitions) == 14
    abrams = next(value for value in definitions if value["key"] == "abrams")
    assert client.put("/api/arena/artwork-approval", json={"card_id": card_id("bebop", "F"), "definition_id": abrams["id"], "approved": True}).status_code == 422
    assert client.put("/api/arena/artwork-approval", json={"card_id": card_id("abrams", "F"), "definition_id": abrams["id"], "approved": True}).status_code == 200
    season = {"request_key": str(uuid4()), "title": "Pilot", "starts_at": (utcnow() - timedelta(minutes=1)).isoformat(), "ends_at": (utcnow() + timedelta(days=7)).isoformat(), "active": True}
    assert ordinary.post("/api/arena/season", json=season).status_code == 403
    assert client.post("/api/arena/season", json=season).status_code == 200


def test_public_showcase_images_hide_immediately_with_profile_switch(community):
    factory, player = community
    user_id, client = player(public=True); first = ready(factory, client)
    response = client.put("/api/arena/showcase", json={"expected_revision": 0, "is_public": True,
        "base_item_id": None, "slots": first["squad"]["slots"]})
    assert response.status_code == 200, response.text
    with factory() as db: slug = db.scalar(select(PublicProfile.slug).where(PublicProfile.user_id == user_id))
    with TestClient(app) as anonymous:
        view = anonymous.get(f"/api/public/players/{slug}/arena/showcase")
        assert view.status_code == 200
        image_url = view.json()["showcase"]["heroes"][0]["card"]["image_url"]
        image = anonymous.get(image_url)
        assert image.status_code == 200 and image.headers["content-type"] == "image/webp"
        with factory() as db:
            db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id)).show_showcase = False; db.commit()
        assert anonymous.get(image_url).status_code == 404
        assert anonymous.get(f"/api/public/players/{slug}/arena/showcase").status_code == 404


def test_account_deletion_removes_peer_match_recovery_but_keeps_unrelated_receipt(community):
    factory, player = community
    first_id, first = player(); second_id, second = player()
    with factory() as db:
        seed_battle_catalogue(db); seed_original_catalogue(db); db.commit()
    starter_key = str(uuid4())
    starter = first.post("/api/arena/starter", json={"request_key": starter_key, "scope": "REAL"}).json()
    ready(factory, second)
    room = first.post("/api/arena/rooms", json={"request_key": str(uuid4()), "scope": "REAL"}).json()["room"]
    code = room["code"]
    second.post(f"/api/arena/rooms/{code}/join", json={"request_key": str(uuid4())})
    first.post(f"/api/arena/rooms/{code}/confirm", json={"request_key": str(uuid4()), "squad_revision": 1})
    match_id = second.post(f"/api/arena/rooms/{code}/confirm", json={"request_key": str(uuid4()), "squad_revision": 1}).json()["room"]["match_id"]
    plan_key = str(uuid4())
    accepted = first.post(f"/api/arena/matches/{match_id}/plans", json={"request_key": plan_key, "expected_revision": 1, "actions": []})
    assert accepted.status_code == 200, accepted.text
    assert first.get(f"/api/arena/requests/{plan_key}").json()["result"]["match"]["id"] == match_id
    deleted = second.post("/api/account/delete", json={"confirmation": "DELETE"})
    assert deleted.status_code == 200, deleted.text
    assert first.get(f"/api/arena/matches/{match_id}").status_code == 404
    assert first.get(f"/api/arena/requests/{plan_key}").json() == {"result": None}
    assert first.get(f"/api/arena/requests/{starter_key}").json() == {"result": starter}
    with factory() as db:
        assert db.get(User, first_id) is not None and db.get(User, second_id) is None
