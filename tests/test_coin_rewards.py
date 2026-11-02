from dataclasses import replace
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import (ArchiveLedger, BoardOption, ContractBoard, Evaluation,
                        Match, MatchParticipant, MissionDefinition, OutboxEvent,
                        RewardLedgerEntry, User)


def service():
    # Import inside the test so a missing implementation produces a failing test.
    from app.services import coin_rewards
    return coin_rewards


@pytest.fixture()
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'coins.db'}")
    with Session(engine, autoflush=False) as session:
        yield session
    engine.dispose()


def setup(db, *, mode="STANDARD", difficulty="FOCUSED", count=1,
          played=None, provider="deadlock_api", snapshot=True, user=None):
    rewards = service()
    Base.metadata.create_all(db.get_bind())
    user = user or User(account_id=uuid4().int % 10**9)
    db.add(user)
    db.flush()
    played = played or datetime(2026, 10, 12, 15, tzinfo=timezone.utc)
    board_count = db.scalar(select(func.count()).select_from(ContractBoard).where(ContractBoard.user_id == user.id))
    board = ContractBoard(user_id=user.id, board_date=played.date() + timedelta(days=board_count), seed=str(uuid4()),
                          game_match_mode=mode, status="LOCKED", locked_at=played - timedelta(hours=2),
                          expires_at=played + timedelta(hours=5))
    db.add(board)
    db.flush()
    options = []
    for _ in range(count):
        mission = MissionDefinition(key=str(uuid4()), version=1, title="Kills", description="Kills",
                                    metric="player.kills", operator="gte", target=5, reward_xp=10)
        db.add(mission)
        db.flush()
        option = BoardOption(board_id=board.id, mission_definition_id=mission.id,
                             rendered_title="Kills", rendered_description="Kills", metric="player.kills",
                             operator="gte", target=5, reward_xp=10, difficulty=difficulty,
                             selected=True, status="LOCKED", locked_at=board.locked_at,
                             required_game_match_mode=mode, required_capabilities=["summary.kills"])
        db.add(option)
        options.append(option)
    db.flush()
    if snapshot:
        rewards.snapshot_signing(db, board)
    match = Match(external_match_id=uuid4().int % 10**14, provider=provider,
                  started_at=played - timedelta(minutes=25), ended_at=played, duration_s=1500,
                  game_match_mode=mode, mode_classifier_version="mode-test", mode_confidence="HIGH",
                  scoring_status="SCORED", is_final=True, capabilities=["summary.kills"])
    db.add(match)
    db.flush()
    db.add(MatchParticipant(match_id=match.id, account_id=user.account_id, kills=10))
    for option in options:
        evaluation = Evaluation(assignment_id=option.id, match_id=match.id, status="COMPLETED",
                                evaluator_version="test", explanation="Independent final result",
                                facts=[{"metric": "player.kills", "value": 10, "passed": True}])
        db.add(evaluation)
        db.flush()
        option.status = "COMPLETED"
        option.bound_match_id = match.id
        option.final_evaluation_id = evaluation.id
        option.settled_at = played + timedelta(minutes=1)
    board.status = "SETTLED"
    db.flush()
    return user, board, options, match


def deliver_all(db):
    rewards = service()
    events = list(db.scalars(select(OutboxEvent).where(OutboxEvent.event_type == "coin.reward")))
    for event in events:
        rewards.deliver_entitlement(db, event.payload["entitlement_id"])
    db.flush()


@pytest.mark.parametrize("mode", ["STANDARD", "RANKED", "STREET_BRAWL"])
@pytest.mark.parametrize("difficulty", ["LIGHT", "FOCUSED", "HARD", "EXTREME"])
def test_contract_settlement_no_longer_reserves_currency_or_changes_xp(db, mode, difficulty):
    from app.coin_models import CoinEntitlement, CoinPolicySnapshot
    user, board, options, _ = setup(db, mode=mode, difficulty=difficulty)
    user.xp = 10
    db.add(RewardLedgerEntry(user_id=user.id, source_type="assignment", source_id=options[0].id, delta=10, balance_after=10))
    assert service().snapshot_signing(db, board) == 0
    assert service().settle_assignment(db, options[0].id) is None
    assert service().settle_assignment(db, options[0].id) is None
    deliver_all(db)
    assert db.scalar(select(func.count()).select_from(CoinPolicySnapshot)) == 0
    assert db.scalar(select(func.count()).select_from(CoinEntitlement)) == 0
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == 0
    assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 0
    assert user.xp == 10


def test_queued_historical_entitlement_cannot_deliver_after_retirement(db):
    from app.coin_models import CoinEntitlement
    user, _, options, _ = setup(db)
    row = CoinEntitlement(user_id=user.id, source_type="assignment", source_id=options[0].id,
                          policy_version="coins-v1", nominal_amount=10, amount=10, eligible=True,
                          reason="AWARDED", status="RESERVED")
    db.add(row); db.flush()
    db.add(OutboxEvent(event_type="coin.reward", aggregate_id=row.id, payload={"entitlement_id": row.id}))
    db.commit()
    assert service().deliver_entitlement(db, row.id) is None
    db.refresh(row)
    assert row.status == "RESERVED" and row.amount == 10 and row.delivered_at is None
    assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 0


def test_historical_correction_is_append_only_idempotent_and_keeps_quota(db):
    from app.coin_models import CoinCorrection, CoinEntitlement, CoinQuota
    user, board, options, match = setup(db, count=2)
    day = match.ended_at.date()
    db.add(CoinQuota(user_id=user.id, source="CONTRACT", period_kind="DAY", period_start=day, used=30))
    rows=[]
    for kind, source in [("assignment", options[0].id), ("assignment", options[1].id), ("case", board.id)]:
        row = CoinEntitlement(user_id=user.id, source_type=kind, source_id=source,
            policy_version="coins-v1", nominal_amount=10, amount=10, eligible=True, reason="AWARDED", status="DELIVERED")
        db.add(row); db.flush(); rows.append(row)
        db.add(ArchiveLedger(user_id=user.id, source="historical:"+row.id, reason="CONTRACT", delta=10))
    db.commit()
    key=uuid4()
    result=service().correct_entitlement(db, rows[0].id, request_key=key, actor_user_id=user.id, reason="Historical correction")
    db.commit()
    assert result["delta"] == -10 and len(result["related_corrections"]) == 1
    assert service().correct_entitlement(db, rows[0].id, request_key=key, actor_user_id=user.id, reason="Historical correction") == result
    assert db.scalar(select(func.count()).select_from(CoinCorrection)) == 2
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 10
    assert db.scalar(select(CoinQuota.used)) == 30
    assert [row.amount for row in rows] == [10,10,10]


def test_historical_status_is_read_only_and_disabled(db):
    from app.coin_models import CoinEntitlement
    user, _, _, _=setup(db)
    before=db.scalar(select(func.count()).select_from(CoinEntitlement))
    assert service().status(db,user.id)["enabled"] is False
    assert db.scalar(select(func.count()).select_from(CoinEntitlement)) == before
