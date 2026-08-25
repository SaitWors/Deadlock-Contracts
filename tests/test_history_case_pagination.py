from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.main import _history_cases, _history_items, history
from app.models import BoardOption, ContractBoard, MissionDefinition, User


def _mission(suffix: str) -> MissionDefinition:
    return MissionDefinition(
        key=f"history-case-{suffix}",
        title=f"History case {suffix}",
        description="History case test",
        metric="player.kills",
        operator="gte",
        target=1,
        reward_xp=50,
        base_xp=50,
    )


def _selected_option(board: ContractBoard, mission: MissionDefinition, suffix: str) -> BoardOption:
    return BoardOption(
        board_id=board.id,
        mission_definition_id=mission.id,
        rendered_title=f"Contract {suffix}",
        rendered_description="Case pagination fixture",
        metric="player.kills",
        operator="gte",
        target=1,
        reward_xp=50,
        difficulty="FOCUSED",
        rarity="COMMON",
        category="COMBAT",
        required_capabilities=["summary.kills"],
        required_game_match_mode=board.game_match_mode,
        selected=True,
        status="COMPLETED",
        locked_at=board.locked_at,
        settled_at=board.locked_at,
    )


def test_history_limit_and_offset_are_applied_to_whole_cases() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    now = datetime.now(timezone.utc)

    with Session(engine) as db:
        user = User(account_id=81_000_001, display_name="History Case Test")
        missions = [_mission(str(index)) for index in range(5)]
        db.add_all([user, *missions])
        db.flush()

        older = ContractBoard(
            user_id=user.id,
            board_date=date(2026, 8, 23),
            status="SETTLED",
            game_match_mode="STANDARD",
            seed="older",
            locked_at=now - timedelta(days=1),
            expires_at=now + timedelta(days=6),
        )
        newer = ContractBoard(
            user_id=user.id,
            board_date=date(2026, 8, 24),
            status="SETTLED",
            game_match_mode="STANDARD",
            seed="newer",
            locked_at=now,
            expires_at=now + timedelta(days=7),
        )
        db.add_all([older, newer])
        db.flush()
        db.add_all(
            [
                _selected_option(older, missions[0], "older-a"),
                _selected_option(older, missions[1], "older-b"),
                _selected_option(newer, missions[2], "newer-a"),
                _selected_option(newer, missions[3], "newer-b"),
                _selected_option(newer, missions[4], "newer-c"),
            ]
        )
        db.commit()

        first_page = _history_cases(db, user, limit=1, offset=0)
        second_page = _history_cases(db, user, limit=1, offset=1)
        flat_first_page = _history_items(db, user, limit=1, offset=0)
        api_page = history(limit=1, offset=0, user=user, db=db)

        assert [item["board_id"] for item in first_page] == [newer.id]
        assert len(first_page[0]["items"]) == 3
        assert [item["board_id"] for item in second_page] == [older.id]
        assert len(second_page[0]["items"]) == 2
        assert len(flat_first_page) == 3
        assert {item["board_id"] for item in flat_first_page} == {newer.id}
        assert api_page["total"] == 2
        assert api_page["total_cases"] == 2
        assert api_page["total_assignments"] == 5
        assert api_page["has_more"] is True
        assert len(api_page["cases"]) == 1
        assert len(api_page["items"]) == 3
