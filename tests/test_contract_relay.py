from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import AuditLog, ContractRelayConnection, User, utcnow
from test_bureau_operations import elevate
from test_player_community import community


PROFILE = "/api/profile/contract-relay"
QUICK_INVITE = "https://s.team/p/abcd-efgh/AbC123XY"
STEAM_PROFILE = "https://steamcommunity.com/id/deadlock-contracts-relay/"


def steam_player(factory, player, name, account_id):
    user_id, client = player(name)
    with factory() as db:
        user = db.get(User, user_id)
        user.steam_id64 = 76561197960265728 + account_id
        user.account_id = account_id
        db.commit()
    return user_id, client


def test_relay_opt_in_is_private_idempotent_and_discoverable_by_admin(community):
    factory, player = community
    user_id, client = steam_player(factory, player, "Relay participant", 12345)
    _, outsider = player("Without Steam")
    admin_id, admin = player("Admin")
    elevate(factory, admin_id, admin, role="ADMIN")
    admin_url = f"/api/admin/users/{user_id}/contract-relay"

    start = client.get(PROFILE)
    assert start.json() == {"connection": None}
    assert start.headers["cache-control"] == "private, no-store"
    assert outsider.put(PROFILE).status_code == 409
    assert outsider.get(admin_url).status_code == 403
    csrf = client.headers.pop("X-CSRF-Token")
    assert client.put(PROFILE).status_code == 403
    client.headers["X-CSRF-Token"] = csrf

    response = client.put(PROFILE)
    assert response.status_code == 200, response.text
    connection = response.json()["connection"]
    assert connection["friendship_confirmed_at"] is None
    assert datetime.fromisoformat(connection["consented_at"]).utcoffset() is not None
    assert client.put(PROFILE).json() == response.json()
    assert admin.get(admin_url).json() == response.json()
    assert outsider.get(PROFILE).json() == {"connection": None}
    assert [row["id"] for row in admin.get("/api/admin/users?relay_opted_in=true").json()["items"]] == [user_id]

    csrf = client.headers.pop("X-CSRF-Token")
    assert client.delete(PROFILE).status_code == 403
    client.headers["X-CSRF-Token"] = csrf
    assert client.delete(PROFILE).json() == {"connection": None}
    assert client.delete(PROFILE).json() == {"connection": None}
    assert admin.get("/api/admin/users?relay_opted_in=true").json()["total"] == 0


def test_admin_review_requires_elevation_and_current_consent(community):
    factory, player = community
    user_id, client = steam_player(factory, player, "Relay participant", 12345)
    admin_id, admin = player("Admin")
    moderator_id, moderator = player("Moderator")
    elevate(factory, moderator_id, moderator)
    admin_url = f"/api/admin/users/{user_id}/contract-relay"
    confirm = {"action": "confirm"}

    elevate(factory, admin_id, admin, role="ADMIN", elevated=False)
    assert admin.get(admin_url).status_code == 403
    elevate(factory, admin_id, admin, role="ADMIN")
    assert admin.patch(f"{admin_url}/{uuid4()}", json=confirm).status_code == 409

    initial = client.put(PROFILE).json()["connection"]
    review_url = f'{admin_url}/{initial["id"]}'
    assert moderator.patch(review_url, json=confirm).status_code == 403
    csrf = admin.headers.pop("X-CSRF-Token")
    assert admin.patch(review_url, json=confirm).status_code == 403
    admin.headers["X-CSRF-Token"] = csrf
    assert admin.patch(review_url, json={"action": "join"}).status_code == 422

    marked = admin.patch(review_url, json=confirm).json()["connection"]
    assert marked["friendship_confirmed_at"]
    assert admin.patch(review_url, json=confirm).json()["connection"] == marked
    assert client.get(PROFILE).json()["connection"] == marked
    assert admin.patch(review_url, json={"action": "clear"}).json()["connection"] == initial
    assert client.delete(PROFILE).json() == {"connection": None}
    current = client.put(PROFILE).json()["connection"]
    assert current["id"] != initial["id"]
    assert admin.patch(review_url, json=confirm).status_code == 409

    assert admin.patch(f'{admin_url}/{current["id"]}', json={"action": "disconnect"}).json() == {"connection": None}
    assert client.get(PROFILE).json() == {"connection": None}
    with factory() as db:
        assert db.scalar(select(ContractRelayConnection)) is None
        entries = db.scalars(select(AuditLog).where(AuditLog.action.startswith("admin.contract_relay_"))).all()
        assert sorted(entry.action for entry in entries) == [
            "admin.contract_relay_clear", "admin.contract_relay_confirm", "admin.contract_relay_disconnect",
        ]
        assert all(entry.user_id == admin_id and entry.entity_id == user_id and entry.data == {} for entry in entries)


def test_quick_invite_is_private_to_current_consent_and_can_be_revoked(community):
    factory, player = community
    user_id, client = steam_player(factory, player, "Participant", 12345)
    outsider_id, outsider = steam_player(factory, player, "Other participant", 12346)
    admin_id, admin = player("Admin")
    admin_url = f"/api/admin/users/{user_id}/contract-relay"
    no_consent = f"{admin_url}/{uuid4()}/quick-invite"
    invite = {"url": QUICK_INVITE}

    elevate(factory, admin_id, admin, role="ADMIN")
    assert admin.put(no_consent, json=invite).status_code == 409
    opted_in = client.put(PROFILE).json()["connection"]
    opted_in_outsider = outsider.put(PROFILE).json()["connection"]
    invite_url = f'{admin_url}/{opted_in["id"]}/quick-invite'
    outsider_url = f'/api/admin/users/{outsider_id}/contract-relay/{opted_in_outsider["id"]}/quick-invite'
    assert outsider.put(invite_url, json=invite).status_code == 403

    csrf = admin.headers.pop("X-CSRF-Token")
    assert admin.put(invite_url, json=invite).status_code == 403
    admin.headers["X-CSRF-Token"] = csrf
    published = admin.put(invite_url, json=invite)
    assert published.status_code == 200, published.text
    assert QUICK_INVITE not in published.text
    assert QUICK_INVITE not in admin.get(admin_url).text
    assert QUICK_INVITE not in outsider.get(PROFILE).text
    assert outsider.get(f"{PROFILE}/quick-invite", follow_redirects=False).headers["location"] == STEAM_PROFILE
    assert QUICK_INVITE not in admin.put(outsider_url, json=invite).text
    assert admin.put(outsider_url, json=invite).status_code == 409

    received = client.get(PROFILE)
    assert received.headers["cache-control"] == "private, no-store"
    connection = received.json()["connection"]
    assert QUICK_INVITE not in received.text
    redirected = client.get(f"{PROFILE}/quick-invite", follow_redirects=False)
    assert redirected.status_code == 303
    assert redirected.headers["location"] == QUICK_INVITE
    assert redirected.headers["cache-control"] == "private, no-store"
    assert redirected.headers["referrer-policy"] == "no-referrer"
    expires_at = connection["quick_invite_expires_at"]
    assert utcnow() < datetime.fromisoformat(expires_at) <= utcnow() + timedelta(hours=24)
    assert admin.put(invite_url, json=invite).json()["connection"]["quick_invite_expires_at"] == expires_at

    assert admin.delete(invite_url).status_code == 200
    assert "quick_invite_expires_at" not in client.get(PROFILE).json()["connection"]
    assert client.get(f"{PROFILE}/quick-invite", follow_redirects=False).headers["location"] == STEAM_PROFILE
    assert admin.delete(invite_url).status_code == 200
    assert admin.put(invite_url, json=invite).status_code == 200
    client.delete(PROFILE)
    assert client.put(PROFILE).json()["connection"]["id"] != opted_in["id"]
    assert admin.put(invite_url, json=invite).status_code == 409
    assert client.get(f"{PROFILE}/quick-invite", follow_redirects=False).headers["location"] == STEAM_PROFILE
    with factory() as db:
        assert all(entry.data == {} for entry in db.scalars(select(AuditLog)).all())


def test_quick_invite_is_hidden_after_expiry_or_friendship_confirmation(community):
    factory, player = community
    user_id, client = steam_player(factory, player, "Participant", 12345)
    admin_id, admin = player("Admin")
    elevate(factory, admin_id, admin, role="ADMIN")
    connection = client.put(PROFILE).json()["connection"]
    review_url = f'/api/admin/users/{user_id}/contract-relay/{connection["id"]}'
    invite_url = f"{review_url}/quick-invite"
    assert admin.put(invite_url, json={"url": QUICK_INVITE}).status_code == 200
    assert admin.patch(review_url, json={"action": "confirm"}).status_code == 200
    assert client.get(f"{PROFILE}/quick-invite", follow_redirects=False).headers["location"] == STEAM_PROFILE
    assert admin.patch(review_url, json={"action": "clear"}).status_code == 200
    with factory() as db:
        db.get(ContractRelayConnection, connection["id"]).quick_invite_expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert client.get(f"{PROFILE}/quick-invite", follow_redirects=False).headers["location"] == STEAM_PROFILE
    assert QUICK_INVITE not in admin.put(invite_url, json={"url": QUICK_INVITE}).text
    assert client.get(f"{PROFILE}/quick-invite", follow_redirects=False).headers["location"] == STEAM_PROFILE


@pytest.mark.parametrize("invalid", [
    "http://s.team/p/abcd/Token",
    "https://s.team.example.org/p/abcd/Token",
    "https://s.team@evil.example/p/abcd/Token",
    "https://s.team:443/p/abcd/Token",
    "https://s.team/p/abcd",
    "https://s.team/p/abcd/Token?redirect=evil",
    "https://s.team/p/abcd/%2fToken",
])
def test_quick_invite_rejects_non_steam_or_non_tokenized_urls_without_echoing(community, invalid):
    factory, player = community
    user_id, client = steam_player(factory, player, "Participant", 12345)
    admin_id, admin = player("Admin")
    elevate(factory, admin_id, admin, role="ADMIN")
    connection = client.put(PROFILE).json()["connection"]
    invite_url = f'/api/admin/users/{user_id}/contract-relay/{connection["id"]}/quick-invite'
    response = admin.put(invite_url, json={"url": invalid})
    assert response.status_code == 422
    assert invalid not in response.text
    assert "quick_invite_expires_at" not in client.get(PROFILE).json()["connection"]
