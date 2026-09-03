from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import (
    AutoReviewCase,
    BoardOption,
    ContractBoard,
    Evaluation,
    Job,
    Match,
    MissionDefinition,
    OutboxEvent,
    User,
)
from app.services.moderation import (
    MODERATION_POLICY_VERSION,
    ModerationConflict,
    ModerationValidationError,
    decide_review,
    preview_review_decision,
)


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with factory() as session:
        yield session


def _seed_review(db: Session, *, add_locked_retry: bool = False):
    now = datetime.now(timezone.utc)

    owner = User(
        steam_id64=76561198000001001,
        account_id=1001,
        display_name="Review Player",
        xp=0,
    )
    moderator = User(
        steam_id64=76561198000001002,
        account_id=1002,
        display_name="Moderator",
        access_role="MODERATOR",
    )
    db.add_all([owner, moderator])
    db.flush()

    mission = MissionDefinition(
        key="moderation-test",
        version=2,
        title="Moderation test",
        description="Moderation test contract",
        title_en="Moderation test",
        description_en="Moderation test contract",
        metric="player.kills",
        operator="gte",
        target=5,
        reward_xp=125,
        game_match_mode="STANDARD",
        ranked_policy="ALLOWED",
        status="PUBLISHED",
        safety_classification="SAFE",
    )
    db.add(mission)
    db.flush()

    board = ContractBoard(
        user_id=owner.id,
        board_date=date.today(),
        status="REVIEW_REQUIRED",
        game_match_mode="STANDARD",
        seed="moderation-stage2",
        attempts_used=1,
        max_attempts=3,
        locked_at=now - timedelta(minutes=40),
        expires_at=now + timedelta(hours=12),
    )
    db.add(board)
    db.flush()

    match = Match(
        external_match_id=777000001,
        provider="fixture",
        started_at=now - timedelta(minutes=30),
        ended_at=now - timedelta(minutes=5),
        duration_s=1500,
        game_match_mode="STANDARD",
        provider_mode_raw="fixture",
        mode_classifier_version="fixture",
        mode_confidence="HIGH",
        scoring_status="SCORED",
        is_final=True,
        capabilities=[],
    )
    db.add(match)
    db.flush()

    review_option = BoardOption(
        board_id=board.id,
        mission_definition_id=mission.id,
        rendered_title="Need review",
        rendered_description="Need review",
        metric="player.kills",
        operator="gte",
        target=5,
        reward_xp=125,
        required_game_match_mode="STANDARD",
        selected=True,
        status="REVIEW_REQUIRED",
        locked_at=board.locked_at,
        bound_match_id=match.id,
    )
    db.add(review_option)

    locked_option = None
    if add_locked_retry:
        mission2 = MissionDefinition(
            key="moderation-retry",
            version=2,
            title="Retry contract",
            description="Retry contract",
            title_en="Retry contract",
            description_en="Retry contract",
            metric="player.assists",
            operator="gte",
            target=8,
            reward_xp=80,
            game_match_mode="STANDARD",
            ranked_policy="ALLOWED",
            status="PUBLISHED",
            safety_classification="SAFE",
        )
        db.add(mission2)
        db.flush()
        locked_option = BoardOption(
            board_id=board.id,
            mission_definition_id=mission2.id,
            rendered_title="Retry later",
            rendered_description="Retry later",
            metric="player.assists",
            operator="gte",
            target=8,
            reward_xp=80,
            required_game_match_mode="STANDARD",
            selected=True,
            status="LOCKED",
            locked_at=board.locked_at,
        )
        db.add(locked_option)

    db.flush()

    review = AutoReviewCase(
        board_id=board.id,
        user_id=owner.id,
        match_id=match.id,
        status="PENDING",
        reasons=[{"option_id": review_option.id, "reason": "missing capability"}],
        context={"raw_sensitive": "must not matter to service"},
    )
    db.add(review)
    db.commit()

    return owner, moderator, board, match, review, review_option, locked_option


def _completed_payload(option: BoardOption) -> list[dict]:
    return [
        {
            "option_id": option.id,
            "status": "COMPLETED",
            "progress_current": 6,
            "explanation": "Выполнение подтверждено внутренней проверкой.",
        }
    ]


def test_preview_is_read_only_and_reports_reward(db: Session) -> None:
    owner, moderator, _, _, review, option, _ = _seed_review(db)

    result = preview_review_decision(
        db,
        review_id=review.id,
        actor_user_id=moderator.id,
        source="WEB",
        case_status="RESOLVED",
        reason_code=None,
        reviewer_note="Checked in staff UI",
        options=_completed_payload(option),
    )

    assert result.reward_xp_total == 125
    assert result.board_status_after == "SETTLED"
    assert result.resume_discovery is False

    db.expire_all()
    assert db.get(AutoReviewCase, review.id).status == "PENDING"
    assert db.get(BoardOption, option.id).status == "REVIEW_REQUIRED"
    assert db.get(User, owner.id).xp == 0
    assert db.scalar(select(func.count()).select_from(Evaluation)) == 0
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == 0


def test_decision_uses_outbox_and_does_not_grant_xp_directly(db: Session) -> None:
    owner, moderator, _, _, review, option, _ = _seed_review(db)

    result = decide_review(
        db,
        review_id=review.id,
        actor_user_id=moderator.id,
        source="WEB",
        case_status="RESOLVED",
        reason_code=None,
        reviewer_note="Checked in staff UI",
        options=_completed_payload(option),
    )

    assert result.reward_xp_total == 125
    assert result.board_status_after == "SETTLED"

    db.expire_all()
    stored_review = db.get(AutoReviewCase, review.id)
    stored_option = db.get(BoardOption, option.id)
    stored_owner = db.get(User, owner.id)

    assert stored_review.status == "RESOLVED"
    assert stored_review.reviewer_id == moderator.id
    assert stored_review.decision_payload["schema_version"] == 2
    assert stored_review.decision_payload["source"] == "WEB"
    assert stored_review.decision_payload["policy_version"] == MODERATION_POLICY_VERSION
    assert stored_option.status == "COMPLETED"
    assert stored_owner.xp == 0

    evaluations = list(db.scalars(select(Evaluation)).all())
    assert len(evaluations) == 1
    assert evaluations[0].evidence_level == "INTERNAL_REVIEW"
    assert evaluations[0].facts[0]["decision_source"] == "WEB"

    outbox = list(db.scalars(select(OutboxEvent)).all())
    assert len(outbox) == 1
    assert outbox[0].event_type == "assignment.settled"
    assert outbox[0].payload["reward_xp"] == 125
    assert outbox[0].payload["moderation"]["decision_key"] == result.decision_key


def test_exact_retry_is_idempotent(db: Session) -> None:
    _, moderator, _, _, review, option, _ = _seed_review(db)
    kwargs = dict(
        review_id=review.id,
        actor_user_id=moderator.id,
        source="WEB",
        case_status="RESOLVED",
        reason_code=None,
        reviewer_note="Checked in staff UI",
        options=_completed_payload(option),
    )

    first = decide_review(db, **kwargs)
    second = decide_review(db, **kwargs)

    assert first.idempotent is False
    assert second.idempotent is True
    assert second.decision_key == first.decision_key
    assert db.scalar(select(func.count()).select_from(Evaluation)) == 1
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_conflicting_second_decision_is_rejected(db: Session) -> None:
    _, moderator, _, _, review, option, _ = _seed_review(db)

    decide_review(
        db,
        review_id=review.id,
        actor_user_id=moderator.id,
        source="WEB",
        case_status="RESOLVED",
        reason_code=None,
        reviewer_note="Checked in staff UI",
        options=_completed_payload(option),
    )

    with pytest.raises(ModerationConflict) as exc:
        decide_review(
            db,
            review_id=review.id,
            actor_user_id=moderator.id,
            source="WEB",
            case_status="RESOLVED",
            reason_code="NOT_COMPLETED",
            reviewer_note="Different decision",
            options=[
                {
                    "option_id": option.id,
                    "status": "FAILED",
                    "progress_current": 2,
                    "explanation": "Выполнение не подтверждено внутренней проверкой.",
                }
            ],
        )

    assert exc.value.code == "REVIEW_ALREADY_DECIDED"
    assert db.scalar(select(func.count()).select_from(Evaluation)) == 1
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_negative_verdict_requires_structured_reason(db: Session) -> None:
    _, moderator, _, _, review, option, _ = _seed_review(db)

    with pytest.raises(ModerationValidationError) as exc:
        preview_review_decision(
            db,
            review_id=review.id,
            actor_user_id=moderator.id,
            source="WEB",
            case_status="RESOLVED",
            reason_code=None,
            reviewer_note="Failed after review",
            options=[
                {
                    "option_id": option.id,
                    "status": "FAILED",
                    "progress_current": 1,
                    "explanation": "Выполнение не подтверждено внутренней проверкой.",
                }
            ],
        )

    assert exc.value.code == "NEGATIVE_REASON_REQUIRED"


def test_reject_preserves_retryable_locked_contract_and_resumes_discovery(db: Session) -> None:
    _, moderator, board, match, review, option, locked = _seed_review(
        db,
        add_locked_retry=True,
    )

    result = decide_review(
        db,
        review_id=review.id,
        actor_user_id=moderator.id,
        source="WEB",
        case_status="REJECTED",
        reason_code="INSUFFICIENT_EVIDENCE",
        reviewer_note="Данных недостаточно для подтверждения.",
        options=[],
    )

    assert result.board_status_after == "LOCKED"
    assert result.resume_discovery is True
    assert result.reward_xp_total == 0

    db.expire_all()
    stored_board = db.get(ContractBoard, board.id)
    assert stored_board.status == "LOCKED"
    assert stored_board.baseline_match_id == match.external_match_id
    assert db.get(BoardOption, option.id).status == "FAILED"
    assert db.get(BoardOption, locked.id).status == "LOCKED"

    jobs = list(
        db.scalars(
            select(Job).where(
                Job.type == "discover_match",
                Job.board_id == board.id,
            )
        ).all()
    )
    assert len(jobs) == 1
    assert jobs[0].idempotency_key == f"discover:{board.id}:review-resume:{review.id}"


def test_telegram_source_is_supported_but_http_hardcodes_web(db: Session) -> None:
    _, moderator, _, _, review, option, _ = _seed_review(db)

    preview = preview_review_decision(
        db,
        review_id=review.id,
        actor_user_id=moderator.id,
        source="TELEGRAM",
        case_status="RESOLVED",
        reason_code=None,
        reviewer_note="Future Telegram adapter",
        options=_completed_payload(option),
    )
    assert preview.source == "TELEGRAM"

    source = open("app/main.py", encoding="utf-8").read()
    request_block = source[
        source.index("class AutoReviewDecisionRequest"):
        source.index("class AdminTotpRequest")
    ]
    assert "source:" not in request_block


def test_main_delegates_http_decision_to_service() -> None:
    source = open("app/main.py", encoding="utf-8").read()

    block = source[
        source.index('@app.post(\n    "/api/admin/auto-reviews/{review_id}/decision-preview"'):
        source.index('@app.post("/api/matches/sync"')
    ]

    assert "preview_review_decision(" in block
    assert "decide_review(" in block
    assert 'source="WEB"' in block
    assert "OutboxEvent(" not in block
    assert "Evaluation(" not in block
    assert "db.commit()" not in block


def test_frontend_supplies_reason_code_for_negative_verdicts() -> None:
    source = open("frontend/src/Dashboard.tsx", encoding="utf-8").read()

    assert 'const reasonCode = statuses.includes("VOID")' in source
    assert '"INSUFFICIENT_EVIDENCE"' in source
    assert '"NOT_COMPLETED"' in source
    assert "reason_code: reasonCode" in source
