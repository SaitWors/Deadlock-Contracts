from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import ArchiveCard, ArchiveItem, ArchiveLedger, ArchiveOperation, User
from app.services import archive_packs as service, coin_rewards, extra_coin_rewards
from test_archive_packs import owner, pack, published
from test_player_community import community


def claim(client, key=None):
    return client.post('/api/archive/daily-pack/claim', json={'scope': 'REAL', 'idempotency_key': key or str(uuid4())})


def test_daily_free_replays_receipt_and_keeps_wallet_unchanged(community, owner):
    factory, player = community
    uid, client = player(); _, other = player()
    pack(owner[1], published(factory))
    before = client.get('/api/archive/daily-pack').json()
    assert before['available'] and before['claimed_at'] is None and before['pack']['price'] == 0
    key = str(uuid4())
    response = claim(client, key)
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert receipt['kind'] == 'DAILY_PACK' and receipt['delta'] == 0 and len(receipt['items']) == 2
    assert claim(client, key).json() == receipt
    assert claim(client).json() == receipt
    assert client.get('/api/archive/requests/' + key).json()['operation'] == receipt
    assert other.get('/api/archive/requests/' + key).json()['operation'] is None
    status = client.get('/api/archive/daily-pack').json()
    assert not status['available'] and status['operation_id'] == receipt['id'] and status['claimed_at']
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == uid)) == 2
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == uid, ArchiveOperation.kind == "DAILY_PACK")) == 1
        assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == uid)) == 0


def test_daily_utc_midnight_and_response_loss_replay(community, owner, monkeypatch):
    factory, player = community
    uid, client = player(); pack(owner[1], published(factory))
    monkeypatch.setattr(service, 'utcnow', lambda: datetime(2026, 11, 2, 23, 59, 59, tzinfo=timezone.utc))
    key = str(uuid4()); first = claim(client, key).json()
    assert client.get('/api/archive/daily-pack').json()['next_reset_at'] == '2026-11-03T00:00:00+00:00'
    monkeypatch.setattr(service, 'utcnow', lambda: datetime(2026, 11, 3, tzinfo=timezone.utc))
    assert client.get('/api/archive/daily-pack').json()['available']
    assert claim(client, key).json() == first
    assert client.get('/api/archive/daily-pack').json()['available']
    second = claim(client).json()
    assert second['id'] != first['id']
    assert claim(client).json() == second


def test_missing_or_withdrawn_pool_does_not_consume_entitlement(community, owner):
    factory, player = community
    uid, client = player(); key = str(uuid4())
    assert client.get('/api/archive/daily-pack').json()['available'] is False
    assert claim(client, key).status_code == 409
    cid = published(factory); pack(owner[1], cid)
    with factory() as db:
        db.get(ArchiveCard, cid).status = 'DRAFT'; db.commit()
    assert claim(client, key).status_code == 409
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == uid)) == 0
        db.get(ArchiveCard, cid).status = 'PUBLISHED'; db.commit()
    assert claim(client, key).status_code == 200


def test_daily_requires_auth_csrf_and_active_account(community, owner):
    factory, player = community
    uid, client = player(); pack(owner[1], published(factory))
    with TestClient(app) as anonymous:
        assert anonymous.get('/api/archive/daily-pack').status_code == 401
        assert claim(anonymous).status_code in (401, 403)
    token = client.headers.pop('X-CSRF-Token')
    assert claim(client).status_code == 403
    client.headers['X-CSRF-Token'] = token
    with factory() as db:
        db.get(User, uid).status = 'BLOCKED'; db.commit()
    assert claim(client).status_code in (401, 403)


def test_economy_retired_and_admin_collection_preserved(community, owner):
    factory, player = community
    _, client = player(); cid = published(factory); item = pack(owner[1], cid)
    for method, path, body in [
        ('get', '/api/archive/wallet', None), ('get', '/api/archive/cards', None),
        ('get', '/api/archive/coverage', None), ('get', '/api/archive/coin-rewards', None),
        ('post', '/api/archive/cipher', {}),
        ('post', f'/api/archive/cards/{cid}/acquire', {'request_key': str(uuid4()), 'expected_price': 25}),
        ('post', f'/api/archive/packs/{item["id"]}/open', {'request_key': str(uuid4()), 'revision': 1}),
        ('post', f'/api/archive/items/{uuid4()}/recycle', {'request_key': str(uuid4())}),
        ('post', '/api/arena/starter', {'request_key': str(uuid4()), 'scope': 'REAL'}),
    ]:
        result = client.request(method, path, json=body)
        assert result.status_code == 410, (path, result.text)
    assert client.get('/api/archive/inventory').status_code == 200
    assert client.get(f'/api/archive/cards/{cid}/image').status_code == 200
    assert owner[1].get('/api/owner/archive/packs').status_code == 200


def test_coin_public_issuance_paths_disabled_centrally(community):
    factory, player = community
    uid, _ = player()
    with factory() as db:
        # Retirement applies regardless of stale flags, queued delivery, or caller.
        assert coin_rewards.snapshot_signing(db, None) == 0
        assert coin_rewards.settle_assignment(db, str(uuid4())) is None
        assert coin_rewards.deliver_entitlement(db, str(uuid4())) is None
        assert extra_coin_rewards.reserve(db, uid, 'cipher', 'old', 10, datetime.now(timezone.utc), []) is None


def test_all_legacy_reward_entrypoints_are_noops(community):
    factory, _ = community
    with factory() as db:
        assert extra_coin_rewards.record_cipher(db, None) is None
        assert extra_coin_rewards.record_contract(db, None) is None
        assert extra_coin_rewards.settle_battle(db, None) is None
        assert extra_coin_rewards.record_assignment(db, str(uuid4())) is None
        assert extra_coin_rewards.record_bureau(db, None) is None


@pytest.mark.parametrize("same_key", [False, True])
def test_concurrent_claims_share_one_receipt(community, owner, tmp_path, monkeypatch, same_key):
    from threading import Barrier
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.db import Base

    factory, player = community
    uid, _ = player(); pack(owner[1], published(factory))
    # A real shared database uses separate connections (StaticPool cannot model
    # concurrent transactions). Copy the fixture database including pool/user.
    engine = create_engine('sqlite:///' + str(tmp_path / 'concurrent.db'), connect_args={'timeout': 20})
    Base.metadata.create_all(engine)
    factory.kw['bind'].raw_connection().driver_connection.backup(engine.raw_connection().driver_connection)
    concurrent_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    gate = Barrier(2)
    original = service._daily_pool
    def synchronized(db, **kw):
        result = original(db, **kw)
        if kw.get('lock'):
            gate.wait(timeout=10)
        return result
    monkeypatch.setattr(service, '_daily_pool', synchronized)
    key = uuid4()
    def request(_):
        with concurrent_factory() as db:
            return service.claim_daily_pack(db, uid, key if same_key else uuid4())
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(request, range(2)))
        assert results[0] == results[1]
        with concurrent_factory() as db:
            assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == uid)) == 2
            assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == uid, ArchiveOperation.kind == "DAILY_PACK")) == 1
    finally:
        engine.dispose()


def test_daily_scope_and_request_key_boundaries(community, owner):
    factory, player = community
    uid, client = player(); pack(owner[1], published(factory))
    assert client.get('/api/archive/daily-pack?scope=SANDBOX').status_code == 422
    assert client.post('/api/archive/daily-pack/claim', json={'scope': 'SANDBOX', 'idempotency_key': str(uuid4())}).status_code == 422
    assert client.post('/api/archive/daily-pack/claim', json={'scope': 'REAL', 'idempotency_key': 'not-a-uuid'}).status_code == 422
    key = str(uuid4())
    with factory() as db:
        db.add(ArchiveOperation(user_id=uid, request_key=key, signature='0' * 64, kind='OWNER_TOKENS', scope='REAL'))
        db.commit()
    assert claim(client, key).status_code == 409
    assert client.get('/api/archive/daily-pack').json()['available']


def test_daily_v2_reuses_slots_without_changing_paid_guarantees(community, monkeypatch):
    from app.pack_models import PackGuaranteeState
    from test_pack_v2 import create_v2

    factory, player = community
    uid, client = player(); create_v2(factory, 'SPECIAL_FOLDER')
    with factory() as db:
        db.add(PackGuaranteeState(user_id=uid, scope='REAL', without_a=29, without_s=119, without_sss=359, revision=7))
        db.commit()
    monkeypatch.setattr(service.secrets, 'randbelow', lambda total: 0)
    result = claim(client)
    assert result.status_code == 200, result.text
    receipt = result.json()
    assert len(receipt['items']) == 5 and receipt['pack']['price'] == 0
    assert [item['card']['rank'] for item in receipt['items']] == ['F', 'F', 'F', 'F', 'B']
    assert all(item['recycle_value'] == 0 for item in receipt['items'])
    with factory() as db:
        state = db.scalar(select(PackGuaranteeState).where(PackGuaranteeState.user_id == uid))
        assert (state.without_a, state.without_s, state.without_sss, state.revision) == (29, 119, 359, 7)
        assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == uid)) == 0


def test_claim_receipt_replays_after_release_withdrawn(community, owner):
    from app.models import ArchivePack
    factory, player = community
    _, client = player(); cid = published(factory); release = pack(owner[1], cid)
    key = str(uuid4()); receipt = claim(client, key).json()
    with factory() as db:
        db.get(ArchivePack, release['id']).active = False
        db.get(ArchiveCard, cid).status = 'ARCHIVED'
        db.commit()
    assert claim(client, key).json() == receipt
    assert claim(client).json() == receipt
    state = client.get('/api/archive/daily-pack').json()
    assert not state['available'] and state['operation_id'] == receipt['id']
    assert state['pack'] is None


def test_queued_legacy_coin_entitlement_stays_historical(community):
    from app.coin_models import CoinEntitlement
    factory, player = community
    uid, _ = player()
    with factory() as db:
        row = CoinEntitlement(user_id=uid, source_type='assignment', source_id=str(uuid4()),
            policy_version='coins-v1', nominal_amount=10, amount=10, eligible=True, reason='AWARDED', status='RESERVED')
        db.add(row); db.commit(); entitlement_id = row.id
        assert coin_rewards.deliver_entitlement(db, entitlement_id) is None
        db.commit()
        db.refresh(row)
        assert row.amount == 10 and row.status == 'RESERVED' and row.delivered_at is None
        assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == uid)) == 0


def test_daily_is_independent_of_legacy_wallet_limits(community, owner):
    from app.services.archive import MAX_BALANCE
    factory, player = community
    uid, client = player(); pack(owner[1], published(factory))
    with factory() as db:
        db.add(ArchiveLedger(user_id=uid, source='legacy-overflow', reason='TEST', delta=MAX_BALANCE + 1))
        db.commit()
    result = claim(client)
    assert result.status_code == 200, result.text
    assert result.json()['delta'] == 0
    with factory() as db:
        assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == uid)) == MAX_BALANCE + 1


def test_legacy_admin_correction_remains_append_only_and_idempotent(community, owner):
    from app.coin_models import CoinCorrection, CoinEntitlement
    factory, player = community
    uid, _ = player()
    with factory() as db:
        row = CoinEntitlement(user_id=uid, source_type='assignment', source_id=str(uuid4()),
            policy_version='coins-v1', nominal_amount=10, amount=10, eligible=True, reason='AWARDED', status='DELIVERED')
        db.add(row); db.flush(); entitlement_id = row.id
        db.add(ArchiveLedger(user_id=uid, source='historical-credit', reason='CONTRACT', delta=10))
        db.commit()
    payload = {'request_key': str(uuid4()), 'reason': 'Correct legacy decision'}
    url = f'/api/owner/archive/coin-rewards/{entitlement_id}/correct'
    result = owner[1].post(url, json=payload)
    assert result.status_code == 200, result.text
    assert result.json()['delta'] == -10
    assert owner[1].post(url, json=payload).json() == result.json()
    with factory() as db:
        row = db.get(CoinEntitlement, entitlement_id)
        assert row.status == 'CORRECTED' and row.amount == 10
        assert db.scalar(select(func.count()).select_from(CoinCorrection)) == 1
        assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == uid)) == 0


def test_failed_inventory_transaction_leaves_daily_claim_retryable(community, owner, monkeypatch):
    factory, player = community
    uid, client = player(); pack(owner[1], published(factory)); key = str(uuid4())
    original = service.finish
    def interrupted(*args, **kwargs):
        raise RuntimeError('delivery interrupted before commit')
    monkeypatch.setattr(service, 'finish', interrupted)
    with pytest.raises(RuntimeError, match='interrupted'):
        claim(client, key)
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveOperation).where(ArchiveOperation.user_id == uid)) == 0
        assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == uid)) == 0
    assert client.get('/api/archive/daily-pack').json()['available']
    monkeypatch.setattr(service, 'finish', original)
    assert claim(client, key).status_code == 200


def test_owner_cannot_issue_real_currency(community, owner):
    factory, _ = community
    uid, client = owner
    result = client.post('/api/owner/archive/tokens', json={'request_key': str(uuid4()), 'delta': 100, 'scope': 'REAL', 'note': 'Obsolete currency'})
    assert result.status_code == 410
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == uid)) == 0


def test_replay_alias_survives_response_loss_across_midnight(community, owner, monkeypatch):
    factory, player = community
    uid, client = player(); pack(owner[1], published(factory))
    monkeypatch.setattr(service, 'utcnow', lambda: datetime(2026, 11, 2, 23, 59, tzinfo=timezone.utc))
    key_a, key_b, key_c = str(uuid4()), str(uuid4()), str(uuid4())
    first = claim(client, key_a).json()
    assert claim(client, key_b).json() == first  # Response B can be lost in transit.
    assert client.get('/api/archive/openings').json()['total'] == 1
    monkeypatch.setattr(service, 'utcnow', lambda: datetime(2026, 11, 3, tzinfo=timezone.utc))
    assert claim(client, key_b).json() == first
    assert client.get(f'/api/archive/requests/{key_b}').json()['operation'] == first
    assert client.get('/api/archive/daily-pack').json()['available']
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == uid)) == 2
    fresh = claim(client, key_c).json()
    assert fresh['id'] != first['id'] and fresh['claim_day'] == '2026-11-03'
    assert client.get('/api/archive/openings').json()['total'] == 2


def test_winner_committing_between_lookup_and_begin_cannot_issue_twice(community, owner, monkeypatch):
    factory, player = community
    uid, client = player(); pack(owner[1], published(factory)); key = str(uuid4())
    original = service.begin
    pending = True
    def commit_winner_first(db, user_id, kind, request_key, inputs, **kwargs):
        nonlocal pending
        if kind == 'DAILY_PACK' and pending:
            pending = False
            service.claim_daily_pack(db, user_id, request_key, kwargs['scope'])
        return original(db, user_id, kind, request_key, inputs, **kwargs)
    monkeypatch.setattr(service, 'begin', commit_winner_first)
    result = claim(client, key)
    assert result.status_code == 200, result.text
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == uid)) == 2
