"""Verify retired archive HTTP routes cannot create currency or inventory on PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.db import SessionLocal, engine
from app.main import app
from app.models import (
    ArchiveCipher,
    ArchiveItem,
    ArchiveLedger,
    ArchiveOperation,
    SessionToken,
    User,
    utcnow,
)
from app.services.auth import COOKIE_NAME, csrf_token, hash_token


def main():
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Archive retirement checks require the migrated PostgreSQL database")
    token = uuid4().hex
    with SessionLocal() as db:
        user = User(display_name="Archive retirement smoke")
        db.add(user)
        db.flush()
        user_id = user.id
        db.add(SessionToken(token_hash=hash_token(token), user_id=user_id, expires_at=utcnow() + timedelta(minutes=10)))
        db.commit()
    try:
        identifier = str(uuid4())
        mutations = [
            ("/api/archive/cipher", {}),
            (f"/api/archive/cipher/{identifier}/guess", {"revision": 1, "symbols": [0, 1, 2, 3]}),
            (f"/api/archive/cards/{identifier}/acquire", {"request_key": str(uuid4()), "expected_price": 25}),
            (f"/api/archive/items/{identifier}/recycle", {"request_key": str(uuid4())}),
            (f"/api/archive/packs/{identifier}/open", {"request_key": str(uuid4()), "revision": 1}),
            ("/api/arena/starter", {"request_key": str(uuid4()), "scope": "REAL"}),
        ]

        def race(path, body):
            barrier = Barrier(2)

            def call(_):
                client = TestClient(app)
                client.cookies.set(COOKIE_NAME, token)
                client.headers["X-CSRF-Token"] = csrf_token(token)
                try:
                    barrier.wait(timeout=15)
                    response = client.post(path, json=body)
                    assert response.status_code == 410, (path, response.status_code, response.text)
                finally:
                    client.close()

            with ThreadPoolExecutor(max_workers=2) as workers:
                list(workers.map(call, range(2)))

        for path, body in mutations:
            race(path, body)
        client = TestClient(app)
        try:
            client.cookies.set(COOKIE_NAME, token)
            for path in ("/api/archive/wallet", "/api/archive/coin-rewards", "/api/archive/cards", "/api/arena/bootstrap"):
                response = client.get(path)
                assert response.status_code == 410, (path, response.text)
            assert client.post("/api/archive/cipher", json={}).status_code == 403
            assert client.get("/api/archive/inventory").status_code == 200
            assert client.get("/api/archive/favorites").status_code == 200
        finally:
            client.close()
        with SessionLocal() as db:
            for model in (ArchiveCipher, ArchiveItem, ArchiveLedger, ArchiveOperation):
                assert db.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) == 0
        print("Archive retirement OK: concurrent HTTP mutations return 410; auth/CSRF and collection reads remain; no new currency or inventory")
    finally:
        with SessionLocal() as db:
            db.execute(delete(User).where(User.id == user_id))
            db.commit()


if __name__ == "__main__":
    main()
