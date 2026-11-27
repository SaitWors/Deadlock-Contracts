import base64
import json
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from io import BytesIO, StringIO
import sys
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app import relay_credentials, relay_protocol
from app.models import AuditLog, ContractRelayConnection, User, utcnow
from app.relay_credentials import install_credential
from app.relay_models import RelayFriendship, RelayHeartbeat, RelayNode
from app.services import relay_state
from relay import manager, protocol, steam_friends
from test_archive_packs import owner
from test_bureau_operations import elevate
from test_contract_relay import steam_player
from test_player_community import community


API = "/api/internal/relay/v1"
ADMIN = "/api/admin/contract-relay"
PROFILE = "/api/profile/contract-relay"
TOKEN = "mcg." + "a" * 43
OTHER = "observer." + "b" * 43


def auth(token=TOKEN):
    return {"Authorization": "Bearer " + token}


def digest(token):
    return sha256(token.encode()).hexdigest()


def payload(when=None, **values):
    return {
        "protocol_version": 1, "agent_version": "1.0.0",
        "observed_at": (when or utcnow()).isoformat(),
        "ingest": {"container_status": "exited", "gc_logs": "recent"},
        "events": ["host_snapshot_unavailable"], **values,
    }


def friendship(connection_id, state="connected", when=None, **values):
    return {
        "protocol_version": 1,
        "observations": [{
            "connection_id": str(connection_id), "state": state, "source": "manual",
            "observed_at": (when or utcnow()).isoformat(), **values,
        }],
    }


@pytest.fixture()
def relay(community, monkeypatch):
    factory, player = community
    settings = replace(relay_protocol.settings, relay_enabled=True)
    monkeypatch.setattr(relay_protocol, "settings", settings)
    monkeypatch.setattr(relay_state, "settings", settings)
    with factory() as db:
        first = install_credential(db, "mcg", digest(TOKEN), friendship_writes=True)
        second = install_credential(db, "observer", digest(OTHER))
        assert not first.enabled and not second.enabled
        first.enabled = second.enabled = True
        db.commit()
    return factory, player


def test_machine_only_permissions_rotation_revocation_and_private_logging(relay, owner, caplog):
    caplog.set_level("INFO", logger="app.relay_protocol")
    factory, player = relay
    _, user = player()
    admin_id, admin = player()
    elevate(factory, admin_id, admin, role="ADMIN")
    _, owner_client = owner
    route = API + "/heartbeat"
    assert user.post(route, json=payload()).status_code == 401
    assert user.post(route, headers=auth(TOKEN[:-1] + "Z"), json=payload()).status_code == 401
    assert user.post(route, headers=auth("impostor." + "a" * 43), json=payload()).status_code == 401
    assert user.post(route, headers=auth(), json=payload(node_id="observer")).status_code == 422
    assert user.get(ADMIN, headers=auth()).status_code == 403
    assert user.get(API + "/participants", headers=auth(OTHER)).status_code == 403
    assert user.post(API + "/friendship-status", headers=auth(OTHER), json=friendship(uuid4())).status_code == 403
    assert user.post(route, headers=auth(OTHER), json=payload()).json()["applied"] == 1
    assert admin.post(ADMIN + "/nodes/mcg", json={"action": "revoke"}).status_code == 403
    assert "token_hash" not in admin.get(ADMIN).text

    csrf = owner_client.headers.pop("X-CSRF-Token")
    assert owner_client.post(ADMIN + "/nodes/mcg", json={"action": "disable"}).status_code == 403
    owner_client.headers["X-CSRF-Token"] = csrf
    assert owner_client.post(ADMIN + "/nodes/mcg", json={"action": "disable"}).status_code == 200
    assert user.post(route, headers=auth(), json=payload()).status_code == 401
    assert owner_client.post(ADMIN + "/nodes/mcg", json={"action": "enable"}).status_code == 200
    assert user.post(route, headers=auth(), json=payload()).status_code == 200

    assert owner_client.post(ADMIN + "/nodes/mcg", json={"action": "revoke"}).status_code == 200
    assert owner_client.post(ADMIN + "/nodes/mcg", json={"action": "enable"}).status_code == 409
    assert user.post(route, headers=auth(), json=payload()).status_code == 401
    rotated = "mcg." + "c" * 43
    with factory() as db:
        node = install_credential(db, "mcg", digest(rotated), friendship_writes=True)
        assert not node.enabled
        assert db.scalar(select(AuditLog).where(AuditLog.action == "relay.credential_rotate"))
    assert owner_client.post(ADMIN + "/nodes/mcg", json={"action": "enable"}).status_code == 200
    assert user.post(route, headers=auth(rotated), json=payload()).status_code == 200
    assert user.post(route, headers=auth(), json=payload()).status_code == 401
    assert all(secret not in caplog.text for secret in (TOKEN, OTHER, rotated, digest(rotated)))


def test_heartbeat_replay_staleness_version_and_observed_quota(relay, monkeypatch):
    factory, player = relay
    _, user = player()
    admin_id, admin = player()
    elevate(factory, admin_id, admin, role="ADMIN")
    now = utcnow()
    monkeypatch.setattr(relay_protocol, "utcnow", lambda: now)
    report = payload(now, ingest={
        "container_status": "exited", "gc_logs": "recent", "observed_at": now.isoformat(),
        "last_metadata_quota_signal_at": now.isoformat(), "steam_session": "unavailable",
    })
    route = API + "/heartbeat"
    assert user.post(route, headers=auth(), json=report).json() == {"protocol_version": 1, "applied": 1}
    assert user.post(route, headers=auth(), json=report).json()["applied"] == 0
    earlier = now - timedelta(seconds=1)
    assert user.post(route, headers=auth(), json=payload(earlier)).json()["applied"] == 0
    assert user.post(route, headers=auth(), json=payload(now - timedelta(days=2))).status_code == 422
    assert user.post(route, headers=auth(), json=payload(protocol_version=2)).status_code == 422
    assert user.post(route, headers=auth(), json=payload(protocol_version=True)).status_code == 422
    assert user.post(route, headers=auth(), json=payload(steam_token="invalid")).status_code == 422
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(RelayHeartbeat)) == 1
    first = next(node for node in admin.get(ADMIN).json()["nodes"] if node["id"] == "mcg")
    assert first["status"] == "online" and first["ingest_status"] == "fresh"
    assert first["ingest"]["steam_session"] == "unavailable"
    assert "metrics" not in first["ingest"]
    monkeypatch.setattr(relay_protocol, "utcnow", lambda: now + timedelta(minutes=6))
    stale = next(node for node in admin.get(ADMIN).json()["nodes"] if node["id"] == "mcg")
    assert stale["status"] == "stale" and stale["ingest_status"] == "stale"
    assert stale["last_heartbeat_at"] == first["last_heartbeat_at"]


def test_roster_and_friendship_replay_unknown_and_revoked_consent(relay, monkeypatch):
    factory, player = relay
    user_id, user = steam_player(factory, player, "Participant", 23456)
    other_id, other = steam_player(factory, player, "Other", 34567)
    assert user.get(API + "/participants", headers=auth()).json()["participants"] == []
    initial = user.put(PROFILE).json()["connection"]
    second = other.put(PROFILE).json()["connection"]
    monkeypatch.setattr(relay_protocol, "PAGE_SIZE", 1)
    first = user.get(API + "/participants", headers=auth()).json()
    last = user.get(API + "/participants", headers=auth(), params={"after": first["next_cursor"]}).json()
    assert last["next_cursor"] is None
    assert {row["connection_id"] for row in first["participants"] + last["participants"]} == {initial["id"], second["id"]}
    assert set(first["participants"][0]) == {"connection_id", "steam_id64"}
    with factory() as db:
        db.get(User, other_id).status = "SUSPENDED"
        db.commit()
    first = user.get(API + "/participants", headers=auth()).json()
    assert first["participants"] == [{"connection_id": initial["id"], "steam_id64": str(76561197960265728 + 23456)}]

    route = API + "/friendship-status"
    time = utcnow()
    old = friendship(initial["id"], when=time)
    assert user.post(route, headers=auth(), json=old).json()["applied"] == 1
    assert user.get(PROFILE).json()["connection"]["friendship_source"] == "relay_manual"
    assert user.get(PROFILE).json()["connection"]["status"] == "connected"
    assert user.post(route, headers=auth(), json=old).json()["applied"] == 0
    earlier = friendship(initial["id"], "disconnected", time - timedelta(milliseconds=1))
    assert user.post(route, headers=auth(), json=earlier).json()["applied"] == 0
    assert user.post(route, headers=auth(), json=friendship(initial["id"], "unknown")).json()["applied"] == 1
    assert user.get(PROFILE).json()["connection"]["status"] == "pending"
    assert user.post(route, headers=auth(), json=friendship(initial["id"], steam_id64="123")).status_code == 422

    assert user.delete(PROFILE).json()["connection"] is None
    current = user.put(PROFILE).json()["connection"]
    assert current["id"] != initial["id"]
    assert user.post(route, headers=auth(), json=old).json()["applied"] == 0
    assert user.post(route, headers=auth(), json=friendship(current["id"], when=time)).json()["applied"] == 0
    assert user.get(PROFILE).json()["connection"]["status"] == "pending"
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(RelayFriendship)) == 0


def test_rate_body_and_production_https_boundaries(relay, monkeypatch):
    _, player = relay
    _, user = player()
    endpoint = API + "/heartbeat"
    assert user.post(endpoint, headers=auth(), content=b"x" * 32769).status_code == 413
    settings = relay_protocol.settings
    monkeypatch.setattr(relay_protocol, "settings", replace(settings, app_env="production"))
    assert user.post(endpoint, headers=auth(), json=payload()).status_code == 401
    monkeypatch.setattr(relay_protocol, "settings", replace(settings, relay_enabled=False))
    assert user.post(endpoint, headers=auth(), json=payload()).status_code == 401
    assert user.get("/api/status").status_code == 200
    monkeypatch.setattr(relay_protocol, "settings", settings)

    for _ in range(60):
        assert user.post(endpoint, headers=auth(), json=payload()).status_code == 200
    limited = user.post(endpoint, headers=auth(), json=payload())
    assert limited.status_code == 429 and int(limited.headers["retry-after"]) > 0


def test_steam_friendship_keeps_its_source_and_requires_definitive_state(relay):
    factory, player = relay
    _, client = steam_player(factory, player, "Participant", 23456)
    connection = client.put(PROFILE).json()["connection"]["id"]
    route = API + "/friendship-status"
    assert client.post(route, headers=auth(), json=friendship(connection, source="steam_web_api")).json() == {
        "protocol_version": 1, "applied": 1,
    }
    status = client.get(PROFILE).json()["connection"]
    assert (status["status"], status["friendship_source"]) == ("connected", "steam_web_api")
    invalid = friendship(connection, "error", source="steam_web_api")
    assert client.post(route, headers=auth(), json=invalid).status_code == 422
    assert client.get(PROFILE).json()["connection"]["status"] == "connected"

    observed = friendship(connection, "disconnected", source="steam_web_api")
    assert client.post(route, headers=auth(), json=observed).json()["applied"] == 1
    assert client.get(PROFILE).json()["connection"]["status"] == "disconnected"


def test_clear_discards_relay_only_confirmation_and_old_retries(relay):
    factory, player = relay
    target_id, player_client = steam_player(factory, player, "Participant", 23456)
    admin_id, admin = player()
    elevate(factory, admin_id, admin, role="ADMIN")
    connection = player_client.put(PROFILE).json()["connection"]["id"]
    route = API + "/friendship-status"
    skewed = utcnow() + timedelta(seconds=1)
    observed = friendship(connection, when=skewed)
    assert player_client.post(route, headers=auth(), json=observed).json()["applied"] == 1
    review = admin.patch(f"/api/admin/users/{target_id}/contract-relay/{connection}", json={"action": "clear"})
    assert review.json()["connection"]["status"] == "pending"
    assert player_client.post(route, headers=auth(), json=observed).json()["applied"] == 0
    newest = friendship(connection, when=skewed + timedelta(seconds=1))
    assert player_client.post(route, headers=auth(), json=newest).json()["applied"] == 1
    assert player_client.get(PROFILE).json()["connection"]["status"] == "connected"


def test_credential_cli_database_errors_are_sanitized(monkeypatch, capsys):
    digest_value = digest(TOKEN)
    monkeypatch.setattr(sys, "argv", ["relay_credentials", "mcg"])
    monkeypatch.setattr(sys, "stdin", StringIO(digest_value))

    def failed(*args, **kwargs):
        raise SQLAlchemyError(f"parameters: {digest_value}")

    monkeypatch.setattr(relay_credentials, "install_credential", failed)
    with pytest.raises(SystemExit) as error:
        relay_credentials.main()
    assert error.value.code == 2
    stderr = capsys.readouterr().err
    assert "Could not store Relay credential" in stderr and digest_value not in stderr


def admission(account_id):
    return {"protocol_version": 1, "steam_id64": str(76561197960265728 + account_id)}


def test_incoming_request_admission_is_disabled_by_default_and_machine_only(relay, monkeypatch):
    factory, player = relay
    _, user = steam_player(factory, player, "Applicant", 23456)
    endpoint = API + "/admissions"
    assert user.post(endpoint, headers=auth(), json=admission(23456)).status_code == 403
    monkeypatch.setattr(relay_protocol, "settings",
                        replace(relay_protocol.settings, relay_auto_enrollment_enabled=True))
    assert user.post(endpoint, json=admission(23456)).status_code == 401
    assert user.post(endpoint, headers=auth(OTHER), json=admission(23456)).status_code == 403
    assert user.post(endpoint, headers=auth(), json=admission(23456) | {"steam_id64": 23456}).status_code == 422
    assert user.get(PROFILE).json()["connection"] is None


def test_incoming_request_reserves_place_but_never_confirms_friendship(relay, monkeypatch):
    factory, player = relay
    user_id, user = steam_player(factory, player, "Applicant", 23456)
    monkeypatch.setattr(relay_protocol, "settings",
                        replace(relay_protocol.settings, relay_auto_enrollment_enabled=True))
    endpoint = API + "/admissions"
    unknown = user.post(endpoint, headers=auth(), json=admission(99999))
    assert unknown.json()["decision"] == "ineligible"
    assert unknown.json()["connection_id"] is None
    response = user.post(endpoint, headers=auth(), json=admission(23456))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["decision"] == "allowed"
    assert user.post(endpoint, headers=auth(), json=admission(23456)).json() == result
    connection = user.get(PROFILE).json()["connection"]
    assert connection["id"] == result["connection_id"]
    assert connection["status"] == "pending"
    assert connection["friendship_confirmed_at"] is None
    with factory() as db:
        db.get(User, user_id).status = "SUSPENDED"
        db.commit()
    assert user.post(endpoint, headers=auth(), json=admission(23456)).json()["decision"] == "ineligible"


def test_incoming_request_respects_capacity_and_explicit_opt_out(relay, monkeypatch):
    from test_relay_pilot_capacity import seed_participants

    factory, player = relay
    seed_participants(factory, 29)
    _, user = steam_player(factory, player, "Applicant", 23456)
    _, other = steam_player(factory, player, "Other", 34567)
    monkeypatch.setattr(relay_protocol, "settings",
                        replace(relay_protocol.settings, relay_auto_enrollment_enabled=True))
    endpoint = API + "/admissions"
    first = user.post(endpoint, headers=auth(), json=admission(23456)).json()
    assert first["decision"] == "allowed"
    assert other.post(endpoint, headers=auth(), json=admission(34567)).json()["decision"] == "full"
    assert user.delete(PROFILE).status_code == 200
    assert user.post(endpoint, headers=auth(), json=admission(23456)).json()["decision"] == "ineligible"
    assert other.post(endpoint, headers=auth(), json=admission(34567)).json()["decision"] == "allowed"
    assert other.delete(PROFILE).status_code == 200
    second = user.put(PROFILE).json()["connection"]
    assert second["id"] != first["connection_id"]
    assert user.post(endpoint, headers=auth(), json=admission(23456)).json()["connection_id"] == second["id"]


def test_admin_disconnect_blocks_replayed_admission(relay, monkeypatch):
    factory, player = relay
    user_id, user = steam_player(factory, player, "Applicant", 23456)
    admin_id, admin = player("Admin")
    elevate(factory, admin_id, admin, role="ADMIN")
    monkeypatch.setattr(relay_protocol, "settings",
                        replace(relay_protocol.settings, relay_auto_enrollment_enabled=True))
    endpoint = API + "/admissions"
    connection = user.post(endpoint, headers=auth(), json=admission(23456)).json()["connection_id"]
    assert admin.patch(f"/api/admin/users/{user_id}/contract-relay/{connection}",
                       json={"action": "disconnect"}).status_code == 200
    assert user.post(endpoint, headers=auth(), json=admission(23456)).json()["decision"] == "ineligible"


def test_expired_reservation_releases_place_and_needs_capacity_for_late_confirmation(relay, monkeypatch):
    from test_relay_pilot_capacity import seed_participants

    factory, player = relay
    seed_participants(factory, 29)
    _, original = steam_player(factory, player, "Waiting for Steam", 23456)
    _, other = steam_player(factory, player, "Ready now", 34567)
    monkeypatch.setattr(relay_protocol, "settings",
                        replace(relay_protocol.settings, relay_auto_enrollment_enabled=True))
    endpoint = API + "/admissions"
    observations = API + "/friendship-status"
    key = original.post(endpoint, headers=auth(), json=admission(23456)).json()["connection_id"]
    manual = original.post(observations, headers=auth(), json=friendship(key, source="steam_web_api"))
    assert manual.json()["applied"] == 0
    assert original.get(PROFILE).json()["connection"]["status"] == "pending"
    with factory.begin() as db:
        db.get(ContractRelayConnection, key).auto_enrollment_expires_at = utcnow() - timedelta(seconds=1)

    assert original.get(PROFILE).json()["connection"]["status"] == "disconnected"
    assert other.put(PROFILE).status_code == 200
    assert original.post(endpoint, headers=auth(), json=admission(23456)).json()["decision"] == "full"
    late = friendship(key, source="steam_session")
    late_response = original.post(observations, headers=auth(), json=late)
    assert late_response.json() == {"protocol_version": 1, "applied": 0, "collector_connections": []}
    assert other.delete(PROFILE).status_code == 200
    assert original.post(observations, headers=auth(), json=late).json()["collector_connections"] == [key]
    replay = original.post(observations, headers=auth(), json=late)
    assert replay.json() == {"protocol_version": 1, "applied": 0, "collector_connections": [key]}
    assert original.get(PROFILE).json()["connection"]["status"] == "connected"
    assert other.put(PROFILE).status_code == 409
    assert original.delete(PROFILE).status_code == 200
    assert original.post(observations, headers=auth(), json=late).json()["collector_connections"] == []


def test_automatic_roster_and_observations_require_enabled_node_and_fresh_data(relay, monkeypatch):
    _, player = relay
    _, user = player()
    roster = API + "/participants?automatic=true"
    endpoint = API + "/friendship-status"
    assert user.get(roster, headers=auth()).status_code == 403
    assert user.post(endpoint, headers=auth(), json=friendship(uuid4(), source="steam_session")).status_code == 403
    monkeypatch.setattr(relay_protocol, "settings",
                        replace(relay_protocol.settings, relay_auto_enrollment_enabled=True))
    assert user.get(roster, headers=auth(OTHER)).status_code == 403
    args = friendship(uuid4(), when=utcnow() - timedelta(minutes=6), source="steam_session")
    assert user.post(endpoint, headers=auth(), json=args).status_code == 422
    args = friendship(uuid4(), source="steam_session")
    args["observations"] += friendship(uuid4())["observations"]
    assert user.post(endpoint, headers=auth(), json=args).status_code == 422


def test_manager_accepts_only_eligible_incoming_and_recovers_a_lost_steam_reply(relay, monkeypatch, tmp_path):
    factory, player = relay
    _, user = steam_player(factory, player, "Registered", 23456)
    suspended_id, _ = steam_player(factory, player, "Suspended", 34567)
    steam_player(factory, player, "Existing friend with no consent", 45678)
    with factory.begin() as db:
        db.get(User, suspended_id).status = "SUSPENDED"
    monkeypatch.setattr(relay_protocol, "settings",
                        replace(relay_protocol.settings, relay_auto_enrollment_enabled=True))
    now = utcnow()
    bot = admission(12345)["steam_id64"]
    steam_id, suspended, old_friend, unknown, outgoing = (
        admission(value)["steam_id64"] for value in (23456, 34567, 45678, 56789, 67890)
    )
    accepted = []
    relations = {steam_id: 2, suspended: 2, unknown: 2, old_friend: 3, outgoing: 4}
    cookie = tmp_path / "steam-login-secure"
    claims = {"sub": bot, "aud": ["web:community"], "exp": int(now.timestamp()) + 3600}
    part = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    cookie.write_text(f"{bot}%7C%7Ctest.{part}.test")
    token = tmp_path / "relay-token"
    token.write_text(TOKEN)
    steam = steam_friends.SteamSession(bot, cookie)
    client = protocol.RelayClient("https://relay.test", token)

    def steam_response(request, timeout):
        address = urlsplit(request.full_url)
        if request.get_method() == "GET":
            if address.path == "/chat/clientjstoken":
                assert address.hostname == "steamcommunity.com"
                assert request.get_header("Cookie").endswith(cookie.read_text())
                assert not address.query
                return BytesIO(json.dumps({"logged_in": True, "steamid": bot, "token": "web.api.token"}).encode())
            assert address.hostname == "api.steampowered.com"
            assert address.path == "/IFriendsListService/GetFriendsList/v1/"
            assert parse_qs(address.query) == {"access_token": ["web.api.token"]}
            assert request.get_header("Cookie") is None
            body = {"response": {"friendslist": {"friends": [
                {"ulfriendid": account, "efriendrelationship": relation}
                for account, relation in relations.items()
            ]}}}
            return BytesIO(json.dumps(body).encode())
        assert address.netloc == "steamcommunity.com"
        assert address.path == f"/profiles/{bot}/friends/action"
        assert user.get(PROFILE).json()["connection"]["status"] == "pending"
        data = parse_qs(request.data.decode())
        assert data["action"] == ["accept"] and data["steamid"] == [bot]
        assert f'sessionid={data["sessionid"][0]}' in request.get_header("Cookie")
        accepted.extend(data["steamids[]"])
        relations[steam_id] = 3
        raise TimeoutError("Steam accepted before its response was lost")

    def site_response(request, timeout):
        address = urlsplit(request.full_url)
        assert address.hostname == "relay.test"
        reply = user.request(request.get_method(), address.path + ("?" + address.query if address.query else ""),
                             headers=dict(request.header_items()), content=request.data)
        if reply.is_error:
            raise HTTPError(request.full_url, reply.status_code, "", reply.headers, BytesIO(reply.content))
        return BytesIO(reply.content)

    monkeypatch.setattr(steam.opener, "open", steam_response)
    monkeypatch.setattr(client.opener, "open", site_response)
    collector = tmp_path / "collector.json"
    state = tmp_path / "delivery.json"

    def new_manager():
        return manager.Manager(
            client, state, tmp_path / "host.json", None, steam_session=steam, collector=collector,
        )

    first = new_manager()
    assert first.sync_enrollment(now, [], steam, collector) is not None
    assert accepted == [steam_id]
    assert not collector.exists()
    assert user.get(PROFILE).json()["connection"]["status"] == "pending"

    second = new_manager()
    assert second.sync_enrollment(now + timedelta(minutes=1), [], steam, collector) is None
    assert accepted == [steam_id]
    assert user.get(PROFILE).json()["connection"]["friendship_source"] == "steam_session"
    assert protocol.read_json(collector)["accounts"] == [23456]
    assert protocol.read_json(collector)["steam_id64"] == bot
    assert str(steam_id) not in state.read_text()
    assert collector.stat().st_mode & 0o777 == 0o640

    assert user.delete(PROFILE).status_code == 200
    assert second.sync_enrollment(now + timedelta(minutes=2), [], steam, collector) is None
    assert protocol.read_json(collector)["accounts"] == []
