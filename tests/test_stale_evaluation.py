"""A replay must never evaluate a contract against another attempt's match."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import (
    AutoReviewCase, BoardOption, ContractBoard, Evaluation, Match,
    MatchParticipant, MissionDefinition, OutboxEvent, User, Job,
)
from app.services.evaluator import evaluate_board
from app.services.jobs import claim_next_job, complete_job, enqueue_job
from app.worker import bind_match, handle_evaluate


@pytest.fixture
def case():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        now = datetime.now(timezone.utc)
        user = User(account_id=17, display_name="Replay player")
        db.add(user)
        db.flush()
        mission = MissionDefinition(
            key="replay-assists", title="Assist", description="Assist",
            metric="player.assists", operator="gte", target=8, reward_xp=100,
            required_capabilities=["summary.assists"], game_match_mode="STANDARD",
        )
        db.add(mission)
        db.flush()
        board = ContractBoard(
            user_id=user.id, board_date=date.today(), game_match_mode="STANDARD",
            seed="replay", status="LOCKED", locked_at=now - timedelta(hours=2),
            expires_at=now + timedelta(hours=4), attempts_used=0, max_attempts=3,
        )
        db.add(board)
        db.flush()
        option = BoardOption(
            board_id=board.id, mission_definition_id=mission.id,
            rendered_title="Assist", rendered_description="Assist",
            metric="player.assists", operator="gte", target=8, reward_xp=100,
            selected=True, status="LOCKED", required_game_match_mode="STANDARD",
            required_capabilities=["summary.assists"],
            conditions=[{"metric": "player.assists", "operator": "gte", "target": 8,
                         "capabilities": ["summary.assists"]}],
        )
        db.add(option)
        matches = []
        for index, assists in enumerate((1, 8)):
            match = Match(
                external_match_id=100 + index, provider="deadlock_api", is_final=True,
                started_at=now - timedelta(minutes=90 - index * 30), ended_at=now,
                game_match_mode="STANDARD", scoring_status="SCORED",
                mode_classifier_version="test", mode_confidence="HIGH",
                capabilities=["summary.assists"],
            )
            db.add(match)
            db.flush()
            db.add(MatchParticipant(match_id=match.id, account_id=17, assists=assists))
            matches.append(match)
        db.commit()
        yield db, board, option, matches[0], matches[1]
    engine.dispose()


def job(board, match):
    return SimpleNamespace(
        board_id=board.id, match_id=match.id,
        payload={"board_id": board.id, "match_id": match.id}, attempts=1, max_attempts=10,
    )


@pytest.mark.parametrize("replay", ["dispatcher", "evaluator"])
def test_old_attempt_replay_preserves_new_binding_and_reward(case, replay):
    db, board, option, old, new = case
    bind_match(db, board, old)
    handle_evaluate(db, job(board, old))
    assert option.status == "LOCKED"
    assert option.bound_match_id is None
    bind_match(db, board, new)
    board.attempts_used = 3  # Reproduces terminal corruption at the last attempt.
    db.commit()
    before = (option.status, option.bound_match_id, option.final_evaluation_id,
              board.status, board.baseline_match_id, board.attempts_used)

    if replay == "dispatcher":
        handle_evaluate(db, job(board, old))
    else:
        assert evaluate_board(db, board.id, old.id) == 0

    assert (option.status, option.bound_match_id, option.final_evaluation_id,
            board.status, board.baseline_match_id, board.attempts_used) == before
    assert db.scalar(select(func.count()).select_from(Evaluation)) == 1
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == 0
    handle_evaluate(db, job(board, new))
    assert option.status == "COMPLETED"
    assert db.scalar(select(func.count()).select_from(Evaluation)) == 2
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_released_contract_ignores_duplicate_before_another_match_is_bound(case):
    db, board, option, old, _ = case
    bind_match(db, board, old)
    handle_evaluate(db, job(board, old))
    evaluation_id = option.final_evaluation_id
    assert evaluate_board(db, board.id, old.id) == 0
    assert option.status == "LOCKED"
    assert option.final_evaluation_id == evaluation_id
    assert db.scalar(select(func.count()).select_from(Evaluation)) == 1


def test_cached_old_binding_cannot_overwrite_a_new_attempt_after_provider_wait(case):
    db, board, option, old, new = case
    bind_match(db, board, old)
    # Production SessionLocal keeps objects after commits. A slow old handler
    # can cache its board/options before another worker completes that attempt.
    with Session(db.get_bind(), expire_on_commit=False) as waiting:
        cached_board = waiting.get(ContractBoard, board.id)
        cached_option = waiting.get(BoardOption, option.id)
        waiting.commit()
        assert cached_option.bound_match_id == old.id
        handle_evaluate(db, job(board, old))
        bind_match(db, board, new)
        board.attempts_used = 3
        db.commit()
        assert evaluate_board(waiting, cached_board.id, old.id) == 0
    db.refresh(option)
    db.refresh(board)
    assert option.bound_match_id == new.id
    assert option.status == "VERIFYING"
    assert board.status == "VERIFYING"
    assert board.attempts_used == 3
    assert db.scalar(select(func.count()).select_from(Evaluation)) == 1


def test_review_refresh_scores_only_its_exact_historical_assignment(case):
    db, board, option, old, new = case
    bind_match(db, board, old)
    participant = db.scalar(select(MatchParticipant).where(MatchParticipant.match_id == old.id))
    participant.assists = None
    db.commit()
    evaluate_board(db, board.id, old.id)
    assert option.status == "REVIEW_REQUIRED"
    review = db.scalar(select(AutoReviewCase).where(AutoReviewCase.match_id == old.id))
    assert review.status == "PENDING"
    mission = MissionDefinition(
        key="other-assists", title="Other assist", description="Other assist",
        metric="player.assists", operator="gte", target=8, reward_xp=100,
        required_capabilities=["summary.assists"], game_match_mode="STANDARD",
    )
    db.add(mission)
    db.flush()
    other = BoardOption(
        board_id=board.id, mission_definition_id=mission.id,
        rendered_title="Another assist", rendered_description="Another assist",
        metric="player.assists", operator="gte", target=8, reward_xp=100,
        selected=True, status="VERIFYING", bound_match_id=new.id,
        required_game_match_mode="STANDARD", required_capabilities=["summary.assists"],
        conditions=list(option.conditions),
    )
    db.add(other)
    participant.assists = 8
    db.commit()
    assert evaluate_board(db, board.id, old.id) == 1
    assert option.status == "COMPLETED"
    assert other.status == "VERIFYING"
    assert other.bound_match_id == new.id
    assert board.status == "VERIFYING"
    assert review.status == "RESOLVED"


@pytest.mark.parametrize("completed", [False, True])
def test_reclaimed_discovery_cannot_rebind_a_case_advanced_by_its_replacement(case, completed):
    db, board, option, old, new = case
    discovery = enqueue_job(db, "discover_match", {"board_id": board.id}, "stale-discovery")
    with Session(db.get_bind(), expire_on_commit=False) as waiting:
        cached_board = waiting.get(ContractBoard, board.id)
        cached_option = waiting.get(BoardOption, option.id)
        original = claim_next_job(waiting, "old-worker")
        assert original.id == discovery.id
        owner = ("old-worker", original.attempts)
        waiting.commit()
        assert cached_board.status == cached_option.status == "LOCKED"

        db.refresh(discovery)
        discovery.locked_at = datetime.now(timezone.utc) - timedelta(minutes=11)
        db.commit()
        replacement = claim_next_job(db, "replacement")
        assert replacement.id == original.id and replacement.attempts == 2
        bind_match(db, board, new)
        assert complete_job(db, replacement, owner=("replacement", replacement.attempts))
        if completed:
            handle_evaluate(db, job(board, new))
        db.refresh(board)
        db.refresh(option)
        before = (board.status, board.attempts_used, board.baseline_match_id,
                  option.status, option.bound_match_id, option.final_evaluation_id)
        jobs_before = db.scalar(select(func.count()).select_from(Job))
        evaluations_before = db.scalar(select(func.count()).select_from(Evaluation))
        outbox_before = db.scalar(select(func.count()).select_from(OutboxEvent))

        bind_match(waiting, cached_board, old)
        assert not complete_job(waiting, original, owner=owner)

    db.refresh(board)
    db.refresh(option)
    assert (board.status, board.attempts_used, board.baseline_match_id,
            option.status, option.bound_match_id, option.final_evaluation_id) == before
    assert db.scalar(select(func.count()).select_from(Job)) == jobs_before
    assert db.scalar(select(func.count()).select_from(Evaluation)) == evaluations_before
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == outbox_before
