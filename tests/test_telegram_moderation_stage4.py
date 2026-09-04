from __future__ import annotations

import ast
import io
import json
import urllib.error
from dataclasses import replace
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import OutboxEvent
from app.services import telegram_moderation as telegram
from app.services.telegram_moderation import (
    TelegramDeliveryError,
    TelegramSendResult,
    queue_review_telegram_event,
    render_review_notification,
)


def _settings(**overrides):
    values = {
        "telegram_moderation_notifications_enabled": True,
        "telegram_bot_token": "telegram-test-token-not-production-shaped",
        "telegram_review_chat_id": "-1001234567890",
        "telegram_review_thread_id": 0,
        "telegram_review_protect_content": True,
        "app_base_url": "https://deadlock-contracts.online",
        "app_version": "0.10.1-alpha.12",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.fixture()
def db():
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with factory() as session:
        yield session


def test_queue_is_feature_flagged_and_payload_is_allowlisted(
    db,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        telegram,
        "settings",
        _settings(telegram_moderation_notifications_enabled=False),
    )
    assert queue_review_telegram_event(
        db,
        "requested",
        review_id="review-1",
        payload={"external_match_id": 123},
    ) is None

    monkeypatch.setattr(telegram, "settings", _settings())
    event = queue_review_telegram_event(
        db,
        "requested",
        review_id="review-1",
        payload={
            "external_match_id": 123,
            "mode": "STANDARD",
            "reason_count": 2,
            "harmless_unknown": "not copied",
        },
    )
    db.commit()

    assert event is not None
    stored = db.scalar(
        select(OutboxEvent).where(OutboxEvent.id == event.id)
    )
    assert stored is not None
    assert stored.event_type == "telegram.review.requested"
    assert stored.payload == {
        "schema_version": 1,
        "review_id": "review-1",
        "external_match_id": 123,
        "mode": "STANDARD",
        "reason_count": 2,
    }


@pytest.mark.parametrize(
    "forbidden",
    [
        "steam_id64",
        "account_id",
        "user_id",
        "device_id",
        "token",
        "context",
        "raw",
    ],
)
def test_queue_rejects_sensitive_payload_keys(
    db,
    monkeypatch,
    forbidden: str,
) -> None:
    monkeypatch.setattr(telegram, "settings", _settings())
    with pytest.raises(ValueError):
        queue_review_telegram_event(
            db,
            "requested",
            review_id="review-sensitive",
            payload={forbidden: "secret"},
        )


def test_render_escapes_dynamic_text_and_uses_admin_deep_link(
    monkeypatch,
) -> None:
    monkeypatch.setattr(telegram, "settings", _settings())
    text, keyboard, silent = render_review_notification(
        "telegram.review.needs_info",
        {
            "review_id": "review/<unsafe>",
            "actor_display_name": "<b>moderator</b>",
            "note": "<script>alert(1)</script>",
        },
    )

    assert "&lt;b&gt;moderator&lt;/b&gt;" in text
    assert "<script>" not in text
    assert "alert(1)" not in text
    assert "Комментарий модератора доступен только" in text
    assert silent is False
    url = keyboard["inline_keyboard"][0][0]["url"]
    assert url.startswith(
        "https://deadlock-contracts.online/admin/reviews/"
    )
    assert "%2F%3Cunsafe%3E" in url


def test_send_message_uses_supported_bot_api_shape(
    monkeypatch,
) -> None:
    captured = {}

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self, _limit):
            return json.dumps(
                {
                    "ok": True,
                    "result": {
                        "message_id": 77,
                        "chat": {"id": -1001234567890},
                    },
                }
            ).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["payload"] = json.loads(
            request.data.decode("utf-8")
        )
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(
        telegram,
        "settings",
        _settings(telegram_review_thread_id=42),
    )
    monkeypatch.setattr(
        telegram.urllib.request,
        "urlopen",
        fake_urlopen,
    )

    result = telegram.send_review_notification(
        "telegram.review.requested",
        {
            "review_id": "review-2",
            "external_match_id": 102030,
            "mode": "STANDARD",
            "reason_count": 1,
        },
    )

    assert result.message_id == 77
    assert result.chat_id == "-1001234567890"
    assert result.skipped is False
    assert captured["timeout"] == 8
    assert captured["url"].endswith("/sendMessage")
    body = captured["payload"]
    assert body["chat_id"] == "-1001234567890"
    assert body["message_thread_id"] == 42
    assert body["parse_mode"] == "HTML"
    assert body["protect_content"] is True
    assert body["link_preview_options"] == {"is_disabled": True}
    assert body["reply_markup"]["inline_keyboard"][0][0]["url"].endswith(
        "/admin/reviews/review-2"
    )


def test_http_error_never_leaks_bot_token(
    monkeypatch,
) -> None:
    token = "telegram-test-secret-that-must-never-leak"
    monkeypatch.setattr(
        telegram,
        "settings",
        _settings(telegram_bot_token=token),
    )

    def fail(request, timeout):
        raise urllib.error.HTTPError(
            request.full_url,
            429,
            "Too Many Requests",
            {},
            io.BytesIO(
                json.dumps(
                    {
                        "ok": False,
                        "description": "Too Many Requests",
                        "parameters": {"retry_after": 137},
                    }
                ).encode("utf-8")
            ),
        )

    monkeypatch.setattr(
        telegram.urllib.request,
        "urlopen",
        fail,
    )

    with pytest.raises(TelegramDeliveryError) as exc:
        telegram.send_review_notification(
            "telegram.review.test",
            {"review_id": "review-3"},
        )
    assert token not in str(exc.value)
    assert "Telegram HTTP 429" in str(exc.value)
    assert exc.value.retry_after_seconds == 137


def test_worker_dispatch_marks_telegram_outbox_published(
    db,
    monkeypatch,
) -> None:
    import app.worker as worker

    monkeypatch.setattr(
        worker,
        "settings",
        replace(
            worker.settings,
            telegram_moderation_notifications_enabled=True,
        ),
    )

    event = OutboxEvent(
        event_type="telegram.review.requested",
        aggregate_id="review-4",
        payload={
            "schema_version": 1,
            "review_id": "review-4",
            "external_match_id": 55,
        },
    )
    db.add(event)
    db.commit()

    monkeypatch.setattr(
        worker,
        "send_review_notification",
        lambda *_args, **_kwargs: TelegramSendResult(
            message_id=99,
            chat_id="-10042",
            skipped=False,
        ),
    )

    assert worker.dispatch_outbox(db) is True
    db.expire_all()
    stored = db.get(OutboxEvent, event.id)
    assert stored is not None
    assert stored.published_at is not None
    assert stored.attempts == 0
    assert stored.payload["telegram_delivery"]["message_id"] == 99
    assert stored.payload["telegram_delivery"]["chat_id"] == "-10042"
    assert stored.payload["telegram_delivery"]["skipped"] is False


def test_worker_telegram_failure_uses_existing_outbox_retry(
    db,
    monkeypatch,
) -> None:
    import app.worker as worker

    monkeypatch.setattr(
        worker,
        "settings",
        replace(
            worker.settings,
            telegram_moderation_notifications_enabled=True,
        ),
    )

    event = OutboxEvent(
        event_type="telegram.review.requested",
        aggregate_id="review-5",
        payload={
            "schema_version": 1,
            "review_id": "review-5",
        },
    )
    db.add(event)
    db.commit()

    def fail(*_args, **_kwargs):
        raise TelegramDeliveryError(
            "Telegram HTTP 429: Too Many Requests"
        )

    monkeypatch.setattr(
        worker,
        "send_review_notification",
        fail,
    )

    assert worker.dispatch_outbox(db) is True
    db.expire_all()
    stored = db.get(OutboxEvent, event.id)
    assert stored is not None
    assert stored.published_at is None
    assert stored.dead_lettered_at is None
    assert stored.attempts == 1
    assert "Telegram HTTP 429" in (stored.last_error or "")


def test_worker_holds_telegram_outbox_while_feature_disabled(
    db,
    monkeypatch,
) -> None:
    import app.worker as worker

    event = OutboxEvent(
        event_type="telegram.review.requested",
        aggregate_id="review-paused",
        payload={
            "schema_version": 1,
            "review_id": "review-paused",
        },
    )
    db.add(event)
    db.commit()

    monkeypatch.setattr(
        worker,
        "settings",
        replace(
            worker.settings,
            telegram_moderation_notifications_enabled=False,
        ),
    )

    def must_not_send(*_args, **_kwargs):
        raise AssertionError("disabled Telegram event must not be sent")

    monkeypatch.setattr(
        worker,
        "send_review_notification",
        must_not_send,
    )

    assert worker.dispatch_outbox(db) is False
    db.expire_all()
    stored = db.get(OutboxEvent, event.id)
    assert stored is not None
    assert stored.published_at is None
    assert stored.dead_lettered_at is None
    assert stored.attempts == 0


def test_worker_missing_telegram_flag_fails_closed(
    db,
    monkeypatch,
) -> None:
    import app.worker as worker

    event = OutboxEvent(
        event_type="telegram.review.requested",
        aggregate_id="review-missing-flag",
        payload={
            "schema_version": 1,
            "review_id": "review-missing-flag",
        },
    )
    db.add(event)
    db.commit()

    minimal_settings = SimpleNamespace(
        reward_settlement_enabled=True,
        discord_review_webhook_url="",
    )
    monkeypatch.setattr(worker, "settings", minimal_settings)

    def must_not_send(*_args, **_kwargs):
        raise AssertionError("missing feature flag must fail closed")

    monkeypatch.setattr(
        worker,
        "send_review_notification",
        must_not_send,
    )

    assert worker.dispatch_outbox(db) is False
    db.expire_all()
    stored = db.get(OutboxEvent, event.id)
    assert stored is not None
    assert stored.published_at is None
    assert stored.dead_lettered_at is None
    assert stored.attempts == 0


def test_stage4_producers_emit_only_outbound_telegram_events() -> None:
    evaluator = open(
        "app/services/evaluator.py",
        encoding="utf-8",
    ).read()
    claims = open(
        "app/services/review_claims.py",
        encoding="utf-8",
    ).read()
    moderation = open(
        "app/services/moderation.py",
        encoding="utf-8",
    ).read()
    worker = open("app/worker.py", encoding="utf-8").read()
    main = open("app/main.py", encoding="utf-8").read()
    telegram_source = open(
        "app/services/telegram_moderation.py",
        encoding="utf-8",
    ).read()

    assert '"requested"' in evaluator
    assert 'queue_review_telegram_event' in evaluator
    assert '"claimed"' in claims
    assert '"released"' in claims
    assert '"needs_info"' in claims
    assert '"decided"' in moderation
    assert (
        "event.event_type.startswith("
        "TELEGRAM_REVIEW_EVENT_PREFIX"
        ")" in worker
    )

    # Stage 4 is deliberately outbound only.
    assert "/api/telegram" not in main
    assert "X-Telegram-Bot-Api-Secret-Token" not in main
    assert "callback_data" not in telegram_source


def test_stage4_config_is_fail_closed_by_default() -> None:
    config = open("app/config.py", encoding="utf-8").read()
    compose = open("compose.prod.yaml", encoding="utf-8").read()

    tree = ast.parse(config)
    setting = None
    for node in ast.walk(tree):
        if not isinstance(node, ast.AnnAssign):
            continue
        if not isinstance(node.target, ast.Name):
            continue
        if node.target.id != "telegram_moderation_notifications_enabled":
            continue
        setting = node
        break

    assert setting is not None
    assert isinstance(setting.value, ast.Call)
    assert isinstance(setting.value.func, ast.Name)
    assert setting.value.func.id == "_bool"
    assert len(setting.value.args) == 2
    assert isinstance(setting.value.args[0], ast.Constant)
    assert setting.value.args[0].value == (
        "TELEGRAM_MODERATION_NOTIFICATIONS_ENABLED"
    )
    assert isinstance(setting.value.args[1], ast.Constant)
    assert setting.value.args[1].value is False

    assert (
        "TELEGRAM_MODERATION_NOTIFICATIONS_ENABLED: "
        "${TELEGRAM_MODERATION_NOTIFICATIONS_ENABLED:-false}"
        in compose
    )
    assert "TELEGRAM_REVIEW_THREAD_ID" in compose
    assert "TELEGRAM_REVIEW_PROTECT_CONTENT" in compose

def test_freeform_needs_info_note_never_enters_telegram_outbox(
    db,
    monkeypatch,
) -> None:
    monkeypatch.setattr(telegram, "settings", _settings())
    event = queue_review_telegram_event(
        db,
        "needs_info",
        review_id="review-private-note",
        payload={
            "actor_display_name": "Moderator",
            "note": "private SteamID/token/debug details must stay on the site",
        },
    )
    db.commit()

    assert event is not None
    stored = db.get(OutboxEvent, event.id)
    assert stored is not None
    assert "note" not in stored.payload
    text, _keyboard, _silent = render_review_notification(
        stored.event_type,
        stored.payload,
    )
    assert "SteamID" not in text
    assert "token" not in text
    assert "Комментарий модератора доступен только" in text

def test_worker_telegram_retry_after_extends_outbox_delay(
    db,
    monkeypatch,
) -> None:
    import app.worker as worker

    monkeypatch.setattr(
        worker,
        "settings",
        replace(
            worker.settings,
            telegram_moderation_notifications_enabled=True,
        ),
    )
    fixed_now = worker.utcnow()
    monkeypatch.setattr(worker, "utcnow", lambda: fixed_now)

    event = OutboxEvent(
        event_type="telegram.review.requested",
        aggregate_id="review-rate-limit",
        payload={
            "schema_version": 1,
            "review_id": "review-rate-limit",
        },
        run_after=fixed_now,
    )
    db.add(event)
    db.commit()

    def fail(*_args, **_kwargs):
        raise TelegramDeliveryError(
            "Telegram HTTP 429: Too Many Requests",
            retry_after_seconds=137,
        )

    monkeypatch.setattr(worker, "send_review_notification", fail)

    assert worker.dispatch_outbox(db) is True
    db.expire_all()
    stored = db.get(OutboxEvent, event.id)
    assert stored is not None
    assert stored.published_at is None
    assert stored.attempts == 1
    assert stored.run_after is not None
    run_after = worker.aware(stored.run_after)
    baseline = worker.aware(fixed_now)
    assert run_after is not None
    assert baseline is not None
    assert (run_after - baseline).total_seconds() >= 137

def test_stage4_auto_resolution_producers_emit_terminal_telegram_event() -> None:
    evaluator = open("app/services/evaluator.py", encoding="utf-8").read()
    worker = open("app/worker.py", encoding="utf-8").read()

    assert '"source": "provider_refresh"' in evaluator
    assert '"source": "provider_auto_settlement"' in worker
    assert "queue_review_telegram_event(" in evaluator
    assert "queue_review_telegram_event(" in worker
