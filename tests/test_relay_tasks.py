from dataclasses import replace
from datetime import datetime, timedelta

import test_player_community
import test_relay_protocol
from test_contract_relay import steam_player
from test_relay_protocol import API, OTHER, PROFILE, auth, friendship

from app import relay_protocol
from app.models import (
    BoardMatchCandidate,
    ContractBoard,
    Job,
    Match,
    MatchParticipant,
    User,
    utcnow,
)
from relay.manager import collector_tasks
from tests.test_gep_settlement_backend import create_board

community = test_player_community.community
relay_fixture = test_relay_protocol.relay


def connect(client):
    connection = client.put(PROFILE).json()["connection"]["id"]
    result = client.post(API + "/friendship-status", headers=auth(), json=friendship(connection, source="steam_session"))
    assert result.json()["collector_connections"] == [connection]
    return connection


def snapshot(client):
    response = client.get(API + "/tasks", headers=auth())
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    return response.json()


def enable_enrollment(monkeypatch):
    monkeypatch.setattr(relay_protocol, "settings", replace(relay_protocol.settings, relay_auto_enrollment_enabled=True))


def test_existing_friend_explicit_opt_in_and_queue_tracks_trusted_badges(relay_fixture, monkeypatch):
    factory, player = relay_fixture
    enable_enrollment(monkeypatch)
    ident, client = steam_player(factory, player, "Existing friend", 81276)
    assert client.get(API + "/tasks").status_code == 401
    assert client.get(API + "/tasks", headers=auth(OTHER)).status_code == 403
    assert client.get(API + "/participants", headers=auth(), params={"automatic": True}).json()["participants"] == []
    connection = connect(client)
    assert client.get(API + "/participants", headers=auth(), params={"automatic": True}).json()["participants"] == [
        {"connection_id": connection, "steam_id64": "76561197960347004"},
    ]
    assert snapshot(client)["tasks"] == []

    with factory() as db:
        user = db.get(User, ident)
        user.public_badges = ["CONTRIBUTOR", "streamer", "STREAMER"]
        board, _ = create_board(db, user)
        board_id = board.id
        db.commit()

    current = snapshot(client)
    assert current["protocol_version"] == current["schema_version"] == 1
    generated = datetime.fromisoformat(current["generated_at"])
    assert datetime.fromisoformat(current["expires_at"]) == generated + timedelta(minutes=2)
    assert len(current["tasks"]) == 1
    row = current["tasks"][0]
    assert row == {
        "steam_id64": "76561197960347004", "operation": "history", "match_id": None,
        "waiting_since": row["locked_at"], "locked_at": row["locked_at"], "baseline_match_id": None,
        "streamer": True, "game_mode": "STANDARD", "evidence": "none", "metadata_required": False,
    }

    with factory() as db:
        user = db.get(User, ident)
        user.access_role = "ADMIN"
        user.public_badges = ["CONTRIBUTOR"]
        db.commit()
    assert snapshot(client)["tasks"][0]["streamer"] is False

    with factory() as db:
        board = db.get(ContractBoard, board_id)
        board.attempts_used = board.max_attempts
        db.commit()
        assert snapshot(client)["tasks"] == []
        board.attempts_used = 0
        board.status = "SETTLED"
        db.commit()
    assert snapshot(client)["tasks"] == []


def test_only_owned_exact_match_without_stored_metadata_enters_metadata_lane(relay_fixture, monkeypatch):
    factory, player = relay_fixture
    enable_enrollment(monkeypatch)
    ident, client = steam_player(factory, player, "Metadata player", 28129)
    connect(client)
    with factory() as db:
        user = db.get(User, ident)
        board, option = create_board(db, user, status="VERIFYING", option_status="VERIFYING", attempts_used=1)
        match = Match(
            external_match_id=502123, provider="deadlock_api", mode_classifier_version="test",
            integrity_status="SERVER_VERIFIED", game_match_mode="STANDARD",
            started_at=utcnow() - timedelta(seconds=7), is_final=True, duration_s=1700,
        )
        db.add(match)
        db.flush()
        option.bound_match_id = match.id
        db.add(Job(type="evaluate_match", board_id=board.id, match_id=match.id, idempotency_key="retry-example"))
        db.add(BoardMatchCandidate(
            board_id=board.id, match_id=match.id, status="BOUND", attempt_no=1,
            capture_source="PROVIDER_HISTORY", bound_at=utcnow(),
        ))
        db.commit()
        assert snapshot(client)["tasks"] == []

        db.add(MatchParticipant(match_id=match.id, account_id=user.account_id))
        db.commit()
        task, = snapshot(client)["tasks"]
        assert task["match_id"] == 502123
        assert task["operation"] == "metadata" and task["metadata_required"] is True
        assert task["evidence"] == "stored_history"

        match.relay_provider_metadata_observed_at = utcnow()
        db.commit()
        assert snapshot(client)["tasks"] == []


def test_unconfirmed_stale_and_withdrawn_friendship_do_not_publish_tasks(relay_fixture, monkeypatch):
    factory, player = relay_fixture
    enable_enrollment(monkeypatch)
    ident, client = steam_player(factory, player, "Pending", 32768)
    client.put(PROFILE)
    with factory() as db:
        create_board(db, db.get(User, ident))
    assert snapshot(client)["tasks"] == []
    connect(client)
    assert snapshot(client)["tasks"]
    now = utcnow()
    with monkeypatch.context() as m:
        m.setattr(relay_protocol, "utcnow", lambda: now + timedelta(minutes=6))
        assert snapshot(client)["tasks"] == []
    assert client.delete(PROFILE).status_code == 200
    assert snapshot(client)["tasks"] == []


def test_history_preserves_separate_modes_and_excludes_a_consumed_match(relay_fixture, monkeypatch):
    factory, player = relay_fixture
    enable_enrollment(monkeypatch)
    ident, client = steam_player(factory, player, "Mixed modes", 18729)
    connect(client)
    now = utcnow()
    with factory() as db:
        user = db.get(User, ident)
        brawl, _ = create_board(db, user, attempts_used=1)
        brawl.game_match_mode = "STREET_BRAWL"
        brawl.expires_at = now + timedelta(seconds=45)
        db.commit()
        ranked, _ = create_board(db, user, attempts_used=1)
        ranked.game_match_mode = "RANKED"
        ranked.baseline_match_id = 501976
        match = Match(external_match_id=502001, provider="deadlock_api", mode_classifier_version="test")
        db.add(match)
        db.flush()
        db.add(BoardMatchCandidate(
            board_id=ranked.id, match_id=match.id, status="BOUND", attempt_no=1,
            capture_source="PROVIDER_HISTORY", bound_at=now,
        ))
        db.commit()

    document = snapshot(client)
    assert datetime.fromisoformat(document["expires_at"]) == now + timedelta(seconds=45)
    collector_queue = collector_tasks(document, {18729}, utcnow())
    assert {row["game_mode"]: row["baseline_match_id"] for row in collector_queue["tasks"]} == {
        "STREET_BRAWL": None, "RANKED": 502001,
    }
