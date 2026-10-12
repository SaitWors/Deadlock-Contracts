"""Exercise coin reservation, duplicate delivery and quotas with PostgreSQL locks."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.coin_models import CoinEntitlement, CoinQuota
from app.db import SessionLocal, engine
from app.models import (ArchiveLedger, BoardOption, ContractBoard, Evaluation, Match,
                        MatchParticipant, MissionDefinition, OutboxEvent, RewardLedgerEntry, User, utcnow)
from app.services.coin_rewards import deliver_entitlement, settle_assignment, snapshot_signing
from app.worker import dispatch_outbox


def main():
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Coin concurrency checks require PostgreSQL row locks")
    user_id = None
    mission_ids, match_ids, event_ids = [], [], []
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
                snapshot_signing(db, board)
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

        repeated = race([option_ids[0], option_ids[0]], settle_assignment)
        assert repeated[0]["id"] == repeated[1]["id"], repeated
        assert repeated[0]["amount"] == 24
        competed = race(option_ids[1:], settle_assignment)
        assert sum(row["amount"] for row in competed) == 56, competed
        assert sorted(row["amount"] for row in competed) == [0, 8, 24, 24], competed

        # Both sessions can observe RESERVED before waiting for the same user.
        # A fresh locked entitlement must make the second delivery a no-op.
        duplicate_delivery = race([repeated[0]["id"], repeated[0]["id"]], deliver_entitlement)
        assert all(row["status"] == "DELIVERED" for row in duplicate_delivery)
        with SessionLocal() as db:
            assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id)) == 24
            events = list(db.scalars(select(OutboxEvent).where(OutboxEvent.event_type == "coin.reward",
                                                               OutboxEvent.payload["user_id"].as_string() == user_id)))
            # Place only this test's events at the front of a possibly shared CI queue.
            for event in events:
                event.run_after = now - timedelta(days=36500)
                event_ids.append(event.id)
            duplicate = OutboxEvent(event_type="coin.reward", aggregate_id=repeated[0]["id"],
                payload={"entitlement_id": repeated[0]["id"], "user_id": user_id}, run_after=now - timedelta(days=36500))
            db.add(duplicate)
            db.flush()
            event_ids.append(duplicate.id)
            db.commit()
        for _ in range((len(event_ids) + 1) // 2):
            race([None, None], lambda db, unused: dispatch_outbox(db))
        with SessionLocal() as db:
            entitlements = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.user_id == user_id)))
            assert len(entitlements) == 5
            assert sum(row.amount for row in entitlements) == 80
            assert all(row.status == "DELIVERED" for row in entitlements)
            assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id)) == 80
            assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == user_id)) == 4
            assert sorted(db.scalars(select(CoinQuota.used).where(CoinQuota.user_id == user_id))) == [80, 80]
            assert all(event.published_at for event in db.scalars(select(OutboxEvent).where(OutboxEvent.id.in_(event_ids))))
            assert db.get(User, user_id).xp == 10
        print("Coin concurrency OK: one right per contract, exact 80/day cap, zero decision, duplicate delivery, independent XP")
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
