"""Verify retired coin issuance and preserve historical correction concurrency on PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.coin_models import (
    CoinCorrection,
    CoinEntitlement,
    CoinPolicySnapshot,
    CoinQuota,
)
from app.db import SessionLocal, engine
from app.models import (
    ArchiveLedger,
    BoardOption,
    ContractBoard,
    Evaluation,
    Match,
    MatchParticipant,
    MissionDefinition,
    OutboxEvent,
    RewardLedgerEntry,
    User,
    utcnow,
)
from app.services import extra_coin_rewards
from app.services.coin_rewards import (
    correct_entitlement,
    deliver_entitlement,
    settle_assignment,
    snapshot_signing,
)


def main():
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Coin concurrency checks require PostgreSQL row locks")
    user_id = None
    mission_ids, match_ids = [], []
    try:
        with SessionLocal() as db:
            now = utcnow()
            user = User(display_name="Coin concurrency smoke", account_id=uuid4().int % 10**9, xp=10)
            db.add(user)
            db.flush()
            user_id = user.id
            option_ids = []
            for index in range(5):
                board = ContractBoard(user_id=user.id, board_date=now.date() - timedelta(days=index),
                    seed=str(uuid4()), status="LOCKED", game_match_mode="STANDARD",
                    locked_at=now - timedelta(hours=2), expires_at=now + timedelta(hours=2))
                mission = MissionDefinition(key="coin-smoke-" + str(uuid4()), version=1,
                    title="Kills", description="Kills", metric="player.kills", operator="gte", target=5, reward_xp=10)
                db.add_all([board, mission])
                db.flush()
                mission_ids.append(mission.id)
                option = BoardOption(board_id=board.id, mission_definition_id=mission.id, rendered_title="Kills",
                    rendered_description="Kills", metric="player.kills", operator="gte", target=5, reward_xp=10,
                    difficulty="EXTREME", selected=True, status="LOCKED", locked_at=board.locked_at,
                    required_game_match_mode="STANDARD", required_capabilities=["summary.kills"])
                db.add(option)
                db.flush()
                assert snapshot_signing(db, board) == 0
                match = Match(external_match_id=uuid4().int % 10**14, provider="deadlock_api",
                    started_at=now - timedelta(minutes=30), ended_at=now - timedelta(minutes=5), duration_s=1500,
                    is_final=True, scoring_status="SCORED", game_match_mode="STANDARD",
                    mode_classifier_version="coin-smoke", capabilities=["summary.kills"])
                db.add(match)
                db.flush()
                match_ids.append(match.id)
                db.add(MatchParticipant(match_id=match.id, account_id=user.account_id, kills=10))
                evaluation = Evaluation(assignment_id=option.id, match_id=match.id, status="COMPLETED",
                    evaluator_version="coin-smoke", explanation="Independent final facts",
                    facts=[{"metric": "player.kills", "value": 10, "passed": True}])
                db.add(evaluation)
                db.flush()
                option.status, option.settled_at = "COMPLETED", now
                option.bound_match_id, option.final_evaluation_id = match.id, evaluation.id
                board.status = "SETTLED"
                db.flush()
                option_ids.append(option.id)
            db.add(RewardLedgerEntry(user_id=user_id, source_type="assignment", source_id=option_ids[0],
                                    delta=10, balance_after=10))
            db.commit()

        def race(values, action):
            barrier = Barrier(len(values))
            def call(value):
                with SessionLocal() as db:
                    barrier.wait(timeout=15)
                    result = action(db, value)
                    db.commit()
                    return result
            with ThreadPoolExecutor(max_workers=len(values)) as pool:
                return list(pool.map(call, values))

        assert race([option_ids[0], option_ids[0]], settle_assignment) == [None, None]
        assert race(option_ids[1:], settle_assignment) == [None] * 4
        with SessionLocal() as db:
            for model in (CoinEntitlement, CoinQuota, CoinPolicySnapshot, ArchiveLedger):
                assert db.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) == 0
            assert not db.scalar(select(func.count()).select_from(OutboxEvent).where(
                OutboxEvent.event_type == "coin.reward", OutboxEvent.payload["user_id"].as_string() == user_id))
            for kind in sorted(extra_coin_rewards.KINDS):
                assert extra_coin_rewards.reserve(db, user_id, kind, str(uuid4()), 100, now, []) is None
            # Seed an existing historical obligation directly, rather than
            # reopening the retired issuance path or any public mint endpoint.
            legacy = CoinEntitlement(user_id=user_id, source_type="assignment", source_id=option_ids[0],
                policy_version="coins-v1", nominal_amount=24, amount=24, eligible=True,
                reason="AWARDED", status="RESERVED")
            db.add(legacy)
            db.flush()
            legacy_id = legacy.id
            db.add(OutboxEvent(event_type="coin.reward", aggregate_id=legacy_id,
                payload={"entitlement_id": legacy_id, "user_id": user_id}))
            db.commit()
        assert race([legacy_id, legacy_id], deliver_entitlement) == [None, None]
        with SessionLocal() as db:
            legacy = db.get(CoinEntitlement, legacy_id)
            assert legacy.status == "RESERVED" and legacy.amount == 24 and legacy.delivered_at is None
            assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == user_id)) == 0
            # Historical corrections still serialize and append exactly once.
            legacy.status = "DELIVERED"
            db.add(ArchiveLedger(user_id=user_id, source="historical-ci-credit", reason="CONTRACT", delta=24))
            db.add(CoinQuota(user_id=user_id, source="CONTRACT", period_kind="DAY", period_start=now.date(), used=24))
            db.commit()
        correction_key = str(uuid4())
        corrections = race([legacy_id, legacy_id], lambda db, identifier: correct_entitlement(
            db, identifier, request_key=correction_key, actor_user_id=user_id, reason="Correct historical CI receipt"))
        assert corrections[0] == corrections[1] and corrections[0]["delta"] == -24, corrections
        with SessionLocal() as db:
            legacy = db.get(CoinEntitlement, legacy_id)
            assert legacy.status == "CORRECTED" and legacy.amount == 24
            assert db.scalar(select(func.count()).select_from(CoinEntitlement).where(CoinEntitlement.user_id == user_id)) == 1
            assert db.scalar(select(func.count()).select_from(CoinCorrection).where(CoinCorrection.user_id == user_id)) == 1
            assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == user_id)) == 2
            assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id)) == 0
            assert db.scalar(select(CoinQuota.used).where(CoinQuota.user_id == user_id)) == 24
            assert db.get(User, user_id).xp == 10
        print("Coin retirement OK: no new signing policy, settlement award or queued payout; historical corrections remain append-only, idempotent and quota-preserving")
    finally:
        if user_id:
            with SessionLocal() as db:
                db.execute(delete(OutboxEvent).where(OutboxEvent.event_type == "coin.reward",
                                                     OutboxEvent.payload["user_id"].as_string() == user_id))
                db.execute(delete(User).where(User.id == user_id))
                db.execute(delete(Match).where(Match.id.in_(match_ids)))
                db.execute(delete(MissionDefinition).where(MissionDefinition.id.in_(mission_ids)))
                db.commit()


if __name__ == "__main__":
    main()
