"""Verify arena commands and bounded PvE rewards against PostgreSQL row locks."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, select

from app.battle_models import BattleAction, BattleAssignment, BattleItemReservation, BattleMatch
from app.coin_models import CoinEntitlement, CoinQuota
from app.db import SessionLocal, engine
from app.models import ArchiveLedger, OutboxEvent, User, utcnow
from app.services import battle_service as arena, extra_coin_rewards as rewards
from app.services.battle_catalog import seed_battle_catalogue
from app.services.coin_rewards import deliver_entitlement
from app.services.arena_privacy import purge_account_battles
from scripts.ci_original_archive_fixture import seed_original_archive_fixture


def race(values, action):
    barrier = Barrier(len(values))

    def invoke(value):
        with SessionLocal() as db:
            barrier.wait(timeout=15)
            try:
                result = action(db, value)
                db.commit()
                return {"status": 200, "result": result}
            except HTTPException as error:
                db.rollback()
                return {"status": error.status_code}

    with ThreadPoolExecutor(max_workers=len(values)) as pool:
        return list(pool.map(invoke, values))


def main():
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Arena concurrency checks require PostgreSQL row locks")
    user_id, other_user_id = None, None
    try:
        with SessionLocal() as db:
            seed_battle_catalogue(db)
            seed_original_archive_fixture(db)
            user = User(display_name="Arena concurrency smoke")
            db.add(user); db.flush(); user_id = user.id
            db.commit()

        key = str(uuid4())
        starters = race([key, key], lambda db, value: arena.claim_starter(db, user_id, value, "REAL"))
        assert starters[0] == starters[1] and starters[0]["status"] == 200, starters
        body = {"request_key": str(uuid4()), "mode": "TRAINING", "scope": "REAL", "squad_revision": 1, "base_item_id": None}
        starts = race([body, body], lambda db, value: arena.start_match(db, user_id, value))
        assert starts[0] == starts[1] and starts[0]["status"] == 200, starts
        match_id = starts[0]["result"]["match"]["id"]
        plan_key = str(uuid4())
        plans = race([plan_key, plan_key], lambda db, value: arena.submit_plan(db, user_id, match_id, value, 1, []))
        assert plans[0] == plans[1] and plans[0]["result"]["match"]["round"] == 2, plans
        competing = race([str(uuid4()), str(uuid4())], lambda db, value: arena.submit_plan(db, user_id, match_id, value, 2, []))
        assert sorted(value["status"] for value in competing) == [200, 409], competing
        with SessionLocal() as db:
            assert db.scalar(select(func.count()).select_from(BattleAction).where(BattleAction.match_id == match_id)) == 2
            assert db.scalar(select(func.count()).select_from(BattleItemReservation).where(BattleItemReservation.match_id == match_id)) == 6
            arena.surrender(db, user_id, match_id, str(uuid4()), 3)
        with SessionLocal() as db:
            assert not db.scalar(select(func.count()).select_from(BattleItemReservation).where(BattleItemReservation.match_id == match_id))
            # 15 eligible wins fill the weekly 120; the sixteenth reserves an
            # immutable zero decision and still counts toward EX progression.
            monday = rewards.periods(utcnow())[1]
            at = utcnow().replace(hour=12, minute=0, second=0, microsecond=0)
            at = at - timedelta(days=(at.date()-monday).days)
            ids = []
            for index in range(16):
                completed = at + timedelta(days=index//3)
                assignment = BattleAssignment(user_id=user_id, period_day=completed.date(), slot=index%3+1,
                    mode="ASSIGNED", opponent={}, status="COMPLETED", completed_at=completed)
                db.add(assignment); db.flush()
                match = BattleMatch(user_id=user_id, mode="ASSIGNED", state={}, snapshot={}, status="FINISHED",
                    assignment_id=assignment.id, reward_eligible=True, outcome="WIN", completed_at=completed,
                    result={"winner_side": "A", "reason": "BASE_DESTROYED"})
                db.add(match); db.flush(); assignment.match_id = match.id
                ids.append(match.id)
            db.commit()

        reserved = race(ids, lambda db, value: rewards.settle_battle(db, db.get(BattleMatch, value)))
        assert all(value["status"] == 200 for value in reserved)
        amounts = [value["result"]["amount"] for value in reserved]
        assert sum(amounts) == 120 and sorted(amounts) == [0]+[8]*15, amounts
        repeated = race([ids[0], ids[0]], lambda db, value: rewards.settle_battle(db, db.get(BattleMatch, value)))
        assert repeated[0] == repeated[1]
        with SessionLocal() as db:
            rights = list(db.scalars(select(CoinEntitlement.id).where(CoinEntitlement.user_id == user_id)))
        delivered = race(rights+rights, deliver_entitlement)
        assert all(value["status"] == 200 and value["result"]["status"] == "DELIVERED" for value in delivered)
        with SessionLocal() as db:
            assert rewards.eligible_pve_win_count(db, user_id) == 16
            assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id, ArchiveLedger.reason == "PVE_WIN")) == 120
            assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id, ArchiveLedger.reason == "WEEKLY_COMMISSION")) == 60
            assert db.scalar(select(func.count()).select_from(CoinEntitlement).where(CoinEntitlement.user_id == user_id, CoinEntitlement.source_type == "weekly")) == 1
            assert db.scalar(select(CoinQuota.used).where(CoinQuota.user_id == user_id, CoinQuota.source == "PVE", CoinQuota.period_kind == "WEEK")) == 120
            other = User(display_name="Arena peer smoke")
            db.add(other); db.flush(); other_user_id = other.id; db.commit()
        with SessionLocal() as db:
            arena.claim_starter(db, other_user_id, str(uuid4()), "REAL")
            code = arena.create_room(db, user_id, str(uuid4()), "REAL")["room"]["code"]
            arena.join_room(db, other_user_id, code, str(uuid4()))
        confirmed = race([user_id, other_user_id], lambda db, uid: arena.confirm_room(db, uid, code, str(uuid4()), 1, None))
        assert all(value["status"] == 200 for value in confirmed), confirmed
        peer_match_id = next(value["result"]["room"]["match_id"] for value in confirmed if value["result"]["room"]["match_id"])
        keys = {user_id: str(uuid4()), other_user_id: str(uuid4())}
        sealed = race([user_id, other_user_id], lambda db, uid: arena.submit_plan(db, uid, peer_match_id, keys[uid], 1, []))
        assert all(value["status"] == 200 for value in sealed), sealed
        assert sorted(value["result"]["match"]["round"] for value in sealed) == [1, 2]
        with SessionLocal() as db:
            purge_account_battles(db, other_user_id)
            db.execute(delete(User).where(User.id == other_user_id)); db.commit()
        with SessionLocal() as db:
            assert arena.request_result(db, user_id, keys[user_id]) == {"result": None}
            assert arena.request_result(db, user_id, key)["result"] == starters[0]["result"]
            assert db.get(BattleMatch, peer_match_id) is None
            assert not db.scalar(select(func.count()).select_from(BattleItemReservation).where(BattleItemReservation.match_id == peer_match_id))
        print("Arena concurrency OK: one starter/match/round, stale plans, 120/week, duplicate delivery, simultaneous PvP confirmations/plans, peer-deletion privacy")
    finally:
        if user_id:
            with SessionLocal() as db:
                db.execute(delete(OutboxEvent).where(OutboxEvent.event_type == "coin.reward", OutboxEvent.payload["user_id"].as_string() == user_id))
                db.execute(delete(User).where(User.id.in_([value for value in (user_id, other_user_id) if value])))
                db.commit()


if __name__ == "__main__":
    main()
