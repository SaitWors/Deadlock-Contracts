import base64
import io
from datetime import timedelta

import pytest
from PIL import Image
from sqlalchemy import func, select

from app.models import ArchiveCard, ArchiveCipher, ArchiveLedger, RewardLedgerEntry, User, utcnow
from app.services import archive as service
from app.services.permissions import role_has_permission
from test_bureau_operations import elevate
from test_player_community import community  # real browser sessions / isolated limiter


def design(**changes):
    output = io.BytesIO()
    Image.new("RGB", (400, 600), "#345640").save(output, "PNG")
    return {"hero": "abrams", "rank": "SSS", "title": "Night investigation", "artist": "Test artist",
            "rights_confirmed": True, "image": base64.b64encode(output.getvalue()).decode(), **changes}


def create(client, **changes):
    response = client.post("/api/archive/cards", json=design(**changes))
    assert response.status_code == 200, response.text
    return response.json()["card"]


def action(client, card, name):
    return client.post(f"/api/archive/cards/{card['id']}/{name}", json={"revision": card["revision"]})


def decide(client, card, name):
    return client.post(f"/api/admin/archive/cards/{card['id']}/decision", json={"revision": card["revision"], "action": name, "note": "Reviewed composition and credit"})


def solve(factory, client, round_data):
    with factory() as db:
        solution = db.get(ArchiveCipher, round_data["id"]).solution
    response = client.post(f"/api/archive/cipher/{round_data['id']}/guess", json={"revision": round_data["revision"], "symbols": solution})
    assert response.status_code == 200, response.text
    return response.json()["round"]


def test_nine_ranks_roster_and_publish_permission_policy(community):
    _, player = community
    _, client = player()
    meta = client.get("/api/archive/meta").json()
    assert meta["ranks"] == ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"]
    assert len(meta["heroes"]) == 38 and not meta["can_publish"]
    for role in ("OWNER", "ADMIN"):
        assert role_has_permission(role, "cards.publish")
    for role in ("MODERATOR", "TESTER", "PLAYER"):
        assert not role_has_permission(role, "cards.publish")


def test_drafts_are_private_and_publication_requires_admin_elevation(community):
    factory, player = community
    _, author = player(); moderator_id, moderator = player(); admin_id, admin = player()
    card = create(author)
    assert author.get("/api/archive/cards").json()["total"] == 0
    assert moderator.get(card["image_url"]).status_code == 404
    assert author.get(card["image_url"]).headers["content-type"] == "image/webp"
    pending = action(author, card, "submit").json()["card"]
    elevate(factory, moderator_id, moderator)
    assert moderator.get("/api/admin/archive/cards").status_code == 403
    assert decide(moderator, pending, "PUBLISH").status_code == 403
    elevate(factory, admin_id, admin, role="ADMIN", elevated=False)
    assert decide(admin, pending, "PUBLISH").status_code == 403
    elevate(factory, admin_id, admin, role="ADMIN")
    queued = admin.get("/api/admin/archive/cards").json()["items"][0]
    assert admin.get(queued["image_url"]).status_code == 200
    published = decide(admin, pending, "PUBLISH").json()["card"]
    shown = moderator.get("/api/archive/cards").json()["items"][0]
    assert shown["id"] == published["id"] and "review_note" not in shown and "creator_id" not in shown
    assert moderator.get(shown["image_url"]).status_code == 200
    # Approval locks the design, including artwork and rank; author cannot substitute it.
    assert author.put(f"/api/archive/cards/{card['id']}", json={**design(rank="F"), "revision": published["revision"]}).status_code == 409
    assert decide(admin, pending, "REJECT").status_code == 409
    assert author.get("/api/archive/coverage").json()["items"] == [{"hero": "abrams", "rank": "SSS", "count": 1}]
    assert decide(admin, published, "ARCHIVE").status_code == 200
    assert moderator.get(shown["image_url"]).status_code == 404
    assert moderator.get("/api/archive/cards").json()["total"] == 0


def test_revision_checks_withdrawal_and_rejection_resubmission(community):
    factory, player = community
    _, author = player(); admin_id, admin = player()
    elevate(factory, admin_id, admin, role="ADMIN")
    card = create(author)
    review_image = f"/api/admin/archive/cards/{card['id']}/image"
    assert admin.get(review_image).status_code == 404
    pending = action(author, card, "submit").json()["card"]
    assert admin.get(review_image).status_code == 200
    assert author.put(f"/api/archive/cards/{card['id']}", json={**design(), "revision": pending["revision"]}).status_code == 409
    withdrawn = action(author, pending, "withdraw").json()["card"]
    assert admin.get(review_image).status_code == 404
    assert decide(admin, pending, "PUBLISH").status_code == 409
    pending = action(author, withdrawn, "submit").json()["card"]
    rejected = decide(admin, pending, "REJECT").json()["card"]
    assert rejected["review_note"]
    updated = author.put(f"/api/archive/cards/{card['id']}", json={**design(title="New composition", rank="A"), "revision": rejected["revision"]})
    assert updated.status_code == 200, updated.text
    assert updated.json()["card"]["status"] == "DRAFT"
    assert action(author, updated.json()["card"], "submit").status_code == 200


def test_create_update_csrf_and_idor_are_enforced(community):
    _, player = community
    _, author = player(); _, stranger = player()
    card = create(author)
    url = f"/api/archive/cards/{card['id']}"
    assert stranger.put(url, json={**design(), "revision": card["revision"]}).status_code == 404
    assert action(stranger, card, "remove").status_code == 404
    saved = author.headers.pop("X-CSRF-Token")
    assert action(author, card, "submit").status_code == 403
    assert author.post("/api/archive/cipher").status_code == 403
    author.headers["X-CSRF-Token"] = saved
    assert author.post("/api/archive/cards", json=design(status="PUBLISHED")).status_code == 422


def test_image_validation_credit_and_metadata_normalization(community):
    factory, player = community
    _, client = player()
    card = create(client, rights_confirmed=False)
    assert action(client, card, "submit").status_code == 422
    with factory() as db:
        raw = db.get(ArchiveCard, card["id"]).image_data
        assert raw[:4] == b"RIFF"
        with Image.open(io.BytesIO(raw)) as opened:
            assert opened.format == "WEBP" and not opened.getexif()
    for changes in ({"rank": "X"}, {"hero": "unknown"}, {"source_url": "javascript:alert(1)"},
                    {"image": base64.b64encode(b"<svg></svg>").decode()}, {"image": "!invalid"}, {"crop_x": 101}):
        assert client.post("/api/archive/cards", json=design(**changes)).status_code == 422


def test_removing_draft_does_not_reset_daily_creation_limit(community):
    _, player = community
    _, client = player()
    for _ in range(3):
        card = create(client)
        assert action(client, card, "remove").status_code == 200
    assert client.get("/api/archive/cards?mine=true").json()["total"] == 0
    assert client.post("/api/archive/cards", json=design()).status_code == 429


def test_catalog_pagination_and_hero_rank_search(community):
    factory, player = community
    _, client = player()
    with factory() as db:
        db.add_all(ArchiveCard(hero="abrams", rank="F", title=f"Archive {i:02}", status="PUBLISHED") for i in range(21))
        db.add(ArchiveCard(hero="ivy", rank="SS", title="Other", status="PUBLISHED"))
        db.commit()
    first = client.get("/api/archive/cards?hero=abrams&rank=F&q=Archive").json()
    second = client.get("/api/archive/cards?hero=abrams&rank=F&q=Archive&offset=18").json()
    assert first["total"] == 21 and len(first["items"]) == 18 and len(second["items"]) == 3
    assert not {row["id"] for row in first["items"]} & {row["id"] for row in second["items"]}


def test_currency_is_private_idempotent_and_separate_from_xp(community):
    factory, player = community
    user_id, client = player(); _, other = player()
    initial = client.post("/api/archive/cipher").json()["round"]
    assert initial["solution"] is None
    assert client.post("/api/archive/cipher").json()["round"]["id"] == initial["id"]
    assert other.post(f"/api/archive/cipher/{initial['id']}/guess", json={"revision": 1, "symbols": [0, 1, 2, 3]}).status_code == 404
    solve(factory, client, initial)
    solve(factory, client, initial)
    assert client.get("/api/archive/wallet").json()["balance"] == 30
    assert other.get("/api/archive/wallet").json()["balance"] == 0
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 1
        assert db.scalar(select(func.count()).select_from(RewardLedgerEntry)) == 0
        assert db.get(User, user_id).xp == 0


def test_cipher_retry_does_not_consume_attempt_and_assistance_is_bounded(community):
    factory, player = community
    _, client = player()
    current = client.post("/api/archive/cipher").json()["round"]
    with factory() as db:
        item = db.get(ArchiveCipher, current["id"]); item.solution = [0, 1, 2, 3]; db.commit()
    url = f"/api/archive/cipher/{current['id']}/guess"
    for count in range(6):
        body = {"revision": current["revision"], "symbols": [5, 4, 1, 0]}
        response = client.post(url, json=body)
        assert response.status_code == 200, response.text
        current = response.json()["round"]
        assert len(current["guesses"]) == count + 1
        assert client.post(url, json=body).json()["round"] == current
        assert current["solution"] == ([0, 1, 2, 3] if count == 5 else None)
    assisted = solve(factory, client, current)
    assert assisted["status"] == "ASSISTED"
    assert client.get("/api/archive/wallet").json()["balance"] == 30
    assert client.post(url, json={"revision": 1, "symbols": [True, 1, 2, 3]}).status_code == 422


def test_weekly_reward_limit_and_expired_rounds(community):
    factory, player = community
    _, client = player()
    for _ in range(5):
        solve(factory, client, client.post("/api/archive/cipher").json()["round"])
    assert client.post("/api/archive/cipher").status_code == 409
    wallet = client.get("/api/archive/wallet").json()
    assert wallet["balance"] == 150 and wallet["completed"] == 5
    with factory() as db:
        row = db.scalar(select(ArchiveCipher)); row.week -= timedelta(days=7); db.commit()
        row_id = row.id
    assert client.post(f"/api/archive/cipher/{row_id}/guess", json={"revision": 1, "symbols": [0, 1, 2, 3]}).status_code == 409


def test_account_deletion_removes_private_art_and_tokens(community):
    factory, player = community
    user_id, client = player()
    card = create(client)
    solve(factory, client, client.post("/api/archive/cipher").json()["round"])
    assert client.post("/api/account/delete", json={"confirmation": "DELETE"}).status_code == 200
    with factory() as db:
        assert db.get(ArchiveCard, card["id"]) is None
        assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == user_id)) == 0


@pytest.mark.parametrize("rank", service.RANKS)
def test_every_rank_is_accepted_for_designs(community, rank):
    _, player = community
    _, client = player()
    assert create(client, rank=rank)["rank"] == rank
