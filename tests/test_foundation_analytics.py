from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import Response
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.foundation_analytics_models import FoundationAnalyticsEvent
from app.main import app
from app.models import ArchiveOperation, BoardOption, ContractBoard, MissionDefinition, SessionToken, User, utcnow
from app.services.auth import COOKIE_NAME, create_session, csrf_token, hash_token
from app.services.foundation_analytics import foundation_metrics, last_foundation_activity, purge_expired_events

EVENTS = "/api/foundation/events"
METRICS = "/api/admin/foundation-analytics"


def make_factory():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def sign_in(client, factory, role):
    with factory() as db:
        user = User(steam_id64=76561198083722500, access_role=role)
        db.add(user)
        db.flush()
        response = Response()
        create_session(db, user, response)
        cookie = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
        client.cookies.set(COOKIE_NAME, cookie)
        return user.id, {"X-CSRF-Token": csrf_token(cookie)}, cookie


def test_browser_events_enforce_identity_csrf_allowlist_size_and_deduplication():
    factory = make_factory()

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    try:
        client = TestClient(app)
        payload = {"event_id": str(uuid4()), "name": "session_started"}
        assert client.get(METRICS).status_code == 401
        assert client.post(EVENTS, json=payload).status_code == 403
        user_id, headers, cookie = sign_in(client, factory, "PLAYER")
        assert client.post(EVENTS, json=payload).status_code == 403
        assert client.get(METRICS).status_code == 403
        assert client.post(EVENTS, json={**payload, "name": "case_completed"}, headers=headers).status_code == 422
        assert client.post(EVENTS, json={**payload, "user_id": str(uuid4())}, headers=headers).status_code == 422
        assert client.post(EVENTS, content=b" " * 2049, headers=headers).status_code == 413
        assert client.post(EVENTS, json=payload, headers=headers).status_code == 204
        assert client.post(EVENTS, json=payload, headers=headers).status_code == 204
        completed = {"event_id": str(uuid4()), "name": "onboarding_completed"}
        assert client.post(EVENTS, json=completed, headers=headers).status_code == 409
        with factory() as db:
            events = list(db.scalars(select(FoundationAnalyticsEvent)))
            assert [(event.user_id, event.name) for event in events] == [(user_id, "session_started")]

        def onboarding(name):
            return client.post(EVENTS, json={"event_id": str(uuid4()), "name": name}, headers=headers)

        assert onboarding("onboarding_skipped").status_code == 204
        assert onboarding("onboarding_started").status_code == 204
        assert onboarding("onboarding_started").status_code == 204
        assert onboarding("onboarding_completed").status_code == 409
        with factory() as db:
            now = utcnow()
            db.add(ContractBoard(user_id=user_id, board_date=now.date(), seed="signed", expires_at=now, locked_at=now,
                                 status="SETTLED", completion_result={"ready": True}))
            db.add(ArchiveOperation(user_id=user_id, request_key=str(uuid4()), signature="fixture", benefit_key="daily",
                                    kind="DAILY_PACK", scope="REAL", created_at=now, result={"items": [1]}))
            db.commit()
        assert onboarding("onboarding_completed").status_code == 204
        assert onboarding("onboarding_completed").status_code == 204
        with factory() as db:
            assert db.scalar(select(func.count()).select_from(FoundationAnalyticsEvent)) == 4
            user = db.get(User, user_id)
            user.access_role = "ADMIN"
            db.commit()
        assert client.get(METRICS).status_code == 403
        with factory() as db:
            db.get(SessionToken, hash_token(cookie)).admin_verified_at = utcnow()
            db.commit()
        response = client.get(METRICS)
        assert response.status_code == 200
        assert "no-store" in response.headers["Cache-Control"]
        assert user_id not in response.text
        for _ in range(36):
            limited = client.post(EVENTS, json=payload, headers=headers)
            if limited.status_code == 429:
                break
        assert limited.status_code == 429
        assert int(limited.headers["Retry-After"]) > 0
        payload = {"confirmation": "DELETE"}
        assert client.post("/api/account/delete", json=payload, headers=headers).status_code == 200
        with factory() as db:
            assert db.scalar(select(func.count()).select_from(FoundationAnalyticsEvent)) == 0
    finally:
        app.dependency_overrides.pop(get_db, None)
        factory.kw["bind"].dispose()


def test_utc_windows_and_mature_cohorts_use_authoritative_facts_and_exclude_automatic_settlement():
    factory = make_factory()
    now = datetime(2026, 11, 28, 15, tzinfo=timezone.utc)
    today = now.replace(hour=0)
    with factory() as db:
        mature = User(steam_id64=76561198083722501, created_at=today - timedelta(days=35))
        new = User(steam_id64=76561198083722502, created_at=today - timedelta(days=1))
        late = User(steam_id64=76561198083722503, created_at=today - timedelta(days=20))
        db.add_all([mature, new, late])
        db.flush()

        def event(user, at, name="session_started"):
            db.add(FoundationAnalyticsEvent(user_id=user.id, event_id=str(uuid4()), name=name, occurred_at=at))

        event(mature, today - timedelta(days=62))  # Establish a complete observation history.
        event(mature, mature.created_at)
        event(mature, mature.created_at + timedelta(days=1))
        event(mature, mature.created_at + timedelta(days=7))
        event(mature, mature.created_at + timedelta(days=30))
        event(mature, mature.created_at, "onboarding_started")
        event(mature, mature.created_at + timedelta(days=2), "onboarding_completed")
        event(late, late.created_at)
        event(new, new.created_at)
        event(new, today + timedelta(minutes=15), "contract_selected")  # Current day excluded.

        first_at = mature.created_at + timedelta(hours=2)
        first = ContractBoard(user_id=mature.id, board_date=first_at.date(), seed="first",
                              expires_at=today, locked_at=first_at, status="SETTLED", completion_result={"ready": True})
        second_at = first_at + timedelta(days=2)
        second = ContractBoard(user_id=mature.id, board_date=second_at.date(), seed="second",
                               expires_at=today, locked_at=second_at, status="SETTLED", completion_result={"ready": True})
        mission = MissionDefinition(key="analytics-fixture", title="Fixture", description="Fixture",
                                    metric="kills", operator="GTE", target=1, reward_xp=10)
        db.add_all([first, second, mission])
        db.flush()
        for board, settled_at in ((first, first_at + timedelta(hours=1)), (second, today - timedelta(days=1))):
            db.add(BoardOption(board_id=board.id, mission_definition_id=mission.id, rendered_title="Fixture",
                               rendered_description="Fixture", metric="kills", operator="GTE", target=1,
                               reward_xp=10, selected=True, status="COMPLETED", settled_at=settled_at))
        claim_at = today - timedelta(days=2, hours=-1)
        event(late, claim_at - timedelta(minutes=2))
        for kind in ("DAILY_PACK", "DAILY_PACK_REPLAY"):
            db.add(ArchiveOperation(user_id=late.id, request_key=str(uuid4()), signature="fixture",
                                    kind=kind, scope="REAL", created_at=claim_at, result={"items": [1]},
                                    benefit_key="today" if kind == "DAILY_PACK" else None))
        db.commit()

        result = foundation_metrics(db, now)
        assert result["activity"] == {"dau": 1, "wau": 3, "mau": 3}
        assert foundation_metrics(db, now.astimezone(timezone(timedelta(hours=10)))) == result
        assert result["retention"]["d30"] == {"players": 1, "eligible": 1}
        assert result["retention"]["d7"] == {"players": 1, "eligible": 2}
        assert result["first_contract"] == {"players": 1, "eligible": 2}
        assert result["first_completion"] == {"players": 1, "eligible": 2}
        assert result["second_contract"] == {"players": 1, "eligible": 1}
        assert result["median_first_contract_seconds"] == 7200
        assert result["onboarding_completion"] == {"players": 1, "eligible": 1}
        assert result["pack_only_sessions"]["sessions"] == 1
    factory.kw["bind"].dispose()


def test_missing_history_starts_after_first_partial_utc_day_and_details_expire():
    factory = make_factory()
    now = datetime(2026, 11, 28, 15, tzinfo=timezone.utc)
    with factory() as db:
        player = User(steam_id64=76561198083722505)
        db.add(player)
        db.flush()
        db.add(FoundationAnalyticsEvent(user_id=player.id, event_id=str(uuid4()), name="session_started", occurred_at=now))
        db.commit()
        assert last_foundation_activity(db, player.id, now) is None
        assert last_foundation_activity(db, player.id, now + timedelta(seconds=1)) == now
        metrics = foundation_metrics(db, now)
        assert metrics["activity"] == {"dau": None, "wau": None, "mau": None}
        assert metrics["retention"]["d30"] == {"players": 0, "eligible": 0}

        db.add(FoundationAnalyticsEvent(user_id=player.id, event_id=str(uuid4()), name="session_started",
                                        occurred_at=now - timedelta(days=91)))
        db.commit()
        purge_expired_events(db, now)
        db.commit()
        assert db.scalar(select(func.count()).select_from(FoundationAnalyticsEvent)) == 1
    factory.kw["bind"].dispose()
