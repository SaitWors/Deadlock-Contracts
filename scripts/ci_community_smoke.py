"""PostgreSQL-only race checks for bureau capacity and single membership."""
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, select

from app.db import SessionLocal, engine
from app.models import (BoardOption, BureauContribution, BureauContributionEvent, BureauMembership,
    BureauMembershipPeriod, BureauOperation, ContractBoard, Evaluation, Match, MissionDefinition,
    PlayerBureau, RewardLedgerEntry, User, utcnow)
from app.services.bureau_operations import reconcile
from app.services.bureaus import CAPACITY, add_member, lock_bureau


def main() -> None:
    if engine.dialect.name != "postgresql":
        raise RuntimeError("This concurrency check requires PostgreSQL row locks")
    token = uuid4().hex[:10]
    user_ids, bureau_ids = [], []
    operation_id = mission_id = match_id = None
    try:
        with SessionLocal() as db:
            for index in range(CAPACITY + 4):
                user = User(display_name=f"CI community {token} {index}")
                db.add(user); db.flush(); user_ids.append(user.id)
            for index in range(3):
                bureau = PlayerBureau(slug=f"ci-{token}-{index}", name="Deadlock CI", owner_user_id=user_ids[index], recruitment="OPEN")
                db.add(bureau); db.flush(); bureau_ids.append(bureau.id)
                db.add(BureauMembership(bureau_id=bureau.id, user_id=user_ids[index], role="DIRECTOR"))
            for user_id in user_ids[3:CAPACITY + 1]:
                db.add(BureauMembership(bureau_id=bureau_ids[0], user_id=user_id))
            db.commit()
        def race(jobs):
            barrier = Barrier(2)
            def attempt(job):
                slug, user_id = job
                with SessionLocal() as db:
                    barrier.wait(timeout=10)
                    try:
                        bureau = lock_bureau(db, slug)
                        add_member(db, bureau, user_id)
                        db.commit()
                        return 200
                    except HTTPException as error:
                        db.rollback()
                        return error.status_code
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(attempt, jobs))
            if sorted(results) != [200, 409]:
                raise RuntimeError(f"Expected exactly one successful admission, got {results}")
        race([(f"ci-{token}-0", user_ids[-1]), (f"ci-{token}-0", user_ids[-2])])
        with SessionLocal() as db:
            count = db.scalar(select(func.count()).select_from(BureauMembership).where(BureauMembership.bureau_id == bureau_ids[0]))
            assert count == CAPACITY, count
        race([(f"ci-{token}-1", user_ids[-3]), (f"ci-{token}-2", user_ids[-3])])
        with SessionLocal() as db:
            count = db.scalar(select(func.count()).select_from(BureauMembership).where(BureauMembership.user_id == user_ids[-3]))
            assert count == 1, count
        with SessionLocal() as db:
            now = utcnow()
            operation = BureauOperation(bureau_id=bureau_ids[0], template="city_cases", target=20,
                min_contributors=3, started_at=now-timedelta(days=1), ends_at=now+timedelta(days=1))
            db.add(operation); db.flush(); operation_id = operation.id
            db.add(BureauMembershipPeriod(bureau_id=bureau_ids[0], user_id=user_ids[0], joined_at=now-timedelta(days=2)))
            mission = MissionDefinition(key=f"ci-op-{token}", title="CI", description="CI", metric="player.kills", operator=">=", target=1, reward_xp=50)
            db.add(mission); db.flush(); mission_id = mission.id
            board = ContractBoard(user_id=user_ids[0], board_date=now.date(), seed=token, expires_at=now, status="SETTLED")
            db.add(board); db.flush()
            match = Match(external_match_id=uuid4().int % 10**14, provider="ci", mode_classifier_version="ci",
                started_at=now-timedelta(hours=2), ended_at=now-timedelta(hours=1), is_final=True)
            db.add(match); db.flush(); match_id = match.id
            option = BoardOption(board_id=board.id, mission_definition_id=mission.id, rendered_title="CI", rendered_description="CI",
                metric="player.kills", operator=">=", target=1, reward_xp=50, selected=True, status="COMPLETED",
                locked_at=now-timedelta(hours=3), settled_at=now, bound_match_id=match.id)
            db.add(option); db.flush()
            evaluation = Evaluation(assignment_id=option.id, match_id=match.id, status="COMPLETED", evaluator_version="ci", explanation="CI")
            db.add(evaluation); db.flush(); option.final_evaluation_id = evaluation.id
            db.add(RewardLedgerEntry(user_id=user_ids[0], source_id=option.id, source_type="assignment", asset="XP", delta=50, balance_after=50))
            db.commit()
        barrier = Barrier(2)
        def reconcile_race(_):
            with SessionLocal() as db:
                barrier.wait(timeout=10)
                lock_bureau(db, f"ci-{token}-0")
                operation = db.scalar(select(BureauOperation).where(BureauOperation.id == operation_id).with_for_update())
                reconcile(db, operation); db.commit()
                return operation.progress
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert list(pool.map(reconcile_race, range(2))) == [1, 1]
        with SessionLocal() as db:
            assert db.scalar(select(func.count()).select_from(BureauContribution).where(BureauContribution.operation_id == operation_id)) == 1
            assert db.scalar(select(func.count()).select_from(BureauContributionEvent).join(BureauContribution).where(BureauContribution.operation_id == operation_id)) == 1
        print("Community PostgreSQL smoke OK: last seat + single membership + concurrent contribution counted once")
    finally:
        with SessionLocal() as db:
            if operation_id:
                db.execute(delete(BureauOperation).where(BureauOperation.id == operation_id))
            db.execute(delete(BureauMembershipPeriod).where(BureauMembershipPeriod.bureau_id.in_(bureau_ids)))
            db.execute(delete(PlayerBureau).where(PlayerBureau.id.in_(bureau_ids)))
            db.execute(delete(User).where(User.id.in_(user_ids)))
            if mission_id:
                db.execute(delete(MissionDefinition).where(MissionDefinition.id == mission_id))
            if match_id:
                db.execute(delete(Match).where(Match.id == match_id))
            db.commit()


if __name__ == "__main__":
    main()
