from datetime import datetime
from uuid import uuid4

from sqlalchemy import select

from app.models import AuditLog, ContractRelayConnection, User
from test_bureau_operations import elevate
from test_player_community import community


PROFILE = "/api/profile/contract-relay"


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
