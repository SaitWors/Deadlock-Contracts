from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import (
    AuditLog,
    OutboxEvent,
    SystemAnnouncement,
    SystemAnnouncementReceipt,
    User,
)
from app.services import announcements as service
from app.services import telegram_announcements as telegram
from app.services.permissions import role_has_permission


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with factory() as session:
        yield session


@pytest.fixture()
def announcement_settings(monkeypatch):
    configured = SimpleNamespace(
        announcements_enabled=True,
        announcements_site_enabled=True,
        announcements_companion_enabled=True,
        announcements_telegram_mirror_enabled=False,
        announcements_poll_seconds=60,
        announcements_max_active=5,
        announcements_max_duration_days=30,
        app_base_url="https://deadlock-contracts.example",
        telegram_review_chat_id="-1001234567890",
        telegram_system_thread_id=0,
        telegram_review_protect_content=True,
        telegram_bot_token="test-token",
        app_version="test",
    )
    monkeypatch.setattr(service, "settings", configured)
    monkeypatch.setattr(telegram, "settings", configured)
    return configured


@pytest.fixture()
def users(db):
    owner = User(
        steam_id64=76561198000004001,
        account_id=4001,
        display_name="Owner",
        access_role="ADMIN",
    )
    player = User(
        steam_id64=76561198000004002,
        account_id=4002,
        display_name="Player",
        access_role="PLAYER",
    )
    tester = User(
        steam_id64=76561198000004003,
        account_id=4003,
        display_name="Tester",
        access_role="TESTER",
    )
    moderator = User(
        steam_id64=76561198000004004,
        account_id=4004,
        display_name="Moderator",
        access_role="MODERATOR",
    )
    db.add_all([owner, player, tester, moderator])
    db.commit()
    return owner, player, tester, moderator


def draft_payload(**overrides):
    payload = {
        "severity": "INFO",
        "presentation": "BANNER",
        "effect": "FADE_SLIDE",
        "dismiss_policy": "DISMISSIBLE",
        "title_ru": "Плановые работы",
        "body_ru": "Сервис может быть недоступен несколько минут.",
        "title_en": "Scheduled maintenance",
        "body_en": "The service may be unavailable for a few minutes.",
        "cta_label_ru": "Подробнее",
        "cta_label_en": "Learn more",
        "cta_url": "/status",
        "surfaces": ["SITE_PUBLIC", "SITE_DASHBOARD"],
        "audiences": ["ALL"],
        "priority": 50,
        "show_countdown": True,
    }
    payload.update(overrides)
    return payload


def publish_now(db, owner, *, now, **overrides):
    item = service.create_draft(
        db,
        actor=owner,
        payload=draft_payload(**overrides),
    )
    return service.publish(
        db,
        actor=owner,
        announcement_id=item.id,
        expected_revision=item.revision,
        starts_at=now - timedelta(minutes=1),
        ends_at=now + timedelta(hours=1),
        reason="Automated lifecycle test",
    )


def test_lifecycle_targeting_priority_and_time_boundaries(
    db,
    users,
    announcement_settings,
):
    owner, player, tester, moderator = users
    now = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)

    public = publish_now(db, owner, now=now, priority=40)
    tester_only = publish_now(
        db,
        owner,
        now=now,
        title_ru="Сообщение тестерам",
        title_en="Tester notice",
        audiences=["TESTERS"],
        priority=90,
    )
    staff_only = publish_now(
        db,
        owner,
        now=now,
        title_ru="Сообщение staff",
        title_en="Staff notice",
        audiences=["STAFF"],
        priority=80,
    )
    scheduled = service.create_draft(
        db,
        actor=owner,
        payload=draft_payload(title_ru="Будущее", title_en="Future"),
    )
    scheduled = service.publish(
        db,
        actor=owner,
        announcement_id=scheduled.id,
        expected_revision=scheduled.revision,
        starts_at=now + timedelta(minutes=1),
        ends_at=now + timedelta(hours=1),
        reason="Schedule boundary test",
    )

    anonymous = service.active_announcements(
        db,
        user=None,
        surface="SITE_PUBLIC",
        locale="ru",
        now=now,
    )
    assert [item["id"] for item in anonymous] == [public.id]

    tester_items = service.active_announcements(
        db,
        user=tester,
        effective_role="TESTER",
        surface="SITE_PUBLIC",
        locale="en",
        now=now,
    )
    assert [item["id"] for item in tester_items] == [tester_only.id, public.id]
    assert tester_items[0]["title"] == "Tester notice"

    staff_items = service.active_announcements(
        db,
        user=moderator,
        effective_role="MODERATOR",
        surface="SITE_PUBLIC",
        locale="ru",
        now=now,
    )
    assert [item["id"] for item in staff_items] == [staff_only.id, public.id]
    assert service.compute_phase(scheduled, now) == "SCHEDULED"
    assert service.compute_phase(scheduled, scheduled.starts_at) == "ACTIVE"
    assert service.compute_phase(scheduled, scheduled.ends_at) == "EXPIRED"

    player_items = service.active_announcements(
        db,
        user=player,
        effective_role="PLAYER",
        surface="SITE_PUBLIC",
        locale="ru",
        now=now,
    )
    assert [item["id"] for item in player_items] == [public.id]

    announcement_settings.announcements_enabled = False
    assert (
        service.active_announcements(
            db,
            user=player,
            effective_role="PLAYER",
            surface="SITE_PUBLIC",
            locale="ru",
            now=now,
        )
        == []
    )
    announcement_settings.announcements_enabled = True

    by_author = service.list_admin_announcements(
        db,
        author="Owner",
        now=now,
    )
    assert by_author["total"] == 4
    assert (
        service.list_admin_announcements(
            db,
            author="missing author",
            now=now,
        )["items"]
        == []
    )


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"audiences": ["ALL", "STAFF"]}, "ANNOUNCEMENT_AUDIENCE_CONFLICT"),
        ({"cta_url": "javascript:alert(1)"}, "ANNOUNCEMENT_CTA_URL_INVALID"),
        (
            {"cta_url": "https://deadlock-contracts.example:444/status"},
            "ANNOUNCEMENT_CTA_URL_INVALID",
        ),
        ({"body_ru": "<script>alert(1)</script>"}, "ANNOUNCEMENT_HTML_FORBIDDEN"),
        (
            {"severity": "CRITICAL", "effect": "CONFETTI_ONCE"},
            "ANNOUNCEMENT_EFFECT_CONFLICT",
        ),
        (
            {"presentation": "MODAL", "surfaces": ["COMPANION_OVERLAY"]},
            "ANNOUNCEMENT_PRESENTATION_CONFLICT",
        ),
        (
            {"severity": "INFO", "dismiss_policy": "NON_DISMISSIBLE"},
            "ANNOUNCEMENT_DISMISS_POLICY_CONFLICT",
        ),
    ],
)
def test_validation_rejects_unsafe_or_conflicting_drafts(
    announcement_settings,
    overrides,
    code,
):
    with pytest.raises(service.AnnouncementError) as exc:
        service.validate_draft(draft_payload(**overrides))
    assert exc.value.code == code


def test_publication_window_rejects_invalid_and_excessive_duration(
    db,
    users,
    announcement_settings,
):
    owner, _, _, _ = users
    item = service.create_draft(db, actor=owner, payload=draft_payload())
    now = datetime.now(timezone.utc)

    with pytest.raises(service.AnnouncementError) as inverted:
        service.publish(
            db,
            actor=owner,
            announcement_id=item.id,
            expected_revision=item.revision,
            starts_at=now,
            ends_at=now,
            reason="Invalid window test",
        )
    assert inverted.value.code == "ANNOUNCEMENT_WINDOW_INVALID"

    with pytest.raises(service.AnnouncementError) as excessive:
        service.publish(
            db,
            actor=owner,
            announcement_id=item.id,
            expected_revision=item.revision,
            starts_at=now,
            ends_at=now + timedelta(days=31),
            reason="Excessive duration test",
        )
    assert excessive.value.code == "ANNOUNCEMENT_DURATION_TOO_LONG"


def test_public_payload_is_minimal_and_published_content_is_immutable(
    db,
    users,
    announcement_settings,
):
    owner, _, _, _ = users
    now = datetime.now(timezone.utc)
    item = publish_now(db, owner, now=now)
    payload = service.serialize_announcement(item, locale="ru", now=now)

    assert payload["title"] == item.title_ru
    assert "body_ru" not in payload
    assert "audiences" not in payload
    assert "created_by_user_id" not in payload
    assert "published_by_user_id" not in payload

    with pytest.raises(service.AnnouncementError) as exc:
        service.update_draft(
            db,
            actor=owner,
            announcement_id=item.id,
            expected_revision=item.revision,
            payload=draft_payload(title_ru="Тихая подмена"),
        )
    assert exc.value.code == "ANNOUNCEMENT_IMMUTABLE"


def test_optimistic_lock_and_critical_modal_overlap(
    db,
    users,
    announcement_settings,
):
    owner, _, _, _ = users
    now = datetime.now(timezone.utc)
    first = service.create_draft(db, actor=owner, payload=draft_payload())
    original_revision = first.revision
    first = service.update_draft(
        db,
        actor=owner,
        announcement_id=first.id,
        expected_revision=original_revision,
        payload=draft_payload(priority=60),
    )
    with pytest.raises(service.AnnouncementError) as stale:
        service.update_draft(
            db,
            actor=owner,
            announcement_id=first.id,
            expected_revision=original_revision,
            payload=draft_payload(priority=70),
        )
    assert stale.value.status_code == 409
    assert stale.value.current_revision == first.revision

    critical = publish_now(
        db,
        owner,
        now=now,
        severity="CRITICAL",
        presentation="MODAL",
        effect="NONE",
        dismiss_policy="ACK_REQUIRED",
    )
    other = service.create_draft(
        db,
        actor=owner,
        payload=draft_payload(
            severity="CRITICAL",
            presentation="MODAL",
            effect="NONE",
            dismiss_policy="ACK_REQUIRED",
        ),
    )
    with pytest.raises(service.AnnouncementError) as overlap:
        service.publish(
            db,
            actor=owner,
            announcement_id=other.id,
            expected_revision=other.revision,
            starts_at=now,
            ends_at=now + timedelta(minutes=30),
            reason="Conflicting modal test",
        )
    assert overlap.value.code == "ANNOUNCEMENT_CRITICAL_MODAL_CONFLICT"
    assert db.get(SystemAnnouncement, critical.id).status == "PUBLISHED"


def test_receipts_are_idempotent_revision_scoped_and_rate_limited(
    db,
    users,
    announcement_settings,
):
    owner, player, _, _ = users
    now = datetime.now(timezone.utc)
    item = publish_now(db, owner, now=now, audiences=["PLAYERS"])

    first = service.record_receipt(
        db,
        user=player,
        effective_role="PLAYER",
        announcement_id=item.id,
        revision=item.revision,
        surface="SITE_PUBLIC",
        action="SEEN",
        now=now,
    )
    second = service.record_receipt(
        db,
        user=player,
        effective_role="PLAYER",
        announcement_id=item.id,
        revision=item.revision,
        surface="SITE_PUBLIC",
        action="SEEN",
        now=now + timedelta(minutes=1),
    )
    assert first.id == second.id
    assert second.impression_count == 1

    dashboard_seen = service.record_receipt(
        db,
        user=player,
        effective_role="PLAYER",
        announcement_id=item.id,
        revision=item.revision,
        surface="SITE_DASHBOARD",
        action="SEEN",
        now=now + timedelta(minutes=1),
    )
    assert dashboard_seen.impression_count == 1
    metrics = service.announcement_metrics(db, item.id)
    assert metrics["totals"]["seen_users"] == 1
    assert metrics["totals"]["impressions"] == 2
    assert metrics["by_surface"]["SITE_PUBLIC"]["seen_users"] == 1
    assert metrics["by_surface"]["SITE_DASHBOARD"]["seen_users"] == 1

    dismissed = service.record_receipt(
        db,
        user=player,
        effective_role="PLAYER",
        announcement_id=item.id,
        revision=item.revision,
        surface="SITE_PUBLIC",
        action="DISMISSED",
        now=now + timedelta(minutes=2),
    )
    assert dismissed.dismissed_at is not None
    assert (
        service.active_announcements(
            db,
            user=player,
            effective_role="PLAYER",
            surface="SITE_PUBLIC",
            locale="ru",
            now=now + timedelta(minutes=3),
        )
        == []
    )
    assert db.scalar(select(func.count()).select_from(SystemAnnouncementReceipt)) == 2

    with pytest.raises(service.AnnouncementError) as stale:
        service.record_receipt(
            db,
            user=player,
            effective_role="PLAYER",
            announcement_id=item.id,
            revision=item.revision - 1,
            surface="SITE_PUBLIC",
            action="SEEN",
            now=now,
        )
    assert stale.value.code == "ANNOUNCEMENT_REVISION_CONFLICT"

    non_dismissible = publish_now(
        db,
        owner,
        now=now,
        title_ru="Обязательное предупреждение",
        title_en="Mandatory warning",
        severity="MAINTENANCE",
        dismiss_policy="NON_DISMISSIBLE",
        audiences=["PLAYERS"],
    )
    with pytest.raises(service.AnnouncementError) as invalid_ack:
        service.record_receipt(
            db,
            user=player,
            effective_role="PLAYER",
            announcement_id=non_dismissible.id,
            revision=non_dismissible.revision,
            surface="SITE_PUBLIC",
            action="ACKNOWLEDGED",
            now=now,
        )
    assert invalid_ack.value.code == "ANNOUNCEMENT_ACK_NOT_REQUIRED"


def test_duplicate_replace_audit_and_telegram_outbox(
    db,
    users,
    announcement_settings,
):
    owner, _, _, _ = users
    announcement_settings.announcements_telegram_mirror_enabled = True
    now = datetime.now(timezone.utc)
    current = publish_now(db, owner, now=now)
    replacement = service.duplicate_draft(
        db,
        actor=owner,
        announcement_id=current.id,
    )
    replacement = service.update_draft(
        db,
        actor=owner,
        announcement_id=replacement.id,
        expected_revision=replacement.revision,
        payload=draft_payload(title_ru="Исправленный текст"),
    )
    previous, replacement = service.replace(
        db,
        actor=owner,
        announcement_id=current.id,
        expected_revision=current.revision,
        replacement_id=replacement.id,
        replacement_expected_revision=replacement.revision,
        starts_at=now,
        ends_at=now + timedelta(hours=2),
        reason="Correct a published typo",
    )
    assert previous.status == "CANCELLED"
    assert replacement.status == "PUBLISHED"
    assert replacement.supersedes_id == previous.id

    events = list(
        db.scalars(
            select(OutboxEvent)
            .where(OutboxEvent.aggregate_id.in_([previous.id, replacement.id]))
            .order_by(OutboxEvent.created_at.asc())
        ).all()
    )
    assert events[-1].event_type == "telegram.system.announcement_replaced"
    assert "body" not in events[-1].payload
    assert "user_id" not in events[-1].payload
    actions = set(
        db.scalars(
            select(AuditLog.action).where(AuditLog.entity_type == "system_announcement")
        ).all()
    )
    assert {
        "admin.announcement.created",
        "admin.announcement.published",
        "admin.announcement.duplicated",
        "admin.announcement.updated",
        "admin.announcement.replaced",
    }.issubset(actions)


def test_role_matrix_and_source_wiring_are_fail_closed():
    assert role_has_permission("OWNER", "announcements.publish")
    assert role_has_permission("OWNER", "announcements.cancel")
    assert role_has_permission("ADMIN", "announcements.read")
    assert role_has_permission("ADMIN", "announcements.drafts.manage")
    assert role_has_permission("ADMIN", "announcements.metrics.read")
    assert not role_has_permission("ADMIN", "announcements.publish")
    assert not role_has_permission("MODERATOR", "announcements.read")

    main = Path("app/main.py").read_text(encoding="utf-8")
    assert 'Depends(_require_permission("announcements.publish"))' in main
    assert 'Depends(_require_permission("announcements.cancel"))' in main
    assert "dependencies=[Depends(require_csrf)]" in main
    assert "/api/announcements/active" in main
    assert 'Cache-Control"] = "no-store"' in main

    migration = Path("alembic/versions/0013_system_announcements.py").read_text(
        encoding="utf-8"
    )
    assert 'revision: str = "0013"' in migration
    assert 'down_revision: Union[str, Sequence[str], None] = "0012"' in migration
    assert "uq_announcement_receipt_subject" in migration


def test_telegram_renderer_escapes_dynamic_values(announcement_settings):
    text, keyboard, silent = telegram.render_announcement_notification(
        "telegram.system.announcement_published",
        {
            "announcement_id": "abc/<unsafe>",
            "title": "<script>alert(1)</script>",
            "severity": "WARNING",
            "presentation": "BANNER",
            "surfaces": ["SITE_PUBLIC"],
            "audiences": ["ALL"],
            "actor_display_name": "<b>owner</b>",
        },
    )
    assert "<script>" not in text
    assert "&lt;script&gt;" in text
    assert "&lt;b&gt;owner&lt;/b&gt;" in text
    assert "%2F%3Cunsafe%3E" in keyboard["inline_keyboard"][0][0]["url"]
    assert silent is False


def test_telegram_sender_uses_separate_topic_and_safe_send_message_payload(
    announcement_settings,
    monkeypatch,
):
    announcement_settings.announcements_telegram_mirror_enabled = True
    announcement_settings.telegram_system_thread_id = 77
    captured = {}

    def fake_call(method, payload):
        captured["method"] = method
        captured["payload"] = payload
        return {"message_id": 42, "chat": {"id": -1001234567890}}

    monkeypatch.setattr(telegram, "_telegram_api_call", fake_call)
    result = telegram.send_announcement_notification(
        "telegram.system.announcement_cancelled",
        {
            "announcement_id": "notice-1",
            "title": "Test notice",
            "severity": "INFO",
            "presentation": "BANNER",
            "surfaces": ["SITE_PUBLIC"],
            "audiences": ["ALL"],
        },
    )

    assert result.message_id == 42
    assert captured["method"] == "sendMessage"
    assert captured["payload"]["message_thread_id"] == 77
    assert captured["payload"]["parse_mode"] == "HTML"
    assert captured["payload"]["link_preview_options"] == {"is_disabled": True}
    assert captured["payload"]["protect_content"] is True
