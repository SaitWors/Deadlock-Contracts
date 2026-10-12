"""PostgreSQL purchase races exercise real locks, receipts and guarantee updates."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import HTTPException
from sqlalchemy import delete, func, select

from app.archive_packs import OpenPack
from app.db import SessionLocal, engine
from app.models import ArchiveItem, ArchiveLedger, ArchiveOperation, User
from app.pack_models import PackGuaranteeState
from app.services import archive_packs as packs
from app.services.battle_catalog import seed_battle_catalogue
from scripts.ci_original_archive_fixture import seed_original_archive_fixture


def main():
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Pack concurrency checks require PostgreSQL row locks")
    user_id = None
    random_ticket, finish = packs.secrets.randbelow, packs.finish
    packs.secrets.randbelow = lambda total: 0
    night = str(uuid5(NAMESPACE_URL, "deadlock-contracts:pack-v2:NIGHT_ENVELOPE"))
    folder = str(uuid5(NAMESPACE_URL, "deadlock-contracts:pack-v2:SPECIAL_FOLDER"))
    try:
        with SessionLocal() as db:
            seed_battle_catalogue(db)
            seed_original_archive_fixture(db)
            packs.seed_pack_v2(db)
            user = User(display_name="Pack v2 concurrency smoke")
            db.add(user); db.flush(); user_id = user.id
            for scope in ("REAL", "SANDBOX"):
                db.add(ArchiveLedger(user_id=user_id, source=f"pack-smoke:{scope}", reason="TEST", delta=10000, scope=scope))
            db.commit()

        def call(pack_id, payload):
            with SessionLocal() as db:
                try:
                    return {"status": 200, "receipt": packs.open_pack(db, user_id, pack_id, payload)}
                except HTTPException as error:
                    db.rollback()
                    return {"status": error.status_code}

        def race(values):
            barrier = Barrier(len(values))
            def invoke(value):
                barrier.wait(timeout=15)
                return call(*value)
            with ThreadPoolExecutor(max_workers=len(values)) as workers:
                return list(workers.map(invoke, values))

        same = OpenPack(request_key=uuid4(), revision=1, guarantee_revision=0)
        repeated = race([(night, same), (night, same)])
        assert [value["status"] for value in repeated] == [200, 200], repeated
        assert repeated[0]["receipt"] == repeated[1]["receipt"], repeated
        assert len(repeated[0]["receipt"]["items"]) == 3

        competing = race([(night, OpenPack(request_key=uuid4(), revision=1, guarantee_revision=1)),
                          (folder, OpenPack(request_key=uuid4(), revision=1, guarantee_revision=1))])
        assert sorted(value["status"] for value in competing) == [200, 409], competing
        winner = next(value["receipt"] for value in competing if value["status"] == 200)
        with SessionLocal() as db:
            state = packs.guarantee_state(db, user_id, "REAL")
            assert state.revision == 2 and state.without_a == 3 + len(winner["items"])
            state.without_a, state.without_s, state.without_sss, state.revision = 29, 119, 359, 20
            db.commit()

        forced = race([(night, OpenPack(request_key=uuid4(), revision=1, guarantee_revision=20)),
                       (night, OpenPack(request_key=uuid4(), revision=1, guarantee_revision=20))])
        assert sorted(value["status"] for value in forced) == [200, 409], forced
        forced_receipt = next(value["receipt"] for value in forced if value["status"] == 200)
        assert [value["card"]["rank"] for value in forced_receipt["items"]] == ["SSS", "F", "F"]
        assert [value["forced"] for value in forced_receipt["items"]] == [True, False, False]
        with SessionLocal() as db:
            state = packs.guarantee_state(db, user_id, "REAL")
            assert (state.without_a, state.without_s, state.without_sss, state.revision) == (2, 2, 2, 21)
            real_before = packs.guarantee_payload(state, "REAL")
            item_count = db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id))
            net_before = packs.balance(db, user_id)

        sandbox = call(night, OpenPack(request_key=uuid4(), revision=1, guarantee_revision=0, scope="SANDBOX"))
        assert sandbox["status"] == 200 and all(value["scope"] == "SANDBOX" for value in sandbox["receipt"]["items"])
        with SessionLocal() as db:
            assert packs.guarantee_payload(packs.guarantee_state(db, user_id, "REAL"), "REAL") == real_before
            assert packs.balance(db, user_id) == net_before
            assert packs.guarantee_state(db, user_id, "SANDBOX").without_a == 3

        def interrupted(*args, **kwargs):
            raise RuntimeError("Interrupted before committing receipt")
        packs.finish = interrupted
        retry = OpenPack(request_key=uuid4(), revision=1, guarantee_revision=21)
        with SessionLocal() as db:
            try:
                packs.open_pack(db, user_id, night, retry)
                raise AssertionError("Expected interrupted purchase")
            except RuntimeError:
                db.rollback()
        packs.finish = finish
        with SessionLocal() as db:
            assert packs.guarantee_payload(packs.guarantee_state(db, user_id, "REAL"), "REAL") == real_before
            assert packs.balance(db, user_id) == net_before
            assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id)) == item_count + 3
        recovered = call(night, retry)
        assert recovered["status"] == 200 and call(night, retry) == recovered

        with SessionLocal() as db:
            for scope in ("REAL", "SANDBOX"):
                operations = list(db.scalars(select(ArchiveOperation).where(ArchiveOperation.user_id == user_id, ArchiveOperation.scope == scope)))
                spent = sum(-value.result["delta"] for value in operations)
                basis = db.scalar(select(func.sum(ArchiveItem.cost_basis)).where(ArchiveItem.user_id == user_id, ArchiveItem.scope == scope))
                debits = db.scalar(select(func.count()).select_from(ArchiveLedger).where(
                    ArchiveLedger.user_id == user_id, ArchiveLedger.scope == scope, ArchiveLedger.delta < 0))
                assert basis == spent and packs.balance(db, user_id, scope) == 10000 - spent
                assert debits == len(operations), (scope, debits, len(operations))
            assert packs.guarantee_state(db, user_id, "REAL").revision == 22
        print("Pack v2 concurrency OK: duplicate receipts, stale disclosure, single SSS guarantee, isolated scopes, atomic rollback")
    finally:
        packs.secrets.randbelow, packs.finish = random_ticket, finish
        if user_id:
            with SessionLocal() as db:
                db.execute(delete(User).where(User.id == user_id))
                db.commit()


if __name__ == "__main__":
    main()
