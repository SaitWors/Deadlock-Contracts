"""Arena boundary checks against actual authentication and privacy dependencies."""
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import ArchiveCard, ArchiveItem, PublicProfile, User, utcnow
from app.battle_models import BattleArtwork, BattleDefinitionVersion, BattleMatch
from app.services.battle_catalog import seed_battle_catalogue
from app.services import battle_service as arena, battle_social as social
from arena_fixtures import original_card_id as card_id, seed_original_catalogue
from test_archive_packs import owner  # noqa: F401
from test_bureau_operations import elevate
from test_player_community import community  # noqa: F401


def ready(factory, user_id, scope="REAL"):
    """Seed a historical Arena session without reopening retired player APIs."""
    with factory() as db:
        seed_battle_catalogue(db); seed_original_catalogue(db); db.commit()
        return arena.claim_starter(db, user_id, str(uuid4()), scope)


def test_owner_controls_require_existing_totp_elevation_and_matching_artwork(community, owner):
    factory, player = community
    owner_id, client = owner; _, ordinary = player()
    ready(factory, owner_id)
    assert ordinary.get("/api/arena/definitions").status_code == 403
    elevate(factory, owner_id, client, role="PLAYER", elevated=False)
    assert client.get("/api/arena/definitions").status_code == 403
    elevate(factory, owner_id, client, role="PLAYER")
    definitions = client.get("/api/arena/definitions").json()["definitions"]
    assert len(definitions) == 46
    abrams = next(value for value in definitions if value["key"] == "abrams")
    assert client.put("/api/arena/artwork-approval", json={"card_id": card_id("bebop", "F"), "definition_id": abrams["id"], "approved": True}).status_code == 422
    assert client.put("/api/arena/artwork-approval", json={"card_id": card_id("abrams", "F"), "definition_id": abrams["id"], "approved": True}).status_code == 200
    season = {"request_key": str(uuid4()), "title": "Pilot", "starts_at": (utcnow() - timedelta(minutes=1)).isoformat(), "ends_at": (utcnow() + timedelta(days=7)).isoformat(), "active": True}
    assert ordinary.post("/api/arena/season", json=season).status_code == 403
    assert client.post("/api/arena/season", json=season).status_code == 200


def test_public_showcase_images_hide_immediately_with_profile_switch(community):
    factory, player = community
    user_id, client = player(public=True); first = ready(factory, user_id)
    with factory() as db:
        social.save_showcase(db, user_id, 0, True, None, first["squad"]["slots"])
    with factory() as db:
        slug = db.scalar(select(PublicProfile.slug).where(PublicProfile.user_id == user_id))
        image_url = social.public_showcase(db, slug)["showcase"]["heroes"][0]["card"]["image_url"]
    with TestClient(app) as anonymous:
        view = anonymous.get(f"/api/public/players/{slug}/arena/showcase")
        assert view.status_code == 410
        image = anonymous.get(image_url)
        assert image.status_code == 200 and image.headers["content-type"] == "image/webp"
        with factory() as db:
            db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id)).show_showcase = False; db.commit()
        assert anonymous.get(image_url).status_code == 404
        assert anonymous.get(f"/api/public/players/{slug}/arena/showcase").status_code == 410




@pytest.mark.parametrize("method,path", [
    ("GET", "/api/arena/bootstrap"), ("GET", "/api/arena/queue"), ("GET", "/api/arena/leaderboard"),
    ("GET", "/api/arena/requests/00000000-0000-0000-0000-000000000001"),
    ("GET", "/api/arena/matches/00000000-0000-0000-0000-000000000001"),
    ("POST", "/api/arena/starter"), ("PUT", "/api/arena/squad"), ("POST", "/api/arena/matches"),
    ("POST", "/api/arena/matches/00000000-0000-0000-0000-000000000001/plans"),
    ("POST", "/api/arena/matches/00000000-0000-0000-0000-000000000001/surrender"),
    ("POST", "/api/arena/cleanup"), ("POST", "/api/arena/rooms"),
    ("GET", "/api/arena/rooms/ABCDEF"), ("POST", "/api/arena/rooms/ABCDEF/join"),
    ("POST", "/api/arena/rooms/ABCDEF/confirm"), ("POST", "/api/arena/rooms/ABCDEF/leave"),
    ("POST", "/api/arena/queue"), ("DELETE", "/api/arena/queue"), ("PUT", "/api/arena/showcase"),
])
def test_arena_player_endpoints_are_retired_without_creating_inventory(community, method, path):
    from sqlalchemy import func
    from app.models import ArchiveOperation
    factory, player = community
    uid, client = player()
    response=client.request(method,path,json={})
    assert response.status_code == 410, response.text
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == uid)) == 0
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == uid)) == 0


def test_retired_arena_preserves_authentication_and_csrf(community):
    _, player=community
    _, client=player()
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/arena/bootstrap").status_code == 401
    client.headers.pop("X-CSRF-Token")
    assert client.post("/api/arena/starter",json={}).status_code == 403


def test_account_deletion_removes_legacy_peer_recovery_but_keeps_unrelated_receipt(community):
    factory, player=community
    first_id, first=player(); second_id, second=player()
    starter_key=str(uuid4())
    with factory() as db:
        seed_battle_catalogue(db); seed_original_catalogue(db); db.commit()
        starter=arena.claim_starter(db,first_id,starter_key)
        arena.claim_starter(db,second_id,str(uuid4()))
        room=social.create_room(db,first_id,str(uuid4()))["room"]
        code=room["code"]
        social.join_room(db,second_id,code,str(uuid4()))
        social.confirm_room(db,first_id,code,str(uuid4()),1,None)
        match_id=social.confirm_room(db,second_id,code,str(uuid4()),1,None)["room"]["match_id"]
        plan_key=str(uuid4())
        arena.submit_plan(db,first_id,match_id,plan_key,1,[{"type":"READY"}])
        assert arena.request_result(db,first_id,plan_key)["result"]["match"]["id"] == match_id
    assert second.post("/api/account/delete",json={"confirmation":"DELETE"}).status_code == 200
    with factory() as db:
        assert arena.request_result(db,first_id,plan_key) == {"result":None}
        assert arena.request_result(db,first_id,starter_key) == {"result":starter}
        assert db.get(User,first_id) is not None and db.get(User,second_id) is None
