"""Economy boundary regressions through real authenticated archive routes."""
from uuid import uuid4

from sqlalchemy import func, select

from app.archive_packs import AcquireCard, GrantTokens
from app.models import ArchiveItem, ArchiveLedger, ArchiveOperation
from app.services import archive_packs as service
from test_archive_packs import fund, owner, pack, published
from test_player_community import community


def grant(client, amount, **changes):
    return client.post("/api/owner/archive/tokens", json={
        "request_key": str(uuid4()), "delta": amount, "note": "Economy regression adjustment", **changes,
    })


def acquire(client, card_id, scope="REAL", **changes):
    return client.post(f"/api/archive/cards/{card_id}/acquire", json={
        "request_key": str(uuid4()), "expected_price": 25, "scope": scope, **changes,
    })


def test_store_and_owner_grants_default_to_separate_wallets():
    purchase = AcquireCard(request_key=uuid4(), expected_price=25)
    tokens = GrantTokens(request_key=uuid4(), delta=100, note="Testing wallet separation")
    assert getattr(purchase, "scope", None) == "REAL"
    assert getattr(tokens, "scope", None) == "SANDBOX"


def test_new_recommendation_prices_the_current_direct_purchase_costs():
    recommendation = service.recommendation([
        {"rank": "F", "weight": 100}, {"rank": "SSS", "weight": 1},
    ], 3)
    assert recommendation["price"] == 85
    assert recommendation["expected_direct_cost"] == 151.49
    assert recommendation["model"] == 2


def test_owner_test_tokens_cannot_fund_real_purchase(community, owner):
    factory, _ = community
    owner_id, client = owner
    card_id = published(factory)
    fund(factory, owner_id, 10)
    response = grant(client, 100)
    assert response.status_code == 200, response.text
    assert response.json().get("scope") == "SANDBOX"
    assert acquire(client, card_id).status_code == 409
    wallet = client.get("/api/archive/wallet").json()
    assert wallet["balance"] == 10
    assert wallet["wallets"]["SANDBOX"]["available_balance"] == 100


def test_sandbox_store_purchase_preserves_real_wallet_and_marks_items(community, owner):
    factory, _ = community
    owner_id, client = owner
    card_id = published(factory)
    envelope = pack(client, card_id, price=30, draws=2)
    fund(factory, owner_id, 90)
    assert grant(client, 100).status_code == 200
    direct = acquire(client, card_id, "SANDBOX")
    assert direct.status_code == 200, direct.text
    assert direct.json()["scope"] == "SANDBOX"
    assert direct.json()["items"][0]["test_grant"] is True
    opening = client.post(f"/api/archive/packs/{envelope['id']}/open", json={
        "request_key": str(uuid4()), "revision": 1, "scope": "SANDBOX",
    })
    assert opening.status_code == 200, opening.text
    assert all(item["scope"] == "SANDBOX" and item["test_grant"] for item in opening.json()["items"])
    assert client.get("/api/archive/inventory").json()["total"] == 0
    inventory = client.get("/api/archive/inventory?scope=SANDBOX").json()
    assert inventory["items"][0]["quantity"] == inventory["items"][0]["test_count"] == 3
    assert client.get("/api/archive/openings").json()["total"] == 0
    assert client.get("/api/archive/openings?scope=SANDBOX").json()["total"] == 3
    with factory() as db:
        assert service.balance(db, owner_id) == 90
        assert service.balance(db, owner_id, "SANDBOX") == 45
        assert set(db.scalars(select(ArchiveItem.scope).where(ArchiveItem.user_id == owner_id))) == {"SANDBOX"}


def test_request_key_cannot_replay_purchase_in_another_scope(community, owner):
    factory, _ = community
    owner_id, client = owner
    card_id = published(factory)
    fund(factory, owner_id, 100)
    assert grant(client, 100).status_code == 200
    key = str(uuid4())
    first = acquire(client, card_id, "SANDBOX", request_key=key)
    assert first.status_code == 200, first.text
    assert acquire(client, card_id, "SANDBOX", request_key=key).json() == first.json()
    assert acquire(client, card_id, "REAL", request_key=key).status_code == 409
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveItem)) == 1
        assert service.balance(db, owner_id) == 100


def test_recovered_legacy_receipt_exposes_migrated_scope_without_rewriting_it(community, owner):
    factory, _ = community
    _, client = owner
    card_id = published(factory)
    assert grant(client, 100).status_code == 200
    key = str(uuid4())
    bought = acquire(client, card_id, "SANDBOX", request_key=key)
    assert bought.status_code == 200, bought.text
    with factory() as db:
        operation = db.get(ArchiveOperation, bought.json()["id"])
        legacy = dict(operation.result)
        legacy.pop("scope")
        operation.result = legacy
        db.commit()
    recovered = client.get(f"/api/archive/requests/{key}").json()["operation"]
    assert recovered.get("scope") == "SANDBOX"
    with factory() as db:
        assert db.get(ArchiveOperation, bought.json()["id"]).result == legacy


def test_recycling_requires_a_second_copy_in_the_same_scope(community, owner):
    factory, _ = community
    owner_id, client = owner
    card_id = published(factory)
    fund(factory, owner_id, 100)
    assert grant(client, 100).status_code == 200
    real = acquire(client, card_id)
    sandbox = acquire(client, card_id, "SANDBOX")
    assert real.status_code == sandbox.status_code == 200
    for receipt in (real.json(), sandbox.json()):
        item_id = receipt["items"][0]["id"]
        response = client.post(f"/api/archive/items/{item_id}/recycle", json={
            "request_key": str(uuid4()), "scope": receipt["scope"],
        })
        assert response.status_code == 409
    assert acquire(client, card_id, "SANDBOX").status_code == 200
    item_id = sandbox.json()["items"][0]["id"]
    assert client.post(f"/api/archive/items/{item_id}/recycle", json={
        "request_key": str(uuid4()), "scope": "REAL",
    }).status_code == 409
    recycled = client.post(f"/api/archive/items/{item_id}/recycle", json={
        "request_key": str(uuid4()), "scope": "SANDBOX",
    })
    assert recycled.status_code == 200, recycled.text
    assert recycled.json()["balance_after"] == 55
    assert client.get("/api/archive/wallet").json()["balance"] == 75


def test_positive_credits_pay_down_debt_without_enabling_spending(community, owner):
    factory, _ = community
    owner_id, client = owner
    card_id = published(factory)
    with factory() as db:
        db.add(ArchiveLedger(user_id=owner_id, source="correction:fixture", reason="COIN_CORRECTION", delta=-60))
        db.commit()
    credited = grant(client, 20, scope="REAL")
    assert credited.status_code == 200, credited.text
    assert credited.json()["net_balance"] == -40
    assert credited.json()["balance_after"] == 0
    wallet = client.get("/api/archive/wallet").json()
    assert wallet["debt"] == 40 and wallet["available_balance"] == wallet["balance"] == 0
    assert acquire(client, card_id).status_code == 409
    assert grant(client, 70, scope="REAL").status_code == 200
    assert acquire(client, card_id).status_code == 200
    assert client.get("/api/archive/wallet").json()["net_balance"] == 5


def test_real_owner_adjustment_is_explicit_audited_and_can_correct_spent_coins(community, owner):
    factory, _ = community
    owner_id, client = owner
    adjusted = grant(client, -40, scope="REAL")
    assert adjusted.status_code == 200, adjusted.text
    assert adjusted.json()["kind"] == "OWNER_REAL_ADJUSTMENT"
    assert adjusted.json()["debt"] == 40
    assert client.post("/api/owner/archive/tokens", json={
        "request_key": str(uuid4()), "delta": 10, "scope": "REAL", "note": "   ",
    }).status_code == 422
    with factory() as db:
        operation = db.scalar(select(ArchiveOperation).where(ArchiveOperation.user_id == owner_id))
        assert operation.scope == "REAL"
        assert service.balance(db, owner_id, "SANDBOX") == 0


def test_refunds_keep_historical_cost_basis_after_price_change(community):
    factory, player = community
    user_id, client = player()
    card_id = published(factory)
    fund(factory, user_id, 100)
    first = acquire(client, card_id)
    assert first.status_code == 200, first.text
    assert acquire(client, card_id).status_code == 200
    item_id = first.json()["items"][0]["id"]
    with factory() as db:
        db.get(ArchiveItem, item_id).cost_basis = 20
        db.commit()
    recycled = client.post(f"/api/archive/items/{item_id}/recycle", json={"request_key": str(uuid4())})
    assert recycled.status_code == 200, recycled.text
    assert recycled.json()["delta"] == 4 and recycled.json()["balance_after"] == 54


def test_balance_ceiling_rejects_credit_without_creating_operation(community, owner):
    factory, _ = community
    owner_id, client = owner
    fund(factory, owner_id, 1_000_000_000)
    assert grant(client, 1, scope="REAL").status_code == 409
    with factory() as db:
        assert service.balance(db, owner_id) == 1_000_000_000
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == owner_id)) == 0
