"""Verify preserved historical Arena locks and retired reward issuance on PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, select

from app.battle_models import (
    BattleAction,
    BattleAssignment,
    BattleItemReservation,
    BattleMatch,
)
from app.coin_models import CoinEntitlement, CoinQuota
from app.db import SessionLocal, engine
from app.models import ArchiveLedger, OutboxEvent, User, utcnow
from app.services import battle_service as arena
from app.services import extra_coin_rewards as rewards
from app.services.arena_privacy import purge_account_battles
from app.services.battle_catalog import seed_battle_catalogue
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
        plans = race([plan_key, plan_key], lambda db, value: arena.submit_plan(db, user_id, match_id, value, 1, [{"type": "READY"}]))
        assert plans[0] == plans[1] and plans[0]["result"]["match"]["state"]["phase"] == "PLAY", plans
        own = plans[0]["result"]["match"]["state"]["sides"][0]
        card = next(card for card in own["hand"] if card["kind"] == "UNIT")
        action = {"type": "PLAY", "card_id": card["id"], "row": card["rows"][0]}
        competing = race([str(uuid4()), str(uuid4())], lambda db, value: arena.submit_plan(db, user_id, match_id, value, 2, [action]))
        assert sorted(value["status"] for value in competing) == [200, 409], competing
        with SessionLocal() as db:
            assert db.scalar(select(func.count()).select_from(BattleAction).where(BattleAction.match_id == match_id)) == 2
            assert db.scalar(select(func.count()).select_from(BattleItemReservation).where(BattleItemReservation.match_id == match_id)) == 6
            arena.surrender(db, user_id, match_id, str(uuid4()), 3)
        with SessionLocal() as db:
            assert not db.scalar(select(func.count()).select_from(BattleItemReservation).where(BattleItemReservation.match_id == match_id))
            # Historical gameplay records remain valid fixtures, but retired
            # settlement must not mint currency or new economic progress facts.
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
        assert all(value["result"] is None for value in reserved), reserved
        repeated = race([ids[0], ids[0]], lambda db, value: rewards.settle_battle(db, db.get(BattleMatch, value)))
        assert repeated[0] == repeated[1] and repeated[0]["result"] is None
        with SessionLocal() as db:
            assert rewards.eligible_pve_win_count(db, user_id) == 0
            assert db.scalar(select(func.count()).select_from(BattleAssignment).where(BattleAssignment.user_id == user_id)) == 16
            for model in (CoinEntitlement, CoinQuota, ArchiveLedger):
                assert db.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) == 0
            assert not db.scalar(select(func.count()).select_from(OutboxEvent).where(
                OutboxEvent.event_type == "coin.reward", OutboxEvent.payload["user_id"].as_string() == user_id))
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
        sealed = race([user_id, other_user_id], lambda db, uid: arena.submit_plan(db, uid, peer_match_id, keys[uid], 1, [{"type": "READY"}]))
        # The second browser must refresh its optimistic revision, even during
        # independent mulligans. Rejected commands leave no durable receipt.
        assert sorted(value["status"] for value in sealed) == [200, 409], sealed
        rejected = (user_id, other_user_id)[next(index for index, result in enumerate(sealed) if result["status"] == 409)]
        with SessionLocal() as db:
            view = arena.get_match(db, rejected, peer_match_id)["match"]
            both_ready = arena.submit_plan(db, rejected, peer_match_id, keys[rejected], view["revision"], [{"type": "READY"}])
            assert both_ready["match"]["state"]["phase"] == "PLAY"
        with SessionLocal() as db:
            purge_account_battles(db, other_user_id)
            db.execute(delete(User).where(User.id == other_user_id)); db.commit()
        with SessionLocal() as db:
            assert arena.request_result(db, user_id, keys[user_id]) == {"result": None}
            assert arena.request_result(db, user_id, key)["result"] == starters[0]["result"]
            assert db.get(BattleMatch, peer_match_id) is None
            assert not db.scalar(select(func.count()).select_from(BattleItemReservation).where(BattleItemReservation.match_id == peer_match_id))
        print("Historical Arena concurrency OK: one starter/match/turn, stale turns, no new currency, simultaneous PvP confirmations/readiness, peer-deletion privacy")
    finally:
        if user_id:
            with SessionLocal() as db:
                db.execute(delete(OutboxEvent).where(OutboxEvent.event_type == "coin.reward", OutboxEvent.payload["user_id"].as_string() == user_id))
                db.execute(delete(User).where(User.id.in_([value for value in (user_id, other_user_id) if value])))
                db.commit()


if __name__ == "__main__":
    main()
