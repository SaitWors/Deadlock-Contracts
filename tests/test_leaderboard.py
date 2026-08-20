from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import BoardOption, ContractBoard, MissionDefinition, PublicProfile, RewardLedgerEntry, User


def _player(db, name: str, *, public: bool = True, show_stats: bool = True) -> User:
    token = uuid.uuid4().hex[:10]
    user = User(display_name=name, xp=500)
    db.add(user)
    db.flush()
    db.add(PublicProfile(
        user_id=user.id,
        slug=f"agent-{token}",
        is_public=public,
        show_stats=show_stats,
        show_showcase=True,
        show_links=False,
    ))
    db.flush()
    return user


def _completed_option(db, user: User, *, rarity: str, difficulty: str, mode: str = "STANDARD") -> None:
    token = uuid.uuid4().hex
    mission = MissionDefinition(
        key=f"leader-{token}",
        version=1,
        title="Leaderboard contract",
        description="Verified leaderboard fixture",
        metric="player.kills",
        operator=">=",
        target=5,
        reward_xp=100,
        rarity=rarity,
        difficulty=difficulty,
    )
    db.add(mission)
    db.flush()
    board = ContractBoard(
        user_id=user.id,
        board_date=date.today(),
        game_match_mode=mode,
        seed=token,
        status="SETTLED",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(board)
    db.flush()
    db.add(BoardOption(
        board_id=board.id,
        mission_definition_id=mission.id,
        rendered_title=mission.title,
        rendered_description=mission.description,
        metric=mission.metric,
        operator=mission.operator,
        target=mission.target,
        reward_xp=mission.reward_xp,
        difficulty=difficulty,
        rarity=rarity,
        selected=True,
        status="COMPLETED",
        settled_at=datetime.now(timezone.utc),
    ))
    db.flush()


def test_public_leaderboard_uses_verified_contract_rewards_and_privacy() -> None:
    with TestClient(app) as client:
        with SessionLocal() as db:
            visible = _player(db, "Visible Agent")
            hidden = _player(db, "Hidden Agent", public=False)
            quiet = _player(db, "Quiet Agent", show_stats=False)
            for user, delta, source in (
                (visible, 240, "assignment"),
                (visible, 9999, "ADMIN_ADJUSTMENT"),
                (hidden, 500, "assignment"),
                (quiet, 600, "assignment"),
            ):
                db.add(RewardLedgerEntry(
                    user_id=user.id,
                    source_type=source,
                    source_id=uuid.uuid4().hex,
                    delta=delta,
                    balance_after=delta,
                ))
            db.commit()
            visible_slug = db.query(PublicProfile).filter(PublicProfile.user_id == visible.id).one().slug

        response = client.get("/api/public/leaderboard?scope=all_time&limit=50")
        assert response.status_code == 200
        assert response.headers["cache-control"].startswith("public, max-age=60")
        rows = response.json()["rows"]
        row = next(item for item in rows if item["slug"] == visible_slug)
        assert row["score"] == 240
        assert all(item["display_name"] != "Hidden Agent" for item in rows)
        assert all(item["display_name"] != "Quiet Agent" for item in rows)


def test_leaderboard_rare_and_mastery_scores_are_server_derived() -> None:
    with TestClient(app) as client:
        with SessionLocal() as db:
            user = _player(db, "Mastery Agent")
            _completed_option(db, user, rarity="RARE", difficulty="HARD")
            _completed_option(db, user, rarity="EPIC", difficulty="EXTREME", mode="RANKED")
            db.add(RewardLedgerEntry(user_id=user.id, source_type="assignment", source_id=uuid.uuid4().hex, delta=200, balance_after=200))
            db.commit()
            slug = db.query(PublicProfile).filter(PublicProfile.user_id == user.id).one().slug

        rare = client.get("/api/public/leaderboard?scope=rare").json()
        mastery = client.get("/api/public/leaderboard?scope=mastery").json()
        rare_row = next(item for item in rare["rows"] if item["slug"] == slug)
        mastery_row = next(item for item in mastery["rows"] if item["slug"] == slug)
        assert rare_row["score"] == 3
        assert mastery_row["score"] == 3
        assert rare_row["contracts_completed"] == 2


def test_leaderboard_rejects_unbounded_limit() -> None:
    with TestClient(app) as client:
        assert client.get("/api/public/leaderboard?limit=1000").status_code == 422
