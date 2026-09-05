from __future__ import annotations

import urllib.parse
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import (
    TelegramLinkToken,
    TelegramModeratorBinding,
    TelegramUpdateReceipt,
    User,
)
from app.services import telegram_binding as binding
from app.services import telegram_webhook as webhook


@pytest.fixture()
def db():
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with factory() as session:
        yield session


@pytest.fixture()
def fake_settings(monkeypatch):
    settings = SimpleNamespace(
        admin_steam_ids=(),
        telegram_bot_username="DeadlockContractsTestBot",
        telegram_link_token_ttl_minutes=10,
        telegram_webhook_secret="stage5b-test-webhook-secret-value-safe",
    )
    monkeypatch.setattr(binding, "settings", settings)
    monkeypatch.setattr(webhook, "settings", settings)
    return settings


def make_staff(db, steam_id64: int) -> User:
    user = User(
        steam_id64=steam_id64,
        display_name="Moderator",
        status="ACTIVE",
        access_role="MODERATOR",
    )
    db.add(user)
    db.commit()
    return user


def token_from_link(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    payload = urllib.parse.parse_qs(parsed.query)["start"][0]
    assert payload.startswith("link_")
    return payload.removeprefix("link_")


def private_start_update(update_id: int, raw_token: str, *, telegram_user_id: int = 123456789) -> dict:
    return {
        "update_id": update_id,
        "message": {
            "message_id": 100,
            "date": 1_700_000_000,
            "chat": {"id": telegram_user_id, "type": "private"},
            "from": {
                "id": telegram_user_id,
                "is_bot": False,
                "first_name": "Reviewer",
                "username": "reviewer",
            },
            "text": f"/start link_{raw_token}",
        },
    }


def test_webhook_secret_compare(fake_settings):
    assert webhook.verify_webhook_secret("stage5b-test-webhook-secret-value-safe")
    assert not webhook.verify_webhook_secret("stage5b-test-webhook-secret-value-wrong")
    assert not webhook.verify_webhook_secret("")
    assert not webhook.verify_webhook_secret(None)


def test_private_start_consumes_token_and_creates_binding_once(db, fake_settings):
    user = make_staff(db, 76561198000000101)
    link = binding.create_link_token(db, user_id=user.id)
    raw_token = token_from_link(link.link_url)

    result = webhook.process_update(db, private_start_update(1001, raw_token))
    assert result == {"ok": True, "processed": True, "state": "PROCESSED"}

    receipt = db.get(TelegramUpdateReceipt, 1001)
    assert receipt is not None
    assert receipt.state == "PROCESSED"
    assert receipt.error_code is None
    assert receipt.processed_at is not None

    active = db.scalar(
        select(TelegramModeratorBinding).where(
            TelegramModeratorBinding.user_id == user.id,
            TelegramModeratorBinding.revoked_at.is_(None),
        )
    )
    assert active is not None
    assert active.telegram_user_id == 123456789

    duplicate = webhook.process_update(db, private_start_update(1001, raw_token))
    assert duplicate["ok"] is True
    assert duplicate["duplicate"] is True

    count = db.scalar(
        select(func.count()).select_from(TelegramModeratorBinding).where(
            TelegramModeratorBinding.user_id == user.id,
            TelegramModeratorBinding.revoked_at.is_(None),
        )
    )
    assert count == 1


def test_bad_link_is_final_rejection_without_token_leak(db, fake_settings):
    result = webhook.process_update(db, private_start_update(1002, "A" * 43, telegram_user_id=222333444))
    assert result["state"] == "REJECTED"
    receipt = db.get(TelegramUpdateReceipt, 1002)
    assert receipt is not None
    assert receipt.error_code == "INVALID_LINK_TOKEN"
    assert "A" * 43 not in repr(receipt.error_code)


def test_group_start_is_ignored_and_token_remains_unused(db, fake_settings):
    user = make_staff(db, 76561198000000102)
    link = binding.create_link_token(db, user_id=user.id)
    raw_token = token_from_link(link.link_url)
    update = private_start_update(1003, raw_token)
    update["message"]["chat"]["type"] = "supergroup"
    result = webhook.process_update(db, update)
    assert result["state"] == "IGNORED"
    token_row = db.scalar(select(TelegramLinkToken))
    assert token_row is not None and token_row.used_at is None
    assert db.scalar(select(func.count()).select_from(TelegramModeratorBinding)) == 0


def test_callback_query_is_ignored_in_stage5b(db, fake_settings):
    result = webhook.process_update(db, {"update_id": 1004, "callback_query": {"id": "future-callback"}})
    assert result["state"] == "IGNORED"
    receipt = db.get(TelegramUpdateReceipt, 1004)
    assert receipt is not None
    assert receipt.update_type == "callback_query"
    assert receipt.state == "IGNORED"


def test_bot_suffix_must_match_configured_bot(db, fake_settings):
    user = make_staff(db, 76561198000000103)
    link = binding.create_link_token(db, user_id=user.id)
    raw_token = token_from_link(link.link_url)
    update = private_start_update(1005, raw_token)
    update["message"]["text"] = f"/start@AnotherBot link_{raw_token}"
    result = webhook.process_update(db, update)
    assert result["state"] == "IGNORED"


def test_stage5b_route_and_binding_path_remain_present_after_later_stages():
    main = open("app/main.py", encoding="utf-8").read()
    binding_source = open("app/services/telegram_binding.py", encoding="utf-8").read()
    webhook_source = open("app/services/telegram_webhook.py", encoding="utf-8").read()
    assert '"/api/integrations/telegram/webhook"' in main
    assert "X-Telegram-Bot-Api-Secret-Token" in main
    assert "telegram_webhook_max_body_bytes" in main
    assert "consume_link_token" in webhook_source
    assert "callback_data" not in binding_source
    assert "decide_review" not in binding_source
