from __future__ import annotations

import hashlib
import urllib.parse
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import AuditLog, TelegramLinkToken, TelegramModeratorBinding, User
from app.services import telegram_binding as binding
from app.services.telegram_binding import TelegramBindingError

@pytest.fixture()
def db():
    engine=create_engine("sqlite+pysqlite:///:memory:", future=True)
    factory=sessionmaker(bind=engine, expire_on_commit=False, future=True)
    Base.metadata.create_all(engine)
    with factory() as session:
        yield session

@pytest.fixture()
def fake_settings(monkeypatch):
    settings=SimpleNamespace(
        telegram_bot_username="DeadlockContractsTestBot",
        telegram_link_token_ttl_minutes=10,
        admin_steam_ids=(),
    )
    monkeypatch.setattr(binding, "settings", settings)
    return settings

def make_user(db, steam_id64:int, role:str="MODERATOR"):
    user=User(
        steam_id64=steam_id64,
        display_name="Moderator",
        status="ACTIVE",
        access_role=role,
    )
    db.add(user); db.commit()
    return user

def token_from_link(url:str)->str:
    parsed=urllib.parse.urlparse(url)
    payload=urllib.parse.parse_qs(parsed.query)["start"][0]
    assert payload.startswith("link_")
    assert len(payload)<=64
    assert set(payload)<=set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
    return payload.removeprefix("link_")

def test_link_token_stores_only_sha256(db,fake_settings):
    user=make_user(db,76561198000000001)
    link=binding.create_link_token(db,user_id=user.id)
    raw=token_from_link(link.link_url)
    row=db.scalar(select(TelegramLinkToken))
    assert row is not None
    assert row.token_hash==hashlib.sha256(raw.encode()).hexdigest()
    assert row.token_hash!=raw
    audit=db.scalar(select(AuditLog).where(AuditLog.action=="telegram.link_token_created"))
    assert audit is not None
    assert raw not in repr(audit.data)

def test_consume_is_one_time(db,fake_settings):
    user=make_user(db,76561198000000002)
    raw=token_from_link(binding.create_link_token(db,user_id=user.id).link_url)
    item=binding.consume_link_token(db,raw_token=raw,telegram_user_id=123456789,telegram_username="@reviewer")
    assert item.telegram_username=="reviewer"
    with pytest.raises(TelegramBindingError) as exc:
        binding.consume_link_token(db,raw_token=raw,telegram_user_id=123456789)
    assert exc.value.code=="LINK_TOKEN_ALREADY_USED"

def test_non_moderator_cannot_create_link(db,fake_settings):
    user=make_user(db,76561198000000003,role="PLAYER")
    with pytest.raises(TelegramBindingError) as exc:
        binding.create_link_token(db,user_id=user.id)
    assert exc.value.code=="STAFF_ROLE_REQUIRED"


def test_owner_allowlist_can_create_link(db,fake_settings):
    owner=make_user(db,76561198000000008,role="PLAYER")
    fake_settings.admin_steam_ids=(str(owner.steam_id64),)
    link=binding.create_link_token(db,user_id=owner.id)
    assert token_from_link(link.link_url)

def test_self_revoke(db,fake_settings):
    user=make_user(db,76561198000000004)
    raw=token_from_link(binding.create_link_token(db,user_id=user.id).link_url)
    binding.consume_link_token(db,raw_token=raw,telegram_user_id=999333111)
    assert binding.revoke_self_binding(db,user_id=user.id) is True
    assert binding.active_binding(db,user.id) is None
    assert binding.revoke_self_binding(db,user_id=user.id) is False


def test_revoke_invalidates_unused_link_token(db,fake_settings):
    user=make_user(db,76561198000000009)
    raw=token_from_link(binding.create_link_token(db,user_id=user.id).link_url)
    assert binding.revoke_self_binding(db,user_id=user.id) is False
    row=db.scalar(select(TelegramLinkToken).where(
        TelegramLinkToken.token_hash==hashlib.sha256(raw.encode()).hexdigest()
    ))
    assert row is not None
    assert row.used_at is not None

def test_status_never_exposes_token(db,fake_settings):
    user=make_user(db,76561198000000005)
    binding.create_link_token(db,user_id=user.id)
    payload=binding.binding_status(db,user_id=user.id)
    assert "token" not in repr(payload).lower()

def test_stage5a_inbound_disabled():
    main=open("app/main.py",encoding="utf-8").read()
    stage4=open("app/services/telegram_moderation.py",encoding="utf-8").read()
    assert main.count('_require_permission("telegram.bind_self")')>=3
    assert "ROLE_REMOVED" in main
    assert "ACCOUNT_SUSPENDED" in main
    assert "/api/integrations/telegram/webhook" not in main
    assert "callback_data" not in stage4

def test_migration_linear():
    text=open("alembic/versions/0012_telegram_binding_foundation.py",encoding="utf-8").read()
    assert 'revision: str = "0012"' in text
    assert '"0011"' in text
    for table in (
        "telegram_moderator_bindings",
        "telegram_link_tokens",
        "notification_deliveries",
        "telegram_update_receipts",
        "moderation_decision_drafts",
    ):
        assert f'"{table}"' in text
    assert '"uq_telegram_moderator_bindings_active_user"' in text
