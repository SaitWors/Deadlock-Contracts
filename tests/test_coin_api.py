from uuid import uuid4

from sqlalchemy import func, select

from app.models import ArchiveLedger
from test_player_community import community, contract


def test_coin_status_is_retired_without_mutating_historical_wallet(community):
    factory, player = community
    user_id, client = player()
    with factory() as db:
        db.add(ArchiveLedger(user_id=user_id, source="historical", reason="CONTRACT", delta=10))
        db.commit()
    assert client.get("/api/archive/coin-rewards").status_code == 410
    assert client.get("/api/archive/wallet").status_code == 410
    with factory() as db:
        assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user_id)) == 10


def test_historical_contract_receipt_explains_why_coins_are_not_retroactive(community):
    factory, player = community
    user_id, client = player()
    with factory() as db:
        assignment = contract(db, user_id)
        assignment_id = assignment.id
        db.commit()
    response = client.get("/api/history")
    assert response.status_code == 200
    item = next(item for item in response.json()["items"] if item["assignment_id"] == assignment_id)
    assert item["coin_reward"]["reason"] == "NO_SIGNED_POLICY"
    assert item["coin_reward"]["amount"] == 0


def test_player_cannot_correct_coin_rewards(community):
    _, player = community
    _, client = player()
    response = client.post(f"/api/owner/archive/coin-rewards/{uuid4()}/correct",
                           json={"request_key": str(uuid4()), "reason": "Not authorized"})
    assert response.status_code == 403
