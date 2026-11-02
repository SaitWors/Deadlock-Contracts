"""Exercise the real free-pack API with independent PostgreSQL sessions and UTC rollover."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time, timedelta, timezone
from hashlib import sha256
from io import BytesIO
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import delete, func, select, update

from app.db import SessionLocal, engine
from app.main import app
from app.models import (
    ArchiveCard,
    ArchiveItem,
    ArchiveLedger,
    ArchiveOperation,
    ArchivePack,
    ArchivePackVersion,
    SessionToken,
    User,
    utcnow,
)
from app.services import archive_packs as packs
from app.services.auth import COOKIE_NAME, csrf_token, hash_token


def main():
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Daily-pack concurrency checks require PostgreSQL row locks")
    user_ids, paused_pack_ids, tokens = [], [], {}
    card_id = pack_id = None
    try:
        image = BytesIO()
        Image.new("RGB", (240, 360), "#394b65").save(image, format="WEBP")
        artwork = image.getvalue()
        with SessionLocal() as db:
            # The workflow's disposable database is shared by sequential smoke
            # steps. Isolate this pool and restore every pre-existing active flag.
            paused_pack_ids = list(db.scalars(select(ArchivePack.id).where(ArchivePack.active.is_(True))))
            if paused_pack_ids:
                db.execute(update(ArchivePack).where(ArchivePack.id.in_(paused_pack_ids)).values(active=False))
            card = ArchiveCard(hero="abrams", rank="F", title="Daily PG smoke card", status="PUBLISHED",
                               image_data=artwork, image_digest=sha256(artwork).hexdigest())
            pack = ArchivePack(active=True, starter=True)
            db.add_all([card, pack])
            db.flush()
            card_id, pack_id = card.id, pack.id
            db.add(ArchivePackVersion(pack_id=pack_id, revision=1, config={
                "title": "Daily PostgreSQL fixture", "description": "", "price": 50, "draws": 2,
                "entries": [{"card_id": card_id, "rank": "F", "weight": 1}], "price_model": 1,
            }))
            for name in ("Same key", "Different keys", "Rollover alias", "Unavailable pool", "Rollback"):
                user = User(display_name="Daily PG smoke " + name)
                db.add(user)
                db.flush()
                user_ids.append(user.id)
                token = uuid4().hex
                tokens[user.id] = token
                db.add(SessionToken(token_hash=hash_token(token), user_id=user.id,
                                    expires_at=utcnow() + timedelta(minutes=20)))
            db.commit()

        def request(user_id, method, path, body=None):
            # Each browser request gets an independent get_db Session/connection.
            client = TestClient(app)
            try:
                token = tokens[user_id]
                client.cookies.set(COOKIE_NAME, token)
                client.headers["X-CSRF-Token"] = csrf_token(token)
                return client.request(method, path, json=body)
            finally:
                client.close()

        def claim(user_id, key):
            return request(user_id, "POST", "/api/archive/daily-pack/claim",
                           {"scope": "REAL", "idempotency_key": key})

        def status(user_id):
            response = request(user_id, "GET", "/api/archive/daily-pack?scope=REAL")
            assert response.status_code == 200, response.text
            return response.json()

        def race(user_id, keys):
            gate = Barrier(len(keys))

            def call(key):
                gate.wait(timeout=15)
                response = claim(user_id, key)
                assert response.status_code == 200, response.text
                return response.json()

            with ThreadPoolExecutor(max_workers=len(keys)) as workers:
                receipts = list(workers.map(call, keys))
            assert all(receipt == receipts[0] for receipt in receipts), receipts
            return receipts[0]

        def verify_inventory(user_id, receipts):
            expected_ids = {item["id"] for receipt in receipts for item in receipt["items"]}
            assert len(expected_ids) == 2 * len(receipts)
            for receipt in receipts:
                assert receipt["kind"] == "DAILY_PACK" and receipt["delta"] == 0
                assert receipt["pack"]["price"] == 0 and receipt["pack"]["draws"] == 2
            with SessionLocal() as db:
                items = list(db.scalars(select(ArchiveItem).where(ArchiveItem.user_id == user_id)))
                assert {item.id for item in items} == expected_ids
                assert all(item.card_id == card_id and item.cost_basis == 0 for item in items)
                assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(
                    ArchiveOperation.user_id == user_id, ArchiveOperation.kind == "DAILY_PACK")) == len(receipts)
                assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == user_id)) == 0
                assert db.get(User, user_id).xp == 0
            history = request(user_id, "GET", "/api/archive/openings").json()
            assert history["total"] == len(receipts), history

        # Clock injection is confined to this smoke process. No production flag
        # enables an alternate claim path; every request uses the real handler.
        clock = {"now": datetime.combine(utcnow().date(), time(23, 59, 59), tzinfo=timezone.utc)}
        with patch.object(packs, "utcnow", lambda: clock["now"]):
            same_user, different_user, rollover_user, unavailable_user, rollback_user = user_ids
            same_key = str(uuid4())
            same = race(same_user, [same_key, same_key])
            verify_inventory(same_user, [same])
            different_keys = [str(uuid4()), str(uuid4())]
            different = race(different_user, different_keys)
            verify_inventory(different_user, [different])

            key_a, key_b, key_c = str(uuid4()), str(uuid4()), str(uuid4())
            first_response = claim(rollover_user, key_a)
            assert first_response.status_code == 200, first_response.text
            first = first_response.json()
            replay_b = claim(rollover_user, key_b)
            assert replay_b.status_code == 200 and replay_b.json() == first
            verify_inventory(rollover_user, [first])
            reset = datetime.combine(clock["now"].date() + timedelta(days=1), time.min, tzinfo=timezone.utc)
            assert status(rollover_user)["next_reset_at"] == reset.isoformat()
            # Simulate losing B's response after its alias commit, then retry B
            # in a later UTC day. It must not consume the later entitlement.
            clock["now"] += timedelta(seconds=1)
            assert claim(rollover_user, key_b).json() == first
            recovered_b = request(rollover_user, "GET", f"/api/archive/requests/{key_b}")
            assert recovered_b.status_code == 200 and recovered_b.json()["operation"] == first
            assert status(rollover_user)["available"]
            verify_inventory(rollover_user, [first])
            second_response = claim(rollover_user, key_c)
            assert second_response.status_code == 200, second_response.text
            second = second_response.json()
            assert second["id"] != first["id"] and second["claim_day"] == clock["now"].date().isoformat()
            verify_inventory(rollover_user, [first, second])
            for user_id, keys, receipt in ((same_user, [same_key], same), (different_user, different_keys, different)):
                for key in keys:
                    assert claim(user_id, key).json() == receipt
                assert status(user_id)["available"]
                verify_inventory(user_id, [receipt])

            unavailable_key = str(uuid4())
            with SessionLocal() as db:
                db.get(ArchiveCard, card_id).status = "DRAFT"
                db.commit()
            assert status(unavailable_user)["available"] is False
            for key in (unavailable_key, str(uuid4())):
                response = claim(unavailable_user, key)
                assert response.status_code == 409, response.text
            with SessionLocal() as db:
                for model in (ArchiveOperation, ArchiveItem, ArchiveLedger):
                    assert db.scalar(select(func.count()).select_from(model).where(model.user_id == unavailable_user)) == 0
                db.get(ArchiveCard, card_id).status = "PUBLISHED"
                db.commit()
            recovered = claim(unavailable_user, unavailable_key)
            assert recovered.status_code == 200, recovered.text
            verify_inventory(unavailable_user, [recovered.json()])

            rollback_key = str(uuid4())
            with patch.object(packs, "finish", side_effect=RuntimeError("CI interrupted before commit")):
                try:
                    claim(rollback_user, rollback_key)
                    raise AssertionError("Expected an interrupted inventory transaction")
                except RuntimeError as error:
                    assert str(error) == "CI interrupted before commit"
            with SessionLocal() as db:
                for model in (ArchiveOperation, ArchiveItem, ArchiveLedger):
                    assert db.scalar(select(func.count()).select_from(model).where(model.user_id == rollback_user)) == 0
            assert status(rollback_user)["available"]
            retried = claim(rollback_user, rollback_key)
            assert retried.status_code == 200, retried.text
            verify_inventory(rollback_user, [retried.json()])
        print("Daily PostgreSQL concurrency OK: same/different keys, exact free inventory, durable replay aliases over UTC midnight, unavailable pool, precommit rollback, no currency")
    finally:
        with SessionLocal() as db:
            if user_ids:
                db.execute(delete(User).where(User.id.in_(user_ids)))
            if pack_id:
                db.execute(delete(ArchivePack).where(ArchivePack.id == pack_id))
            if card_id:
                db.execute(delete(ArchiveCard).where(ArchiveCard.id == card_id))
            if paused_pack_ids:
                db.execute(update(ArchivePack).where(ArchivePack.id.in_(paused_pack_ids)).values(active=True))
            db.commit()


if __name__ == "__main__":
    main()
