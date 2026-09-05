from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import (
    AutoReviewCase, BoardOption, ContractBoard, Match, MissionDefinition,
    ModerationDecisionDraft, RewardLedgerEntry, TelegramModeratorBinding,
    TelegramUpdateReceipt, User,
)
from app.services import telegram_callbacks as callbacks
from app.services import telegram_moderation as moderation
from app.services import telegram_webhook as webhook
from app.services.telegram_callback_codec import decode_callback_data, encode_claim, encode_verdict

CHAT_ID = -1001234567890
TELEGRAM_USER_ID = 123456789


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with factory() as session:
        yield session


@pytest.fixture()
def fake_settings(monkeypatch):
    settings = SimpleNamespace(
        admin_steam_ids=(),
        app_base_url="https://deadlock-contracts.example",
        telegram_review_chat_id=str(CHAT_ID),
        telegram_review_thread_id=0,
        telegram_review_callbacks_enabled=True,
        telegram_moderation_notifications_enabled=True,
        telegram_webhook_enabled=True,
        telegram_bot_username="DeadlockContractsTestBot",
        telegram_link_token_ttl_minutes=10,
        telegram_webhook_secret="stage5c-test-webhook-secret-value-safe",
    )
    monkeypatch.setattr(callbacks, "settings", settings)
    monkeypatch.setattr(moderation, "settings", settings)
    monkeypatch.setattr(webhook, "settings", settings)
    return settings


def seed_review(db: Session):
    now = datetime.now(timezone.utc)
    owner = User(steam_id64=76561198000003001, account_id=3001, display_name="Stage5C Player", xp=0)
    moderator = User(steam_id64=76561198000003002, account_id=3002, display_name="Stage5C Moderator", access_role="MODERATOR")
    other = User(steam_id64=76561198000003003, account_id=3003, display_name="Other Moderator", access_role="MODERATOR")
    db.add_all([owner, moderator, other]); db.flush()

    missions = []
    for index in range(2):
        mission = MissionDefinition(
            key=f"stage5c-kills-{index + 1}",
            version=1,
            title=f"Stage5C Kills {index + 1}",
            description=f"Stage5C Kills {index + 1}",
            title_en=f"Stage5C Kills {index + 1}",
            description_en=f"Stage5C Kills {index + 1}",
            metric="player.kills",
            operator="gte",
            target=5 + index,
            reward_xp=100 + index * 25,
            game_match_mode="STANDARD",
            ranked_policy="ALLOWED",
            status="PUBLISHED",
            safety_classification="SAFE",
        )
        db.add(mission)
        db.flush()
        missions.append(mission)
    board = ContractBoard(
        user_id=owner.id, board_date=date.today(), status="REVIEW_REQUIRED",
        game_match_mode="STANDARD", seed="stage5c", attempts_used=1, max_attempts=3,
        locked_at=now - timedelta(minutes=30), expires_at=now + timedelta(hours=10),
    )
    db.add(board); db.flush()
    match = Match(
        external_match_id=999000001, provider="overwolf_gep",
        started_at=now - timedelta(minutes=25), ended_at=now - timedelta(minutes=2),
        duration_s=1380, game_match_mode="STANDARD", provider_mode_raw="Standard",
        mode_classifier_version="test", mode_confidence="HIGH", scoring_status="SCORED",
        is_final=True, capabilities=["summary.kills"], settlement_source="OVERWOLF_GEP",
        integrity_status="CLIENT_ATTESTED_GEP", audit_status="PENDING",
    )
    db.add(match); db.flush()

    options = []
    for index in range(2):
        option = BoardOption(
            board_id=board.id, mission_definition_id=missions[index].id,
            rendered_title=f"Stage5C Contract {index + 1}",
            rendered_description="Review this contract", metric="player.kills",
            operator="gte", target=5 + index, reward_xp=100 + index * 25,
            required_capabilities=["summary.kills"], required_game_match_mode="STANDARD",
            selected=True, status="REVIEW_REQUIRED", locked_at=board.locked_at,
            bound_match_id=match.id,
        )
        db.add(option); db.flush(); options.append(option)

    review = AutoReviewCase(
        board_id=board.id, user_id=owner.id, match_id=match.id, status="PENDING",
        reasons=[{"option_id": o.id, "title": o.rendered_title, "reason": "Needs staff verification"} for o in options],
        context={"private": "must-not-enter-telegram"}, priority=50,
    )
    db.add(review); db.flush()
    db.add_all([
        TelegramModeratorBinding(user_id=moderator.id, telegram_user_id=TELEGRAM_USER_ID, telegram_username="stage5c_mod", verified_at=now, last_used_at=now),
        TelegramModeratorBinding(user_id=other.id, telegram_user_id=TELEGRAM_USER_ID + 1, telegram_username="other_mod", verified_at=now, last_used_at=now),
    ])
    db.commit()
    return owner, moderator, other, board, match, options, review


def callback_query(data: str, *, telegram_user_id: int = TELEGRAM_USER_ID) -> dict:
    return {
        "id": f"callback-{telegram_user_id}",
        "from": {"id": telegram_user_id, "is_bot": False, "first_name": "Moderator", "username": "mod"},
        "message": {"message_id": 77, "date": 1700000000, "chat": {"id": CHAT_ID, "type": "supergroup", "title": "Review"}},
        "data": data,
    }


def test_callback_codec_round_trip_and_limit():
    review_id = "12345678-1234-5678-1234-567812345678"
    option_id = "87654321-4321-6789-4321-678943216789"
    claim = encode_claim(review_id)
    verdict = encode_verdict(review_id, option_id, "COMPLETED")
    assert len(claim.encode()) <= 64
    assert len(verdict.encode()) <= 64
    assert decode_callback_data(claim).review_id == review_id
    decoded = decode_callback_data(verdict)
    assert (decoded.review_id, decoded.option_id, decoded.status) == (review_id, option_id, "COMPLETED")


def test_requested_notification_claim_button_is_fail_closed(fake_settings):
    review_id = "12345678-1234-5678-1234-567812345678"
    _, keyboard, _ = moderation.render_review_notification(
        "telegram.review.requested", {"review_id": review_id, "mode": "STANDARD", "reason_count": 1}
    )
    assert "callback_data" in repr(keyboard)
    fake_settings.telegram_review_callbacks_enabled = False
    _, keyboard2, _ = moderation.render_review_notification(
        "telegram.review.requested", {"review_id": review_id, "mode": "STANDARD", "reason_count": 1}
    )
    assert "callback_data" not in repr(keyboard2)


def test_claim_and_draft_never_change_final_state_or_xp(db, fake_settings):
    owner, moderator, _, board, _, options, review = seed_review(db)
    claim = callbacks.process_callback_query(db, callback_query(encode_claim(review.id)))
    db.commit()
    assert claim.state == "DRAFTING"
    assert db.get(AutoReviewCase, review.id).claimed_by_user_id == moderator.id

    callbacks.process_callback_query(db, callback_query(encode_verdict(review.id, options[0].id, "COMPLETED")))
    db.commit()
    done = callbacks.process_callback_query(db, callback_query(encode_verdict(review.id, options[1].id, "VOID")))
    db.commit()
    assert done.state == "DRAFT_READY"

    draft = db.scalar(select(ModerationDecisionDraft).where(
        ModerationDecisionDraft.review_id == review.id,
        ModerationDecisionDraft.actor_user_id == moderator.id,
        ModerationDecisionDraft.source == "TELEGRAM",
    ))
    assert draft is not None
    assert draft.decisions["options"][options[0].id]["status"] == "COMPLETED"
    assert draft.decisions["options"][options[1].id]["status"] == "VOID"
    assert db.get(AutoReviewCase, review.id).status == "PENDING"
    assert db.get(ContractBoard, board.id).status == "REVIEW_REQUIRED"
    assert all(db.get(BoardOption, o.id).status == "REVIEW_REQUIRED" for o in options)
    assert db.get(User, owner.id).xp == 0
    assert db.scalar(select(func.count()).select_from(RewardLedgerEntry)) == 0


def test_other_moderator_cannot_draft_foreign_claim(db, fake_settings):
    _, _, _, _, _, options, review = seed_review(db)
    callbacks.process_callback_query(db, callback_query(encode_claim(review.id))); db.commit()
    with pytest.raises(callbacks.TelegramCallbackError) as exc:
        callbacks.process_callback_query(
            db,
            callback_query(encode_verdict(review.id, options[0].id, "FAILED"), telegram_user_id=TELEGRAM_USER_ID + 1),
        )
    assert exc.value.code == "REVIEW_CLAIMED_BY_OTHER"
    assert db.scalar(select(func.count()).select_from(ModerationDecisionDraft)) == 0


def test_wrong_chat_rejected_before_claim(db, fake_settings):
    _, _, _, _, _, _, review = seed_review(db)
    q = callback_query(encode_claim(review.id)); q["message"]["chat"]["id"] = CHAT_ID - 1
    with pytest.raises(callbacks.TelegramCallbackError) as exc:
        callbacks.process_callback_query(db, q)
    assert exc.value.code == "CALLBACK_WRONG_CHAT"
    assert db.get(AutoReviewCase, review.id).claimed_by_user_id is None


def test_webhook_processes_callback_receipt_and_answers(db, fake_settings, monkeypatch):
    _, moderator, _, _, _, _, review = seed_review(db)
    answers = []; edits = []
    monkeypatch.setattr(webhook, "answer_callback_query", lambda cid, text, show_alert=False: answers.append((cid, text, show_alert)))
    monkeypatch.setattr(webhook, "edit_review_callback_message", lambda chat_id, message_id, text, reply_markup: edits.append((chat_id, message_id)))
    result = webhook.process_update(db, {"update_id": 5001, "callback_query": callback_query(encode_claim(review.id))})
    assert result["processed"] is True
    assert db.get(TelegramUpdateReceipt, 5001).state == "PROCESSED"
    assert db.get(AutoReviewCase, review.id).claimed_by_user_id == moderator.id
    assert answers and edits == [(CHAT_ID, 77)]


def test_stage5c_source_has_no_final_moderation_or_reward_mutation():
    source = Path("app/services/telegram_callbacks.py").read_text(encoding="utf-8")
    assert "decide_review" not in source
    assert "RewardLedgerEntry" not in source
    assert "reward_ledger" not in source
    assert "ModerationDecisionDraft" in source
    assert "assert_review_claim" in source
