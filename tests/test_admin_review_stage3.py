from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import (
    AutoReviewCase,
    BoardOption,
    ContractBoard,
    Match,
    MatchParticipant,
    MissionDefinition,
    User,
)
from app.services.moderation import decide_review, preview_review_decision
from app.services.review_claims import (
    CLAIM_TTL_MINUTES,
    ReviewClaimConflict,
    claim_review,
    mark_review_needs_info,
    release_review,
)


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with factory() as session:
        yield session


def _seed_review(db: Session):
    now = datetime.now(timezone.utc)

    owner = User(
        steam_id64=76561198000002001,
        account_id=2001,
        display_name="Review Player Stage3",
        xp=0,
    )
    moderator_a = User(
        steam_id64=76561198000002002,
        account_id=2002,
        display_name="Moderator A",
        access_role="MODERATOR",
    )
    moderator_b = User(
        steam_id64=76561198000002003,
        account_id=2003,
        display_name="Moderator B",
        access_role="MODERATOR",
    )
    admin = User(
        steam_id64=76561198000002004,
        account_id=2004,
        display_name="Admin",
        access_role="ADMIN",
    )
    db.add_all([owner, moderator_a, moderator_b, admin])
    db.flush()

    mission = MissionDefinition(
        key="stage3-review-kills",
        version=2,
        title="Stage3 Review",
        description="Stage3 Review",
        title_en="Stage3 Review",
        description_en="Stage3 Review",
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
        seed="stage3-review",
        attempts_used=1,
        max_attempts=3,
        locked_at=now - timedelta(minutes=45),
        expires_at=now + timedelta(hours=12),
    )
    db.add(board)
    db.flush()

    match = Match(
        external_match_id=888000001,
        provider="overwolf_gep",
        started_at=now - timedelta(minutes=30),
        ended_at=now - timedelta(minutes=4),
        duration_s=1560,
        game_match_mode="STANDARD",
        provider_mode_raw="Standard",
        mode_classifier_version="test",
        mode_confidence="HIGH",
        scoring_status="SCORED",
        is_final=True,
        capabilities=["summary.kills", "summary.duration"],
        settlement_source="OVERWOLF_GEP",
        integrity_status="CLIENT_ATTESTED_GEP",
        audit_status="PENDING",
    )
    db.add(match)
    db.flush()

    participant = MatchParticipant(
        match_id=match.id,
        account_id=owner.account_id,
        steam_id64=owner.steam_id64,
        hero_id=1,
        team=0,
        won=True,
        kills=7,
        deaths=2,
        assists=11,
        net_worth=32000,
        hero_damage=25000,
        object_damage=5000,
        healing=4200,
    )
    db.add(participant)

    option = BoardOption(
        board_id=board.id,
        mission_definition_id=mission.id,
        rendered_title="Stage3 Review",
        rendered_description="Get at least five kills",
        metric="player.kills",
        operator="gte",
        target=5,
        reward_xp=125,
        required_capabilities=["summary.kills"],
        required_game_match_mode="STANDARD",
        selected=True,
        status="REVIEW_REQUIRED",
        locked_at=board.locked_at,
        bound_match_id=match.id,
    )
    db.add(option)
    db.flush()

    review = AutoReviewCase(
        board_id=board.id,
        user_id=owner.id,
        match_id=match.id,
        status="PENDING",
        reasons=[
            {
                "option_id": option.id,
                "title": option.rendered_title,
                "reason": "Needs staff verification",
            }
        ],
        context={"raw_debug": "owner-only"},
        priority=50,
    )
    db.add(review)
    db.commit()
    return owner, moderator_a, moderator_b, admin, board, match, option, review


def _completed_payload(option: BoardOption) -> list[dict]:
    return [
        {
            "option_id": option.id,
            "status": "COMPLETED",
            "progress_current": 7,
            "explanation": "Выполнение подтверждено внутренней проверкой.",
        }
    ]


def test_claim_can_renew_blocks_other_and_expired_claim_can_be_reclaimed(db: Session) -> None:
    _, moderator_a, moderator_b, _, _, _, _, review = _seed_review(db)

    first = claim_review(
        db,
        review_id=review.id,
        actor_user_id=moderator_a.id,
    )
    assert first["active"] is True
    assert first["claimed_by_user_id"] == moderator_a.id
    assert first["ttl_minutes"] == CLAIM_TTL_MINUTES

    renewed = claim_review(
        db,
        review_id=review.id,
        actor_user_id=moderator_a.id,
    )
    assert renewed["active"] is True
    assert renewed["claimed_by_user_id"] == moderator_a.id

    with pytest.raises(ReviewClaimConflict) as exc:
        claim_review(
            db,
            review_id=review.id,
            actor_user_id=moderator_b.id,
        )
    assert exc.value.code == "REVIEW_CLAIMED_BY_OTHER"

    item = db.get(AutoReviewCase, review.id)
    item.claim_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()

    reclaimed = claim_review(
        db,
        review_id=review.id,
        actor_user_id=moderator_b.id,
    )
    assert reclaimed["active"] is True
    assert reclaimed["claimed_by_user_id"] == moderator_b.id


def test_foreign_active_claim_requires_force_to_release(db: Session) -> None:
    _, moderator_a, moderator_b, admin, _, _, _, review = _seed_review(db)
    claim_review(db, review_id=review.id, actor_user_id=moderator_a.id)

    with pytest.raises(ReviewClaimConflict):
        release_review(
            db,
            review_id=review.id,
            actor_user_id=moderator_b.id,
        )

    payload = release_review(
        db,
        review_id=review.id,
        actor_user_id=admin.id,
        force=True,
    )
    assert payload["active"] is False
    assert payload["claimed_by_user_id"] is None


def test_needs_info_requires_own_claim_and_releases_it(db: Session) -> None:
    _, moderator_a, _, _, _, _, _, review = _seed_review(db)

    with pytest.raises(ReviewClaimConflict) as exc:
        mark_review_needs_info(
            db,
            review_id=review.id,
            actor_user_id=moderator_a.id,
            note="Нужны дополнительные данные.",
        )
    assert exc.value.code == "REVIEW_CLAIM_REQUIRED"

    claim_review(db, review_id=review.id, actor_user_id=moderator_a.id)
    item = mark_review_needs_info(
        db,
        review_id=review.id,
        actor_user_id=moderator_a.id,
        note="Нужны дополнительные данные.",
    )
    assert item.status == "NEEDS_INFO"
    assert item.claimed_by_user_id is None
    assert item.claim_expires_at is None


def test_web_moderation_can_require_claim_and_final_decision_clears_it(db: Session) -> None:
    _, moderator_a, _, _, _, _, option, review = _seed_review(db)

    with pytest.raises(ReviewClaimConflict) as exc:
        preview_review_decision(
            db,
            review_id=review.id,
            actor_user_id=moderator_a.id,
            source="WEB",
            case_status="RESOLVED",
            reason_code=None,
            reviewer_note="Checked",
            options=_completed_payload(option),
            required_claim_by=moderator_a.id,
        )
    assert exc.value.code == "REVIEW_CLAIM_REQUIRED"

    claim_review(db, review_id=review.id, actor_user_id=moderator_a.id)

    preview = preview_review_decision(
        db,
        review_id=review.id,
        actor_user_id=moderator_a.id,
        source="WEB",
        case_status="RESOLVED",
        reason_code=None,
        reviewer_note="Checked",
        options=_completed_payload(option),
        required_claim_by=moderator_a.id,
    )
    assert preview.reward_xp_total == 125

    first = decide_review(
        db,
        review_id=review.id,
        actor_user_id=moderator_a.id,
        source="WEB",
        case_status="RESOLVED",
        reason_code=None,
        reviewer_note="Checked",
        options=_completed_payload(option),
        required_claim_by=moderator_a.id,
    )
    assert first.idempotent is False

    db.expire_all()
    item = db.get(AutoReviewCase, review.id)
    assert item.status == "RESOLVED"
    assert item.claimed_by_user_id is None
    assert item.claim_expires_at is None

    # Exact network retry remains idempotent even though the claim was cleared
    # by the successful first transaction.
    second = decide_review(
        db,
        review_id=review.id,
        actor_user_id=moderator_a.id,
        source="WEB",
        case_status="RESOLVED",
        reason_code=None,
        reviewer_note="Checked",
        options=_completed_payload(option),
        required_claim_by=moderator_a.id,
    )
    assert second.idempotent is True
    assert second.decision_key == first.decision_key


def test_stage3_review_serializer_exposes_trust_actuals_and_redacts_context(db: Session) -> None:
    _, _, _, _, _, _, option, review = _seed_review(db)

    from app.main import _serialize_auto_review

    payload = _serialize_auto_review(db, review, redact=True)
    assert payload["priority"] == 50
    assert payload["player"]["account_id"] is None
    assert payload["context"] == {}
    assert payload["match_summary"]["settlement_source"] == "OVERWOLF_GEP"
    assert payload["match_summary"]["integrity_status"] == "CLIENT_ATTESTED_GEP"
    assert payload["match_summary"]["audit_status"] == "PENDING"
    assert payload["claim"]["active"] is False

    contract = next(item for item in payload["contracts"] if item["id"] == option.id)
    assert contract["operator"] == "gte"
    assert contract["actual"] == 7.0
    assert contract["missing_capabilities"] == []


def test_stage3_backend_routes_require_review_permissions_and_claim() -> None:
    src = Path("app/main.py").read_text(encoding="utf-8")

    assert '"/api/admin/auto-reviews/{review_id}"' in src
    assert '"/api/admin/auto-reviews/{review_id}/claim"' in src
    assert '"/api/admin/auto-reviews/{review_id}/release"' in src
    assert '"/api/admin/auto-reviews/{review_id}/needs-info"' in src
    assert 'Depends(_require_permission("reviews.claim"))' in src
    assert 'Depends(_require_permission("reviews.decide"))' in src
    assert src.count("required_claim_by=admin.id") == 2
    assert 'role not in {"OWNER", "ADMIN"}' in src


def test_stage3_inbox_supports_filters_and_priority_order() -> None:
    src = Path("app/main.py").read_text(encoding="utf-8")

    for token in (
        'claim: Literal["ALL", "FREE", "MINE", "CLAIMED"]',
        "settlement_source: str",
        "audit_status: str",
        'priority: Literal["ALL", "HIGH", "NORMAL"]',
        'age: Literal["ALL", "15M", "1H", "6H", "24H"]',
        "reason: str",
        "claimed_by: str",
        "query: str",
        "AutoReviewCase.priority.asc()",
        "AutoReviewCase.created_at.asc()",
    ):
        assert token in src


def test_stage3_frontend_has_deep_links_claim_preview_and_mobile_css() -> None:
    dashboard = Path("frontend/src/Dashboard.tsx").read_text(encoding="utf-8")
    review = Path("frontend/src/admin/ReviewDesk.tsx").read_text(encoding="utf-8")
    css = Path("frontend/src/admin/review-stage3.css").read_text(encoding="utf-8")

    assert 'import ReviewDesk from "./admin/ReviewDesk"' in dashboard
    assert "function AdminReviewDesk(" not in dashboard
    assert 'window.location.pathname.startsWith("/admin/")' in dashboard
    assert 'window.location.pathname.startsWith("/admin/reviews")' in dashboard

    assert "/admin/reviews/${reviewId}" in review
    assert "/decision-preview" in review
    assert "/claim" in review
    assert "/release" in review
    assert "/needs-info" in review
    assert "ПОДТВЕРДИТЬ И ЗАКРЫТЬ" in review
    assert "REVIEW_CLAIM" not in review
    assert "@media (max-width: 760px)" in css


def test_stage3_orm_claim_fk_name_matches_alembic_downgrade() -> None:
    from app.models import AutoReviewCase

    foreign_keys = AutoReviewCase.__table__.c.claimed_by_user_id.foreign_keys
    assert len(foreign_keys) == 1
    foreign_key = next(iter(foreign_keys))
    assert foreign_key.constraint.name == "fk_auto_review_cases_claimed_by_user"


def test_stage3_migration_is_0010_to_0011_and_has_claim_indexes() -> None:
    src = Path("alembic/versions/0011_admin_review_claims.py").read_text(encoding="utf-8")

    assert 'revision: str = "0011"' in src
    assert 'down_revision: Union[str, Sequence[str], None] = "0010"' in src
    for token in (
        '"claimed_by_user_id"',
        '"claimed_at"',
        '"claim_expires_at"',
        '"priority"',
        '"ix_auto_review_cases_status_priority_created"',
        '"ix_auto_review_cases_claim_owner_expiry"',
    ):
        assert token in src
