from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import (BoardOption, BureauMembership, ContractBoard, MissionDefinition,
                        PlayerBureau, PublicProfile, RewardLedgerEntry, SessionToken, User, utcnow)
from app.services.auth import COOKIE_NAME, csrf_token, hash_token
from app.services.bureaus import CAPACITY


@pytest.fixture()
def community():
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    clients = []
    def player(name="Operative", public=False):
        token = uuid4().hex
        with factory() as db:
            user = User(display_name=name)
            db.add(user)
            db.flush()
            db.add(SessionToken(token_hash=hash_token(token), user_id=user.id, expires_at=utcnow() + timedelta(hours=1)))
            if public:
                db.add(PublicProfile(user_id=user.id, slug=f"agent-{token[:12]}", is_public=True, show_stats=True))
            db.commit()
        client = TestClient(app)
        client.cookies.set(COOKIE_NAME, token)
        client.headers["X-CSRF-Token"] = csrf_token(token)
        clients.append(client)
        return user.id, client
    try:
        yield factory, player
    finally:
        for client in clients:
            client.close()
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def create_bureau(client, slug="deadlock-night", recruitment="APPLICATION"):
    response = client.post("/api/bureaus", json={"slug": slug, "name": "Deadlock Night Shift", "recruitment": recruitment, "rules": "Be kind to fellow operatives."})
    assert response.status_code == 200, response.text
    return response.json()["bureau"]


def contract(db, user_id, index=0, *, mode="STANDARD", status="COMPLETED", reward=True, category="COMBAT", difficulty="HARD", rarity="RARE"):
    mission = MissionDefinition(key=f"community-{uuid4()}", title="Verified case", title_en="Verified case", description="Case fixture", metric="player.kills", operator=">=", target=1, reward_xp=50)
    db.add(mission); db.flush()
    board = ContractBoard(user_id=user_id, board_date=date(2026, 1, 1) + timedelta(days=index), game_match_mode=mode, status="SETTLED", seed=str(uuid4()), expires_at=utcnow())
    db.add(board); db.flush()
    option = BoardOption(board_id=board.id, mission_definition_id=mission.id, rendered_title=mission.title, rendered_description=mission.description, metric="player.kills", operator=">=", target=1, reward_xp=50, selected=True, status=status, settled_at=utcnow(), category=category, rarity=rarity, difficulty=difficulty)
    db.add(option); db.flush()
    if reward:
        db.add(RewardLedgerEntry(user_id=user_id, source_id=option.id, source_type="assignment", asset="XP", delta=50, balance_after=50))
    return option


def test_achievements_use_awarded_contracts_once_and_follow_corrected_verdicts(community):
    factory, player = community
    user_id, client = player()
    with factory() as db:
        user = db.get(User, user_id); user.xp = 50000
        db.add(RewardLedgerEntry(user_id=user_id, source_id="manual-xp", source_type="ADMIN_ADJUSTMENT", delta=50000, balance_after=50000))
        contract(db, user_id, 0, reward=False)
        contract(db, user_id, 1, status="REVIEW_REQUIRED")
        db.commit()
    assert client.get("/api/achievements").json()["earned"] == 0
    with factory() as db:
        option = contract(db, user_id, 2)
        db.add(RewardLedgerEntry(user_id=user_id, source_id=option.id, source_type="AUTO_REVIEW", delta=50, balance_after=50100))
        db.commit(); option_id = option.id
    response = client.get("/api/achievements")
    assert response.headers["cache-control"] == "private, no-store"
    items = {item["id"]: item for item in response.json()["items"]}
    assert items["first_case"]["earned_at"]
    assert items["ten_cases"]["current"] == 1
    assert not items["ten_cases"]["earned"]
    with factory() as db:
        db.get(BoardOption, option_id).status = "FAILED"
        db.commit()
    assert client.get("/api/achievements").json()["earned"] == 0


def test_collection_counts_distinct_modes_categories_and_thresholds(community):
    factory, player = community
    user_id, client = player()
    with factory() as db:
        for index in range(10):
            contract(db, user_id, index, mode=["STANDARD", "RANKED", "STREET_BRAWL"][index % 3], category=["COMBAT", "SUPPORT", "ECONOMY", "SURVIVAL"][index % 4], difficulty="EXTREME")
        db.commit()
    items = {item["id"]: item for item in client.get("/api/achievements").json()["items"]}
    assert {key for key, item in items.items() if item["earned"]} == {"first_case", "ten_cases", "hard_cases", "extreme_case", "rare_cases", "three_modes", "four_categories"}
    assert items["fifty_cases"]["current"] == 10


def test_profile_pins_ownership_earned_seals_and_public_privacy(community):
    factory, player = community
    user_id, client = player("Owner")
    other_id, _ = player("Other")
    create_bureau(client)
    with factory() as db:
        own = contract(db, user_id); other = contract(db, other_id)
        no_award = contract(db, user_id, 1, reward=False)
        db.commit(); own_id, other_option, not_awarded = own.id, other.id, no_award.id
    payload = {"slug": "owner-dossier", "is_public": True, "featured_achievement": "first_case", "pinned_contract_ids": [own_id], "show_bureau": True}
    assert client.put("/api/profile/public", json={**payload, "pinned_contract_ids": [other_option]}).status_code == 422
    assert client.put("/api/profile/public", json={**payload, "pinned_contract_ids": [not_awarded]}).status_code == 422
    assert client.put("/api/profile/public", json={**payload, "featured_achievement": "fifty_cases"}).status_code == 422
    assert client.put("/api/profile/public", json={**payload, "showcase_order": ["contracts"] * 3}).status_code == 422
    saved = client.put("/api/profile/public", json=payload)
    assert saved.status_code == 200, saved.text
    public = client.get("/api/public/profiles/owner-dossier").json()["profile"]
    assert public["showcase"][0]["id"] == own_id
    assert public["bureau"]["slug"] == "deadlock-night"
    assert public["featured_achievement"] == "first_case"
    assert len(public["achievements"]) == 1
    assert "available_contracts" not in public and "pinned_contract_ids" not in public
    assert "steam_id64" not in public["player"] and "id" not in public["player"]
    hidden = client.put("/api/profile/public", json={**payload, "show_stats": False, "show_showcase": False, "show_bureau": False})
    assert hidden.status_code == 200
    public = client.get("/api/public/profiles/owner-dossier").json()["profile"]
    assert public["stats"] is None and public["player"]["xp"] is None
    assert public["achievements"] == [] and public["featured_achievement"] is None
    assert public["showcase"] == [] and public["bureau"] is None


def test_leaderboard_returns_own_rank_beyond_page_without_revealing_private_players(community):
    factory, player = community
    mine_id, client = player("Last", public=True)
    _, private = player("Private")
    with factory() as db:
        for index in range(105):
            user = User(display_name=f"Leader {index:03}")
            db.add(user); db.flush()
            db.add(PublicProfile(user_id=user.id, slug=f"leader-{index}", is_public=True, show_stats=True))
            db.add(RewardLedgerEntry(user_id=user.id, source_id=f"legacy-{index}", source_type="assignment", delta=100 + index, balance_after=100 + index))
        db.add(RewardLedgerEntry(user_id=mine_id, source_id="last-award", source_type="assignment", delta=1, balance_after=1))
        db.commit()
    data = client.get("/api/leaderboard?limit=50").json()
    assert len(data["rows"]) == 50 and data["total"] == 106
    assert data["me"]["row"]["rank"] == 106
    assert all(row["slug"] != data["me"]["row"]["slug"] for row in data["rows"])
    assert private.get("/api/leaderboard").json()["me"] == {"row": None, "reason": "PRIVATE_PROFILE"}
    assert "me" not in client.get("/api/public/leaderboard").json()
    assert client.get("/api/leaderboard?limit=101").status_code == 422


def test_bureau_auth_csrf_one_membership_and_roster_privacy(community):
    factory, player = community
    owner_id, owner = player("Secret owner")
    _, outsider = player("Visitor")
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/bureaus").status_code == 401
        assert anonymous.get("/api/achievements").status_code == 401
    assert owner.post("/api/bureaus", headers={"X-CSRF-Token": "bad"}, json={"slug": "abc", "name": "Deadlock Team"}).status_code == 403
    assert owner.post("/api/bureaus", json={"slug": "abc", "name": "Something else"}).status_code == 422
    bureau = create_bureau(owner, recruitment="OPEN")
    assert bureau["my_role"] == "DIRECTOR"
    assert owner.post("/api/bureaus", json={"slug": "second", "name": "Deadlock Second"}).status_code == 409
    details = outsider.get("/api/bureaus/deadlock-night").json()["bureau"]
    assert details["members"][0]["display_name"] is None
    assert details["members"][0]["id"] is None
    assert details["journal"] == [] and details["applications"] == []
    assert outsider.post("/api/bureaus/deadlock-night/join", json={"agree_rules": False}).status_code == 422
    joined = outsider.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True})
    assert joined.status_code == 200
    assert joined.json()["bureau"]["member_count"] == 2
    assert joined.json()["bureau"]["members"][0]["display_name"] == "Secret owner"
    assert outsider.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True}).json()["bureau"]["member_count"] == 2
    assert outsider.put("/api/bureaus/deadlock-night", json={"name": "Deadlock Hijacked"}).status_code == 403
    assert owner.post("/api/bureaus/deadlock-night/leave").status_code == 409
    assert outsider.post("/api/bureaus/deadlock-night/leave").status_code == 200
    with factory() as db:
        assert db.scalar(select(User.access_role).where(User.id == owner_id)) == "PLAYER"


def test_application_review_permissions_capacity_and_replay(community):
    factory, player = community
    owner_id, owner = player("Director")
    member_id, candidate = player("Candidate")
    _, other = player("Other")
    create_bureau(owner)
    applied = candidate.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True, "message": "Private application"})
    assert applied.json()["bureau"]["application_pending"]
    info = owner.get("/api/bureaus/deadlock-night").json()["bureau"]
    application_id = info["applications"][0]["id"]
    url = f"/api/bureaus/deadlock-night/applications/{application_id}"
    assert other.post(url, json={"decision": "ACCEPT"}).status_code == 403
    with factory() as db:
        bureau = db.scalar(select(PlayerBureau))
        for index in range(CAPACITY - 1):
            user = User(display_name=f"Member {index}")
            db.add(user); db.flush(); db.add(BureauMembership(user_id=user.id, bureau_id=bureau.id))
        db.commit()
    assert owner.post(url, json={"decision": "ACCEPT"}).status_code == 409
    assert owner.get("/api/bureaus/deadlock-night").json()["bureau"]["applications"]
    with factory() as db:
        spare = db.scalar(select(BureauMembership).where(BureauMembership.user_id != owner_id))
        db.delete(spare); db.commit()
    accepted = owner.post(url, json={"decision": "ACCEPT"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["bureau"]["member_count"] == CAPACITY
    assert owner.post(url, json={"decision": "ACCEPT"}).status_code == 404
    assert candidate.get("/api/bureaus/deadlock-night").json()["bureau"]["my_role"] == "OPERATIVE"


def test_roles_transfer_removal_and_disband_preserve_personal_progress(community):
    factory, player = community
    owner_id, owner = player("Director")
    moderator_id, moderator = player("Moderator")
    target_id, target = player("Target")
    create_bureau(owner, recruitment="OPEN")
    for client in (moderator, target):
        assert client.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True}).status_code == 200
    with factory() as db:
        mod_member = db.scalar(select(BureauMembership).where(BureauMembership.user_id == moderator_id)).id
        target_member = db.scalar(select(BureauMembership).where(BureauMembership.user_id == target_id)).id
        owner_member = db.scalar(select(BureauMembership).where(BureauMembership.user_id == owner_id)).id
        contract(db, target_id); db.commit()
    url = "/api/bureaus/deadlock-night/members/"
    assert owner.post(url + mod_member, json={"action": "PROMOTE"}).status_code == 200
    assert moderator.post(url + owner_member, json={"action": "REMOVE", "reason": "Take over"}).status_code == 403
    assert moderator.post(url + target_member, json={"action": "PROMOTE"}).status_code == 403
    assert moderator.post(url + target_member, json={"action": "REMOVE"}).status_code == 422
    removed = moderator.post(url + target_member, json={"action": "REMOVE", "reason": "Repeated spam"})
    assert removed.status_code == 200, removed.text
    assert any(entry["data"].get("reason") == "Repeated spam" for entry in removed.json()["bureau"]["journal"])
    assert target.get("/api/achievements").json()["earned"] == 1
    assert owner.post(url + mod_member, json={"action": "TRANSFER"}).status_code == 200
    assert owner.request("DELETE", "/api/bureaus/deadlock-night", json={"confirmation": "deadlock-night"}).status_code == 403
    assert moderator.request("DELETE", "/api/bureaus/deadlock-night", json={"confirmation": "wrong"}).status_code == 422
    assert moderator.request("DELETE", "/api/bureaus/deadlock-night", json={"confirmation": "deadlock-night"}).status_code == 200
    assert target.get("/api/achievements").json()["earned"] == 1
    assert owner.get("/api/bureaus").json()["my_bureau"] is None


def test_account_deletion_transfers_director_without_orphaning_bureau(community):
    factory, player = community
    owner_id, owner = player("Director")
    member_id, member = player("Successor")
    create_bureau(owner, recruitment="OPEN")
    assert member.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True}).status_code == 200
    result = owner.post("/api/account/delete", json={"confirmation": "DELETE"})
    assert result.status_code == 200, result.text
    data = member.get("/api/bureaus/deadlock-night").json()["bureau"]
    assert data["my_role"] == "DIRECTOR" and data["member_count"] == 1
    assert member.post("/api/account/delete", json={"confirmation": "DELETE"}).status_code == 200
    with factory() as db:
        assert db.scalar(select(PlayerBureau)) is None
