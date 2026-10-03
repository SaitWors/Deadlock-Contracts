from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import AuditLog, HeroVoteCampaign, HeroVoteSnapshot, HeroVoteSource, SessionToken, User, utcnow
from app.services import hero_votes as polls
from app.services.auth import COOKIE_NAME, hash_token

COUNTS = {"78": 498, "84": 1219, "85": 793, "86": 425, "87": 364, "88": 685}


@pytest.fixture()
def factory():
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture()
def api(factory):
    def override():
        with factory() as db:
            yield db
    before = settings.admin_steam_ids
    object.__setattr__(settings, "admin_steam_ids", ("76561198083722456",))
    app.dependency_overrides[get_db] = override
    try:
        with TestClient(app) as client:
            client.post("/api/auth/demo")
            with factory() as db:
                token = db.get(SessionToken, hash_token(client.cookies.get(COOKIE_NAME)))
                token.admin_verified_at = utcnow()
                db.commit()
            yield client, {"X-CSRF-Token": client.get("/api/me").json()["csrf_token"]}
    finally:
        app.dependency_overrides.pop(get_db, None)
        object.__setattr__(settings, "admin_steam_ids", before)


def payload(**changes):
    return {"title_ru": "Город не спит", "title_en": "The City Never Sleeps",
        "candidates": deepcopy(polls.PRESET), "providers": list(polls.PROVIDERS), **changes}


def seed(factory):
    with factory() as db:
        item = HeroVoteCampaign(title_ru="Город не спит", title_en="The City Never Sleeps", candidates=deepcopy(polls.PRESET),
            active_slot="CURRENT", visible=True)
        db.add(item); db.flush()
        for provider in polls.PROVIDERS:
            db.add(HeroVoteSource(campaign_id=item.id, provider=provider))
        db.commit()
        return item.id


def transport(request):
    assert request.method == "GET"
    assert not request.headers.get("cookie")
    assert not request.headers.get("authorization")
    if request.url.host == "statlocker.gg":
        return httpx.Response(401)
    assert str(request.url) == polls.PROVIDERS["deadlock_labs"]["endpoint"]
    return httpx.Response(200, json={"counts": COUNTS, "myVote": None})


def test_leader_excludes_released_hero_but_percent_keeps_source_denominator():
    result = polls.standings(COUNTS, polls.PRESET)
    assert result["total_votes"] == 3984
    assert result["leader_ids"] == [85]  # Rat King has more votes but is already released.
    assert result["gap_votes"] == 108
    assert result["gap_percent"] == 2.71
    assert result["rows"][0]["percent"] == 19.9
    assert result["rows"][-1]["hero_id"] == 84


def test_ties_empty_poll_and_single_remaining_hero_are_not_invented_leaders():
    counts = {**COUNTS, "88": COUNTS["85"]}
    result = polls.standings(counts, polls.PRESET)
    assert set(result["leader_ids"]) == {85, 88}
    assert result["gap_votes"] == result["gap_percent"] == 0
    empty = polls.standings(dict.fromkeys(COUNTS, 0), polls.PRESET)
    assert empty["leader_ids"] == []
    assert empty["gap_votes"] is None
    released_only = polls.standings({**dict.fromkeys(COUNTS, 0), "84": 100}, polls.PRESET)
    assert released_only["leader_ids"] == [] and released_only["gap_votes"] is None
    one = deepcopy(polls.PRESET)
    for item in one:
        item["released"] = item["hero_id"] != 85
    assert polls.standings(COUNTS, one)["gap_votes"] is None


@pytest.mark.parametrize("bad", [None, {}, {"counts": []}, {"counts": {"85": 1}},
    {"counts": {**COUNTS, "99": 3}}, {"counts": {**COUNTS, "85": -1}},
    {"counts": {**COUNTS, "85": True}}, {"counts": {**COUNTS, "85": "793"}},
    {"counts": {**COUNTS, "85": 10**13}}, {"counts": {**COUNTS, "85": 1.5}}])
def test_parser_rejects_wrong_poll_or_invalid_counters(bad):
    with pytest.raises(ValueError):
        polls.parse_labs(bad, polls.PRESET)


def test_worker_caches_read_only_sources_rate_limits_and_preserves_data_after_outage(factory):
    seed(factory)
    now = utcnow()
    requests = []
    def handler(request):
        requests.append(str(request.url))
        return transport(request)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert polls.maintenance(factory, client=client, now=now) == 2
        assert polls.maintenance(factory, client=client, now=now + timedelta(minutes=9)) == 0
    assert len(requests) == 2
    with factory() as db:
        data = polls.public_payload(db)
        labs, statlocker = data["campaign"]["sources"]
        assert labs["result"]["leader_ids"] == [85]
        assert not labs["stale"]
        assert statlocker["kind"] == "RELEASE_PREDICTIONS"
        assert statlocker["status"] == "AUTH_REQUIRED" and statlocker["result"] is None
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503))) as client:
        assert polls.maintenance(factory, client=client, now=now + timedelta(minutes=11)) == 2
    with factory() as db:
        labs = polls.public_payload(db)["campaign"]["sources"][0]
        assert labs["stale"] and labs["status"] == "UNAVAILABLE"
        assert labs["result"]["total_votes"] == sum(COUNTS.values())
        assert db.scalar(select(func.count()).select_from(HeroVoteSnapshot)) == 1


def test_no_fetch_per_public_read_and_hide_or_schedule_stops_worker(factory):
    campaign_id = seed(factory)
    with factory() as db:
        item = db.get(HeroVoteCampaign, campaign_id)
        item.starts_at = utcnow() + timedelta(hours=1)
        db.commit()
        assert polls.public_payload(db)["campaign"] is None
    with httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("Hidden poll fetched"))) as client:
        assert polls.maintenance(factory, client=client) == 0
    with factory() as db:
        item = db.get(HeroVoteCampaign, campaign_id)
        item.starts_at, item.visible = None, False
        db.commit()
        for _ in range(10):
            assert not polls.public_payload(db)["enabled"]
    with httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("Hidden poll fetched"))) as client:
        assert polls.maintenance(factory, client=client) == 0


def test_changed_leader_decreasing_votes_and_gap_delta(factory):
    seed(factory)
    now = utcnow()
    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        polls.maintenance(factory, client=client, now=now)
    counts = {**COUNTS, "85": 400, "88": 750}
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"counts": counts}))) as client:
        polls.maintenance(factory, client=client, now=now + timedelta(minutes=10))
    with factory() as db:
        labs = polls.public_payload(db)["campaign"]["sources"][0]
        assert labs["result"]["leader_ids"] == [88]
        assert labs["change"]["leader_changed"]
        assert labs["change"]["previous_leader_ids"] == [85]
        assert labs["change"]["votes_delta"] == -328  # Unvoting is legitimate.
        assert labs["change"]["gap_delta"] == 144


def test_worker_lease_prevents_duplicate_fetch_and_discards_edits_during_fetch(factory):
    campaign_id = seed(factory)
    now = utcnow()
    calls = []
    def handler(request):
        calls.append(str(request.url))
        if request.url.host == "deadlocklabs.gg":
            with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(401))) as other:
                assert polls.maintenance(factory, client=other, now=now) == 1  # Only the other provider is due.
            with factory() as db:
                item = db.get(HeroVoteCampaign, campaign_id)
                item.visible = False
                item.revision += 1
                db.commit()
        return transport(request)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        polls.maintenance(factory, client=client, now=now)
    assert len(calls) == 1
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(HeroVoteSnapshot)) == 0


@pytest.mark.parametrize("response", [httpx.Response(302, headers={"Location": "http://127.0.0.1/"}),
    httpx.Response(200, content=b"x" * 65537), httpx.Response(200, json={"counts": {"85": 100}})])
def test_fetch_rejects_redirects_large_body_and_different_candidate_mapping(response):
    with httpx.Client(transport=httpx.MockTransport(lambda r: response), follow_redirects=False) as client:
        status, counts = polls.fetch_counts("deadlock_labs", polls.PRESET, client)
    assert status in {"UNAVAILABLE", "INVALID_DATA"} and counts is None


def test_api_campaign_lifecycle_revision_csrf_totp_and_separate_history(api, factory):
    client, csrf = api
    assert not client.get("/api/public/hero-votes").json()["enabled"]
    assert client.post("/api/admin/hero-votes", json=payload()).status_code == 403
    first = client.post("/api/admin/hero-votes", json=payload(), headers=csrf).json()["item"]
    assert first["revision"] == 1 and not first["visible"]
    def act(item, action):
        response = client.post(f"/api/admin/hero-votes/{item['id']}/actions", headers=csrf,
            json={"expected_revision": item["revision"], "action": action})
        assert response.status_code == 200, response.text
        return response.json()["item"]
    first = act(first, "ACTIVATE")
    assert client.get("/api/public/hero-votes").json()["campaign"]["id"] == first["id"]
    with httpx.Client(transport=httpx.MockTransport(transport)) as source:
        polls.maintenance(factory, client=source)
    first = act(first, "HIDE")
    assert client.get("/api/public/hero-votes").json()["campaign"] is None
    first = act(first, "ACTIVATE")
    stale = client.patch(f"/api/admin/hero-votes/{first['id']}", json={**payload(), "expected_revision": 1}, headers=csrf)
    assert stale.status_code == 409
    different = payload()
    different["candidates"][0]["hero_id"] = 999
    assert client.patch(f"/api/admin/hero-votes/{first['id']}", headers=csrf,
        json={**different, "expected_revision": first["revision"]}).status_code == 409
    second = client.post("/api/admin/hero-votes", json=payload(title_ru="Новая кампания"), headers=csrf).json()["item"]
    second = act(second, "ACTIVATE")
    listing = client.get("/api/admin/hero-votes").json()["items"]
    old = next(item for item in listing if item["id"] == first["id"])
    assert not old["active"] and not old["visible"] and old["sources"][0]["result"]["total_votes"] == 3984
    assert client.get("/api/public/hero-votes").json()["campaign"]["sources"][0]["result"] is None
    second = act(second, "END")
    assert second["ended_at"] and not client.get("/api/public/hero-votes").json()["enabled"]
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.entity_type == "hero_vote_campaign")) == 7
        session = db.get(SessionToken, hash_token(client.cookies.get(COOKIE_NAME)))
        session.admin_verified_at = None
        db.commit()
    assert client.get("/api/admin/hero-votes").status_code == 403


def test_admin_can_manage_but_moderator_and_player_cannot(api, factory):
    client, csrf = api
    me = client.get("/api/me").json()
    object.__setattr__(settings, "admin_steam_ids", ())
    for role in ("ADMIN", "MODERATOR", "PLAYER"):
        with factory() as db:
            user = db.get(User, me["user"]["id"]); user.access_role = role; db.commit()
        assert client.get("/api/admin/hero-votes").status_code == (200 if role == "ADMIN" else 403)
        assert client.post("/api/admin/hero-votes", json=payload(), headers=csrf).status_code == (200 if role == "ADMIN" else 403)


@pytest.mark.parametrize("changes", [{"providers": ["http://localhost"]}, {"providers": ["deadlock_labs", "deadlock_labs"]},
    {"endpoint": "http://127.0.0.1"}, {"starts_at": "2026-10-10T12:00:00"},
    {"starts_at": "2026-10-10T12:00:00Z", "ends_at": "2026-10-09T12:00:00Z"},
    {"candidates": [polls.PRESET[0], polls.PRESET[0]]}, {"candidates": [{**polls.PRESET[0], "hero_id": True}, polls.PRESET[1]]},
    {"candidates": [{**hero, "released": True} for hero in polls.PRESET]}])
def test_admin_input_is_strict_and_bounded(api, changes):
    client, csrf = api
    assert client.post("/api/admin/hero-votes", json=payload(**changes), headers=csrf).status_code == 422


def test_expired_campaign_hides_without_a_worker_and_refresh_cannot_bypass_interval(api, factory):
    client, csrf = api
    campaign_id = seed(factory)
    with httpx.Client(transport=httpx.MockTransport(transport)) as source:
        polls.maintenance(factory, client=source)
    assert client.post(f"/api/admin/hero-votes/{campaign_id}/actions", headers=csrf,
        json={"expected_revision": 1, "action": "REFRESH"}).status_code == 429
    with factory() as db:
        item = db.get(HeroVoteCampaign, campaign_id)
        assert item.revision == 1  # Failed action rolled back the revision claim.
        item.ends_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/public/hero-votes").json()["campaign"] is None


def test_additive_migration_matches_orm_and_preserves_existing_accounts():
    engine = create_engine("sqlite+pysqlite://")
    new_tables = {"hero_vote_campaigns", "hero_vote_sources", "hero_vote_snapshots"}
    Base.metadata.create_all(engine, tables=[table for table in Base.metadata.sorted_tables if table.name not in new_tables])
    spec = spec_from_file_location("hero_vote_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0020_hero_votes.py")
    revision = module_from_spec(spec)
    spec.loader.exec_module(revision)
    with engine.begin() as connection:
        connection.execute(User.__table__.insert().values(id="preserved-player", display_name="Preserved player"))
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            revision.upgrade()
            assert compare_metadata(context, Base.metadata) == []
            revision.downgrade()
            assert connection.scalar(select(User.display_name)) == "Preserved player"
            revision.upgrade()
            assert compare_metadata(context, Base.metadata) == []
    engine.dispose()
