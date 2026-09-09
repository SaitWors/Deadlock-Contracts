"""Real-session coverage for customization, privacy and sanitized image storage."""
import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.main import app
from app.models import AuditLog, BureauMembership, PlayerBureau
from test_player_community import community, create_bureau


def picture(colour="navy"):
    stream = io.BytesIO()
    Image.new("RGB", (720, 240), colour).save(stream, "PNG")
    return base64.b64encode(stream.getvalue()).decode()


def design(client, **changes):
    bureau = client.get("/api/bureaus/deadlock-night").json()["bureau"]
    result = {key: bureau[key] for key in ("name", "tagline", "description", "rules", "language", "theme", "recruitment", "appearance", "role_titles", "welcome", "listed")}
    return {**result, "expected_revision": bureau["design_revision"], **changes}


def test_bureau_design_round_trip_and_audit_without_changing_permissions(community):
    factory, player = community
    owner_id, owner = player("Director")
    create_bureau(owner)
    payload = design(owner, appearance={"accent": "PLUM", "cover": "GRID", "emblem": "feather", "avatar_shape": "CIRCLE", "roster_layout": "LIST", "cover_position": 73},
                     role_titles={"DIRECTOR": "Архивариус", "MODERATOR": "Старший", "OPERATIVE": "Следователь"}, welcome="Собираемся вечером", avatar_image=picture(), cover_image=picture("green"))
    saved = owner.put("/api/bureaus/deadlock-night/customization", json=payload)
    assert saved.status_code == 200, saved.text
    value = saved.json()["bureau"]
    assert value["appearance"] == payload["appearance"]
    assert value["role_titles"] == payload["role_titles"]
    assert value["welcome"] == payload["welcome"] and value["design_revision"] == 2
    assert value["my_role"] == "DIRECTOR" and value["can_edit"]
    again = owner.get("/api/bureaus/deadlock-night").json()["bureau"]
    assert again["appearance"] == value["appearance"] and again["avatar_url"] == value["avatar_url"]
    with factory() as db:
        member = db.scalar(select(BureauMembership).where(BureauMembership.user_id == owner_id))
        assert member.role == "DIRECTOR"
        log = db.scalar(select(AuditLog).where(AuditLog.action == "bureau.customized"))
        assert log.data == {"revision": 2, "media_changed": ["avatar", "cover"]}
    assert "avatar_data" not in value and "cover_data" not in value and "avatar_image" not in value


def test_only_director_can_customize_with_csrf_and_revision(community):
    factory, player = community
    _, owner = player("Director")
    _, member = player("Member")
    _, outsider = player("Outsider")
    create_bureau(owner, recruitment="OPEN")
    joined = member.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True}).json()["bureau"]
    member_id = next(item["id"] for item in joined["members"] if item["is_me"])
    assert owner.post(f"/api/bureaus/deadlock-night/members/{member_id}", json={"action": "PROMOTE"}).status_code == 200
    payload = design(owner, tagline="Saved by director")
    for client in (member, outsider):
        assert client.put("/api/bureaus/deadlock-night/customization", json=payload).status_code == 403
    csrf = owner.headers.pop("X-CSRF-Token")
    assert owner.put("/api/bureaus/deadlock-night/customization", json=payload).status_code == 403
    owner.headers["X-CSRF-Token"] = csrf
    assert owner.put("/api/bureaus/deadlock-night/customization", json=payload).status_code == 200
    stale = owner.put("/api/bureaus/deadlock-night/customization", json={**payload, "tagline": "Stale overwrite"})
    assert stale.status_code == 409
    assert owner.get("/api/bureaus/deadlock-night").json()["bureau"]["tagline"] == "Saved by director"


def test_unlisted_directory_and_members_only_welcome_preserve_roster_privacy(community):
    _, player = community
    _, owner = player("Private director")
    _, visitor = player("Visitor")
    create_bureau(owner)
    saved = owner.put("/api/bureaus/deadlock-night/customization", json=design(owner, listed=False, welcome="Only our members may read this"))
    assert saved.status_code == 200
    directory = visitor.get("/api/bureaus?q=Deadlock").json()
    assert directory["items"] == [] and directory["total"] == 0
    assert owner.get("/api/bureaus").json()["my_bureau"]["slug"] == "deadlock-night"
    page = visitor.get("/api/bureaus/deadlock-night").json()["bureau"]
    assert page["welcome"] == "" and page["members"][0]["display_name"] is None
    assert page["members"][0]["id"] is None and page["members"][0]["avatar_url"] is None
    assert "Only our members" not in str(page)


def test_media_is_reencoded_replaced_removed_and_hidden_when_frozen(community):
    factory, player = community
    _, owner = player()
    _, visitor = player()
    create_bureau(owner)
    result = owner.put("/api/bureaus/deadlock-night/customization", json=design(owner, avatar_image=picture())).json()["bureau"]
    url = result["avatar_url"]
    anonymous = TestClient(app)
    try:
        response = anonymous.get(url)
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/webp" and response.headers["cache-control"] == "private, no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        with Image.open(io.BytesIO(response.content)) as decoded:
            assert decoded.format == "WEBP" and not decoded.getexif()
        with factory() as db:
            bureau = db.scalar(select(PlayerBureau)); bureau.status = "FROZEN"; db.commit()
        assert anonymous.get(url).status_code == 404
        assert visitor.get(url).status_code == 404
        assert owner.get(url).status_code == 200
    finally:
        anonymous.close()
    # The director can replace offending art while frozen; the file is not public.
    replacement = owner.put("/api/bureaus/deadlock-night/customization", json=design(owner, avatar_image=picture("red"))).json()["bureau"]
    assert replacement["avatar_url"] != url
    removed = owner.put("/api/bureaus/deadlock-night/customization", json=design(owner, avatar_image="")).json()["bureau"]
    assert removed["avatar_url"] is None and owner.get(url).status_code == 404


@pytest.mark.parametrize("changes", [
    {"appearance": {"accent": "#fff;display:none"}},
    {"appearance": {"cover_position": 101}},
    {"appearance": {"emblem": "<svg onload=alert(1)>"}},
    {"role_titles": {"OWNER": "Owner"}},
    {"role_titles": {"DIRECTOR": "x" * 25}},
    {"welcome": "x" * 501},
    {"avatar_image": base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg"/>').decode()},
    {"avatar_image": "invalid base64"},
])
def test_invalid_design_does_not_partially_update_bureau(community, changes):
    _, player = community
    _, owner = player()
    create_bureau(owner)
    response = owner.put("/api/bureaus/deadlock-night/customization", json=design(owner, tagline="Must not save", **changes))
    assert response.status_code == 422, response.text
    value = owner.get("/api/bureaus/deadlock-night").json()["bureau"]
    assert value["tagline"] == "" and value["design_revision"] == 1


def test_invalid_second_image_is_atomic_and_legacy_update_invalidates_editor(community):
    _, player = community
    _, owner = player()
    create_bureau(owner)
    payload = design(owner, avatar_image=picture(), cover_image="invalid base64")
    assert owner.put("/api/bureaus/deadlock-night/customization", json=payload).status_code == 422
    value = owner.get("/api/bureaus/deadlock-night").json()["bureau"]
    assert value["avatar_url"] is None and value["cover_url"] is None and value["design_revision"] == 1
    pending = design(owner)
    assert owner.put("/api/bureaus/deadlock-night", json={"name": "Deadlock New Name"}).status_code == 200
    assert owner.put("/api/bureaus/deadlock-night/customization", json=pending).status_code == 409


def test_staff_can_review_frozen_art_only_after_admin_verification(community):
    from test_bureau_operations import elevate
    factory, player = community
    _, owner = player()
    _, reporter = player()
    staff_id, staff = player()
    create_bureau(owner)
    assert owner.put("/api/bureaus/deadlock-night/customization", json=design(owner, avatar_image=picture(), role_titles={"DIRECTOR": "Archivist"})).status_code == 200
    report = reporter.post("/api/bureaus/deadlock-night/reports", json={"kind": "CONTENT", "message": "Please check this bureau artwork"})
    assert report.status_code == 200 and "current_artwork" not in report.json()["report"]
    with factory() as db:
        db.scalar(select(PlayerBureau)).status = "FROZEN"; db.commit()
    url = "/api/admin/bureaus/deadlock-night/media/avatar"
    assert owner.get(url).status_code == 403
    elevate(factory, staff_id, staff, elevated=False)
    assert staff.get(url).status_code == 403
    elevate(factory, staff_id, staff)
    assert staff.get(url).status_code == 200
    queue = staff.get("/api/admin/bureau-reports").json()["items"][0]
    assert queue["snapshot"]["rank_director"] == "Archivist"
    assert queue["current_artwork"]["avatar"].startswith(url)
