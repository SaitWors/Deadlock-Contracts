"""PostgreSQL-only race checks for bureau capacity and single membership."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, select

from app.db import SessionLocal, engine
from app.models import BureauMembership, PlayerBureau, User
from app.services.bureaus import CAPACITY, add_member, lock_bureau


def main() -> None:
    if engine.dialect.name != "postgresql":
        raise RuntimeError("This concurrency check requires PostgreSQL row locks")
    token = uuid4().hex[:10]
    user_ids, bureau_ids = [], []
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
        print("Community PostgreSQL smoke OK: last seat + one bureau per player")
    finally:
        with SessionLocal() as db:
            db.execute(delete(PlayerBureau).where(PlayerBureau.id.in_(bureau_ids)))
            db.execute(delete(User).where(User.id.in_(user_ids)))
            db.commit()


if __name__ == "__main__":
    main()
