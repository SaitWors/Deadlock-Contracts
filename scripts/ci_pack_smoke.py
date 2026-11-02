"""Retain historical private pack accounting races while public paid openings stay retired."""
import hashlib
import io
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import delete, func, select

from app.archive_packs import OpenPack
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
    assert engine.dialect.name == "postgresql"
    token = uuid4().hex
    image = io.BytesIO()
    Image.new("RGB", (240, 360), "#394b65").save(image, format="WEBP")
    artwork = image.getvalue()
    with SessionLocal() as db:
        user = User(display_name="Pack concurrency smoke")
        card = ArchiveCard(hero="abrams", rank="F", title="PG smoke card", status="PUBLISHED",
                           image_data=artwork, image_digest=hashlib.sha256(artwork).hexdigest())
        pack = ArchivePack(active=True, starter=True)
        db.add_all([user, card, pack]); db.flush()
        user_id, card_id, pack_id = user.id, card.id, pack.id
        db.add(ArchivePackVersion(pack_id=pack_id, revision=1, config={"title": "Smoke envelope", "description": "",
               "price": 50, "draws": 2, "entries": [{"card_id": card_id, "rank": "F", "weight": 1}], "price_model": 1}))
        db.add(ArchiveLedger(user_id=user_id, source="smoke", reason="TEST", delta=100))
        db.add(SessionToken(token_hash=hash_token(token), user_id=user_id, expires_at=utcnow() + timedelta(minutes=10)))
        db.commit()
    try:
        client = TestClient(app)
        try:
            client.cookies.set(COOKIE_NAME, token)
            client.headers["X-CSRF-Token"] = csrf_token(token)
            response = client.post(f"/api/archive/packs/{pack_id}/open", json={"request_key": str(uuid4()), "revision": 1})
            assert response.status_code == 410, response.text
        finally:
            client.close()
        # This is explicit historical service coverage; no public HTTP endpoint
        # can execute these legacy accounting operations.
        def race(keys, starter=False):
            barrier = Barrier(2)
            def call(key):
                with SessionLocal() as db:
                    barrier.wait(timeout=15)
                    try:
                        receipt = packs.open_pack(db, user_id, pack_id,
                            OpenPack(request_key=key, revision=1, starter=starter))
                        return 200, receipt
                    except HTTPException as error:
                        db.rollback()
                        return error.status_code, {"detail": error.detail}
            with ThreadPoolExecutor(max_workers=2) as pool:
                return list(pool.map(call, keys))
        key = str(uuid4())
        duplicated = race([key, key])
        assert all(code == 200 for code, _ in duplicated), duplicated
        assert duplicated[0][1] == duplicated[1][1]
        competing = race([str(uuid4()), str(uuid4())])
        assert sorted(code for code, _ in competing) == [200, 409], competing
        starters = race([str(uuid4()), str(uuid4())], starter=True)
        assert sorted(code for code, _ in starters) == [200, 409], starters
        with SessionLocal() as db:
            assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id)) == 0
            assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id)) == 6
            assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == user_id)) == 3
            assert db.scalar(select(func.sum(ArchiveItem.cost_basis)).where(ArchiveItem.user_id == user_id)) == 100
        print("Historical pack accounting OK: public HTTP is retired; private retries, no overspend, one legacy starter, exact cost allocation")
    finally:
        with SessionLocal() as db:
            db.execute(delete(User).where(User.id == user_id))
            db.execute(delete(ArchivePack).where(ArchivePack.id == pack_id))
            db.execute(delete(ArchiveCard).where(ArchiveCard.id == card_id))
            db.commit()


if __name__ == "__main__":
    main()
