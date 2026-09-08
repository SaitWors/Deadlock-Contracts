"""Exercise the real API against PostgreSQL row locks, with two browser sessions."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.db import SessionLocal, engine
from app.main import app
from app.models import ArchiveCipher, ArchiveLedger, SessionToken, User, utcnow
from app.services.auth import COOKIE_NAME, csrf_token, hash_token


def main():
    assert engine.dialect.name == "postgresql"
    token = uuid4().hex
    with SessionLocal() as db:
        user = User(display_name="Archive concurrency smoke")
        db.add(user); db.flush(); user_id = user.id
        db.add(SessionToken(token_hash=hash_token(token), user_id=user_id, expires_at=utcnow() + timedelta(minutes=5)))
        db.commit()
    try:
        def race(path, body=None):
            barrier = Barrier(2)
            def call(_):
                client = TestClient(app)
                client.cookies.set(COOKIE_NAME, token)
                client.headers["X-CSRF-Token"] = csrf_token(token)
                try:
                    barrier.wait(timeout=10)
                    response = client.post(path, json=body) if body else client.post(path)
                    assert response.status_code == 200, response.text
                    return response.json()["round"]
                finally:
                    client.close()
            with ThreadPoolExecutor(max_workers=2) as pool:
                return list(pool.map(call, range(2)))
        rounds = race("/api/archive/cipher")
        assert rounds[0]["id"] == rounds[1]["id"]
        with SessionLocal() as db:
            row = db.get(ArchiveCipher, rounds[0]["id"])
            solution = row.solution
        solved = race(f"/api/archive/cipher/{rounds[0]['id']}/guess", {"revision": 1, "symbols": solution})
        assert all(row["status"] == "SOLVED" for row in solved)
        with SessionLocal() as db:
            assert db.scalar(select(func.count()).select_from(ArchiveCipher).where(ArchiveCipher.user_id == user_id)) == 1
            assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == user_id)) == 1
            assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id)) == 30
        print("Archive concurrency OK: one round, one reward under duplicate concurrent requests")
    finally:
        with SessionLocal() as db:
            db.execute(delete(User).where(User.id == user_id)); db.commit()


if __name__ == "__main__":
    main()
