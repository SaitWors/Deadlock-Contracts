from datetime import date, datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.foundation_overview import overview_summary
from app.models import (
    BoardOption,
    ContractBoard,
    MissionDefinition,
    RewardLedgerEntry,
    User,
)


def test_overview_activity_uses_verified_case_results_and_contract_rewards_in_utc():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 11, 28, 12, tzinfo=timezone.utc)
    with Session(engine) as db:
        user = User(display_name="Operative")
        outsider = User(display_name="Outsider")
        db.add_all([user, outsider])
        db.flush()
        mission = MissionDefinition(
            key="foundation-test",
            title="Тест",
            title_en="Test",
            description="Тест",
            description_en="Test",
            metric="kills",
            operator="gte",
            target=1,
            reward_xp=30,
        )
        db.add(mission)
        db.flush()

        def case(owner, days, status, option_status, xp):
            timestamp = now - timedelta(days=days)
            board = ContractBoard(
                user_id=owner.id,
                board_date=date(2026, 11, 28) - timedelta(days=days),
                seed="test",
                status=status,
                attempts_used=1,
                locked_at=timestamp - timedelta(hours=1),
                expires_at=timestamp,
            )
            db.add(board)
            db.flush()
            option = BoardOption(
                board_id=board.id,
                mission_definition_id=mission.id,
                selected=True,
                rendered_title="Test",
                rendered_description="Test",
                metric="kills",
                operator="gte",
                target=1,
                reward_xp=30,
                status=option_status,
                settled_at=timestamp
                if option_status in {"COMPLETED", "FAILED"}
                else None,
            )
            db.add(option)
            db.flush()
            if xp:
                db.add(
                    RewardLedgerEntry(
                        user_id=owner.id,
                        source_type="assignment",
                        source_id=option.id,
                        delta=xp,
                        balance_after=xp,
                        created_at=timestamp,
                    )
                )

        case(user, 0, "SETTLED", "COMPLETED", 30)
        case(user, 1, "SETTLED", "FAILED", 0)
        case(user, 6, "LOCKED", "COMPLETED", 15)
        case(user, 7, "SETTLED", "COMPLETED", 25)
        case(outsider, 0, "SETTLED", "COMPLETED", 999)
        db.add(
            RewardLedgerEntry(
                user_id=user.id,
                source_type="OWNER_MANUAL_XP",
                source_id="manual",
                delta=900,
                balance_after=970,
                created_at=now,
            )
        )
        db.flush()

        summary = overview_summary(db, user.id, now)
        assert summary["has_signed_case"] is True
        assert summary["has_verified_result"] is True
        assert summary["has_claimed_daily_pack"] is False
        assert summary["completed_cases"] == 3
        assert summary["weekly"][0] == {
            "date": "2026-11-22",
            "cases": 0,
            "contracts": 1,
            "xp": 15,
        }
        assert summary["weekly"][-2] == {
            "date": "2026-11-27",
            "cases": 1,
            "contracts": 0,
            "xp": 0,
        }
        assert summary["weekly"][-1] == {
            "date": "2026-11-28",
            "cases": 1,
            "contracts": 1,
            "xp": 30,
        }
        assert summary["collection"] == {"items": 0, "designs": 0}
        assert summary["bureau"] is None
