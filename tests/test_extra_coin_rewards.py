"""Retired issuance never creates new activity entitlements or currency."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.coin_models import CoinEntitlement, CoinQuota
from app.economy_models import EconomyActivity
from app.models import ArchiveLedger, OutboxEvent, User
from app.services import extra_coin_rewards as service


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'extra.db'}")
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as session:
        yield session
    engine.dispose()


@pytest.mark.parametrize("entrypoint", ["record_cipher", "record_contract", "settle_battle", "record_assignment", "record_bureau"])
def test_legacy_public_issuance_hooks_are_noops(db, entrypoint):
    user=User(); db.add(user); db.flush()
    assert getattr(service, entrypoint)(db, None) is None
    for model in (CoinEntitlement, CoinQuota, EconomyActivity, ArchiveLedger, OutboxEvent):
        assert db.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize("kind", sorted(service.KINDS))
def test_every_legacy_reward_source_is_disabled_centrally(db, kind):
    user=User(); db.add(user); db.flush()
    assert service.reserve(db,user.id,kind,str(uuid4()),100,datetime.now(timezone.utc),[],daily_limit=100,weekly_limit=100) is None
    assert db.scalar(select(func.count()).select_from(CoinEntitlement)) == 0
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == 0
    assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 0
