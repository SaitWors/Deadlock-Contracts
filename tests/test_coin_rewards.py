from dataclasses import replace
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import (ArchiveLedger, BoardOption, ContractBoard, Evaluation,
                        Match, MatchParticipant, MissionDefinition, OutboxEvent,
                        RewardLedgerEntry, User)


def service():
    # Import inside the test so a missing implementation produces a failing test.
    from app.services import coin_rewards
    return coin_rewards


@pytest.fixture()
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'coins.db'}")
    with Session(engine, autoflush=False) as session:
        yield session
    engine.dispose()


def setup(db, *, mode="STANDARD", difficulty="FOCUSED", count=1,
          played=None, provider="deadlock_api", snapshot=True, user=None):
    rewards = service()
    Base.metadata.create_all(db.get_bind())
    user = user or User(account_id=uuid4().int % 10**9)
    db.add(user)
    db.flush()
    played = played or datetime(2026, 10, 12, 15, tzinfo=timezone.utc)
    board_count = db.scalar(select(func.count()).select_from(ContractBoard).where(ContractBoard.user_id == user.id))
    board = ContractBoard(user_id=user.id, board_date=played.date() + timedelta(days=board_count), seed=str(uuid4()),
                          game_match_mode=mode, status="LOCKED", locked_at=played - timedelta(hours=2),
                          expires_at=played + timedelta(hours=5))
    db.add(board)
    db.flush()
    options = []
    for _ in range(count):
        mission = MissionDefinition(key=str(uuid4()), version=1, title="Kills", description="Kills",
                                    metric="player.kills", operator="gte", target=5, reward_xp=10)
        db.add(mission)
        db.flush()
        option = BoardOption(board_id=board.id, mission_definition_id=mission.id,
                             rendered_title="Kills", rendered_description="Kills", metric="player.kills",
                             operator="gte", target=5, reward_xp=10, difficulty=difficulty,
                             selected=True, status="LOCKED", locked_at=board.locked_at,
                             required_game_match_mode=mode, required_capabilities=["summary.kills"])
        db.add(option)
        options.append(option)
    db.flush()
    if snapshot:
        rewards.snapshot_signing(db, board)
    match = Match(external_match_id=uuid4().int % 10**14, provider=provider,
                  started_at=played - timedelta(minutes=25), ended_at=played, duration_s=1500,
                  game_match_mode=mode, mode_classifier_version="mode-test", mode_confidence="HIGH",
                  scoring_status="SCORED", is_final=True, capabilities=["summary.kills"])
    db.add(match)
    db.flush()
    db.add(MatchParticipant(match_id=match.id, account_id=user.account_id, kills=10))
    for option in options:
        evaluation = Evaluation(assignment_id=option.id, match_id=match.id, status="COMPLETED",
                                evaluator_version="test", explanation="Independent final result",
                                facts=[{"metric": "player.kills", "value": 10, "passed": True}])
        db.add(evaluation)
        db.flush()
        option.status = "COMPLETED"
        option.bound_match_id = match.id
        option.final_evaluation_id = evaluation.id
        option.settled_at = played + timedelta(minutes=1)
    board.status = "SETTLED"
    db.flush()
    return user, board, options, match


def deliver_all(db):
    rewards = service()
    events = list(db.scalars(select(OutboxEvent).where(OutboxEvent.event_type == "coin.reward")))
    for event in events:
        rewards.deliver_entitlement(db, event.payload["entitlement_id"])
    db.flush()


@pytest.mark.parametrize("mode,difficulty,want", [
    ("STANDARD", "LIGHT", 6), ("STANDARD", "FOCUSED", 10),
    ("STANDARD", "HARD", 16), ("STANDARD", "EXTREME", 24),
    ("RANKED", "LIGHT", 6), ("RANKED", "FOCUSED", 10),
    ("RANKED", "HARD", 16), ("RANKED", "EXTREME", 24),
    ("STREET_BRAWL", "LIGHT", 3), ("STREET_BRAWL", "FOCUSED", 5),
    ("STREET_BRAWL", "HARD", 8), ("STREET_BRAWL", "EXTREME", 12),
])
def test_signed_policy_decides_award_without_rarity_multiplier(db, mode, difficulty, want):
    rewards = service()
    user, _, options, _ = setup(db, mode=mode, difficulty=difficulty)
    options[0].difficulty = "LIGHT"  # A later catalog mutation cannot change the signed price.
    options[0].rarity = "EPIC"
    result = rewards.settle_assignment(db, options[0].id)
    assert result["amount"] == want
    assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 0
    deliver_all(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.user_id == user.id)) == want


def test_duplicate_settlement_and_delivery_are_independent_of_existing_xp(db):
    rewards = service()
    user, _, options, _ = setup(db)
    db.add(RewardLedgerEntry(user_id=user.id, source_type="assignment", source_id=options[0].id,
                            delta=10, balance_after=10))
    first = rewards.settle_assignment(db, options[0].id)
    db.commit()
    second = rewards.settle_assignment(db, options[0].id)
    assert second["id"] == first["id"]
    deliver_all(db)
    deliver_all(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 10
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_daily_partial_zero_decisions_do_not_move_to_a_later_period(db):
    rewards = service()
    user, _, options, _ = setup(db, difficulty="EXTREME", count=3)
    for option in options:
        rewards.settle_assignment(db, option.id)
    # 24 + 24 + 24 + the 10 case bonus is capped at 80.
    _, _, later, _ = setup(db, difficulty="EXTREME", user=user)
    zero = rewards.settle_assignment(db, later[0].id)
    assert zero["amount"] == 0
    assert zero["reason"] == "DAILY_LIMIT"
    deliver_all(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 80
    assert rewards.settle_assignment(db, later[0].id)["id"] == zero["id"]
    status = rewards.status(db, user.id, now=datetime(2026, 10, 13, tzinfo=timezone.utc))
    assert status["quotas"]["daily"]["remaining"] == 80
    assert status["quotas"]["weekly"]["remaining"] == 320


def test_weekly_quota_includes_cases_and_uses_match_period(db):
    rewards = service()
    user = None
    for day in range(5):
        user, _, options, _ = setup(db, difficulty="EXTREME", count=3, user=user,
                                    played=datetime(2026, 10, 12 + day, 15, tzinfo=timezone.utc))
        for option in options:
            rewards.settle_assignment(db, option.id)
    _, _, options, _ = setup(db, user=user, played=datetime(2026, 10, 17, 15, tzinfo=timezone.utc))
    receipt = rewards.settle_assignment(db, options[0].id)
    assert receipt["amount"] == 0
    assert receipt["reason"] == "WEEKLY_LIMIT"
    assert receipt["period_day"] == "2026-10-17"
    deliver_all(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 400


@pytest.mark.parametrize("provider", ["gep", "deadlock_api+gep", "mock", "demo", "unknown", "invented"])
def test_client_demo_and_unknown_provider_cannot_mint_coins(db, provider):
    rewards = service()
    _, _, options, _ = setup(db, provider=provider)
    receipt = rewards.settle_assignment(db, options[0].id)
    assert receipt["amount"] == 0
    assert receipt["reason"] == "UNTRUSTED_RESULT"
    deliver_all(db)
    assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 0


@pytest.mark.parametrize("field,value,reason", [
    ("ended_at", None, "MISSING_MATCH_TIME"),
    ("is_final", False, "UNTRUSTED_RESULT"),
    ("scoring_status", "VERIFYING", "UNTRUSTED_RESULT"),
    ("integrity_status", "CLIENT_ATTESTED_GEP", "UNTRUSTED_RESULT"),
    ("capabilities", [], "UNTRUSTED_RESULT"),
])
def test_incomplete_or_client_facts_are_not_payable(db, field, value, reason):
    rewards = service()
    _, _, options, match = setup(db)
    setattr(match, field, value)
    receipt = rewards.settle_assignment(db, options[0].id)
    assert receipt["amount"] == 0
    assert receipt["reason"] == reason


def test_historical_completion_has_no_implicit_policy(db):
    rewards = service()
    _, _, options, _ = setup(db, snapshot=False)
    receipt = rewards.settle_assignment(db, options[0].id)
    assert receipt["amount"] == 0
    assert receipt["reason"] == "NO_SIGNED_POLICY"
    assert rewards.snapshot_signing(db, options[0].board) == 0


def test_batch_history_distinguishes_historical_pending_and_decided(db):
    rewards = service()
    user, _, options, _ = setup(db)
    _, _, historical, _ = setup(db, user=user, snapshot=False)
    pending = rewards.assignment_receipts(db, [options[0].id, historical[0].id], user.id)
    assert pending[options[0].id]["status"] == "PENDING"
    assert pending[options[0].id]["nominal_amount"] == 10
    assert pending[historical[0].id]["reason"] == "NO_SIGNED_POLICY"
    assert rewards.assignment_receipts(db, [options[0].id], str(uuid4())) == {}
    receipt = rewards.settle_assignment(db, options[0].id)
    assert rewards.assignment_receipts(db, [options[0].id], user.id)[options[0].id]["id"] == receipt["id"]


def test_case_bonus_requires_every_selected_contract(db):
    rewards = service()
    user, board, options, _ = setup(db, count=2)
    options[1].status = "FAILED"
    rewards.settle_assignment(db, options[0].id)
    rewards.settle_assignment(db, options[1].id)
    deliver_all(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 10
    assert rewards.assignment_receipt(db, options[0].id, user.id)["amount"] == 10
    assert rewards.assignment_receipt(db, options[0].id, str(uuid4())) is None


def test_correction_is_append_only_idempotent_and_does_not_release_quota(db):
    rewards = service()
    user, _, options, _ = setup(db)
    receipt = rewards.settle_assignment(db, options[0].id)
    deliver_all(db)
    db.add(ArchiveLedger(user_id=user.id, source="spent-fixture", reason="DIRECT_CARD", delta=-10))
    db.flush()
    key = str(uuid4())
    corrected = rewards.correct_entitlement(db, receipt["id"], request_key=key,
                                           actor_user_id=user.id, reason="Invalid independent result")
    assert corrected["delta"] == -10
    assert rewards.correct_entitlement(db, receipt["id"], request_key=key,
                                      actor_user_id=user.id, reason="Invalid independent result")["id"] == corrected["id"]
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == -10
    status = rewards.status(db, user.id, now=datetime(2026, 10, 12, tzinfo=timezone.utc))
    assert status["quotas"]["daily"]["used"] == 10
    _, _, later, _ = setup(db, user=user)
    rewards.settle_assignment(db, later[0].id)
    deliver_all(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 0


def test_reservation_rolls_back_with_its_outbox_event(db):
    rewards = service()
    user, _, options, _ = setup(db)
    db.commit()
    rewards.settle_assignment(db, options[0].id)
    db.rollback()
    assert rewards.assignment_receipt(db, options[0].id, user.id) is None
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == 0
    assert rewards.settle_assignment(db, options[0].id)["amount"] == 10


def test_coin_delivery_pause_preserves_queue_while_xp_continues(db, monkeypatch):
    rewards = service()
    from app import worker
    user, _, options, _ = setup(db)
    rewards.settle_assignment(db, options[0].id)
    db.add(OutboxEvent(event_type="assignment.settled", aggregate_id=options[0].id,
                       payload={"user_id": user.id, "assignment_id": options[0].id,
                                "status": "COMPLETED", "reward_xp": 10}))
    db.commit()
    monkeypatch.setattr(worker, "settings", replace(worker.settings, coin_rewards_enabled=False))
    assert worker.dispatch_outbox(db)
    assert db.get(User, user.id).xp == 10
    assert not worker.dispatch_outbox(db)
    assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 0
    monkeypatch.setattr(worker, "settings", replace(worker.settings, coin_rewards_enabled=True))
    assert worker.dispatch_outbox(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 10


def test_reversing_completed_contract_also_reverses_its_case_bonus(db):
    rewards = service()
    user, board, options, _ = setup(db, count=2)
    for option in options:
        rewards.settle_assignment(db, option.id)
    deliver_all(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 30
    receipt = rewards.assignment_receipt(db, options[0].id, user.id)
    result = rewards.correct_entitlement(db, receipt["id"], request_key=str(uuid4()),
                                         actor_user_id=user.id, reason="Contract was invalid")
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 10
    assert result["related_corrections"][0]["delta"] == -10
    assert rewards.case_receipts(db, [board.id], user.id)[board.id]["status"] == "CORRECTED"


def test_delivery_revalidates_final_decision_without_releasing_quota(db):
    rewards = service()
    user, _, options, _ = setup(db)
    rewards.settle_assignment(db, options[0].id)
    options[0].status = "FAILED"
    deliver_all(db)
    assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 0
    assert rewards.assignment_receipt(db, options[0].id, user.id)["status"] == "INVALIDATED"
    assert rewards.status(db, user.id, now=datetime(2026, 10, 12, tzinfo=timezone.utc))["quotas"]["daily"]["used"] == 10


def test_coin_period_is_utc_even_when_provider_timestamp_has_an_offset(db):
    rewards = service()
    user, _, options, match = setup(db, played=datetime(2026, 10, 13, 1, tzinfo=timezone(timedelta(hours=3))))
    receipt = rewards.settle_assignment(db, options[0].id)
    assert receipt["amount"] == 10
    assert receipt["period_day"] == "2026-10-12"
    assert rewards.status(db, user.id, now=datetime(2026, 10, 13, 1, tzinfo=timezone(timedelta(hours=3))))["quotas"]["daily"]["used"] == 10


def test_real_board_signing_captures_newly_selected_options_without_autoflush(db, monkeypatch):
    rewards = service()
    from app.services import boards
    user, board, options, _ = setup(db, snapshot=False)
    board.status, board.locked_at = "OFFERED", None
    for option in options:
        option.selected, option.status, option.locked_at = False, "OFFERED", None
        option.settled_at, option.final_evaluation_id = None, None
    db.commit()
    now = datetime(2026, 10, 12, 13, tzinfo=timezone.utc)
    monkeypatch.setattr(boards, "today_utc", lambda: now.date())
    monkeypatch.setattr(boards, "utcnow", lambda: now)
    boards.lock_board(db, user, [options[0].id])
    assert rewards.assignment_receipts(db, [options[0].id], user.id)[options[0].id]["status"] == "PENDING"


def test_real_evaluator_reserves_before_delayed_outbox_without_autoflush(db):
    rewards = service()
    from app.services.evaluator import evaluate_board
    user, board, options, match = setup(db)
    board.status, board.attempts_used = "LOCKED", 1
    for option in options:
        option.status, option.settled_at, option.final_evaluation_id = "LOCKED", None, None
    db.commit()
    assert evaluate_board(db, board.id, match.id) == 1
    assert rewards.assignment_receipt(db, options[0].id, user.id)["amount"] == 10
    assert rewards.assignment_receipt(db, options[0].id, user.id)["status"] == "RESERVED"
    assert db.scalar(select(func.count()).select_from(ArchiveLedger)) == 0


@pytest.mark.parametrize("original_status", ["LOCKED", "VERIFYING", "REVIEW_REQUIRED"])
def test_real_expiry_persists_a_final_zero_coin_decision(db, original_status):
    rewards = service()
    from app.services.boards import expire_board
    user, board, options, _ = setup(db)
    board.status = original_status
    options[0].status, options[0].settled_at = original_status, None
    db.commit()
    assert expire_board(db, board, now=board.expires_at.replace(tzinfo=timezone.utc) + timedelta(seconds=1))
    receipt = rewards.assignment_receipt(db, options[0].id, user.id)
    assert receipt["amount"] == 0
    assert receipt["status"] == "REJECTED"
    assert receipt["reason"] == "NOT_COMPLETED"


def test_corrected_contract_cannot_reserve_a_later_case_bonus(db):
    rewards = service()
    user, board, options, _ = setup(db, count=2)
    receipt = rewards.settle_assignment(db, options[0].id)
    rewards.correct_entitlement(db, receipt["id"], request_key=str(uuid4()),
                                 actor_user_id=user.id, reason="Invalid contract")
    rewards.settle_assignment(db, options[1].id)
    assert rewards.case_receipts(db, [board.id], user.id) == {}
    assert rewards.status(db, user.id, now=datetime(2026, 10, 12, tzinfo=timezone.utc))["quotas"]["daily"]["used"] == 20


def test_late_approval_of_older_match_cannot_move_case_bonus_to_earlier_quota(db):
    rewards = service()
    user, board, options, _ = setup(db, count=2, played=datetime(2026, 10, 12, 23, 50, tzinfo=timezone.utc))
    later = Match(external_match_id=uuid4().int % 10**14, provider="deadlock_api",
                  started_at=datetime(2026, 10, 13, 0, 5, tzinfo=timezone.utc),
                  ended_at=datetime(2026, 10, 13, 0, 30, tzinfo=timezone.utc), duration_s=1500,
                  game_match_mode="STANDARD", mode_classifier_version="mode-test", mode_confidence="HIGH",
                  scoring_status="SCORED", is_final=True,
                  capabilities=["summary.kills"])
    db.add(later)
    db.flush()
    db.add(MatchParticipant(match_id=later.id, account_id=user.account_id, kills=10))
    options[1].bound_match_id = later.id
    db.get(Evaluation, options[1].final_evaluation_id).match_id = later.id
    db.flush()
    rewards.settle_assignment(db, options[1].id)
    rewards.settle_assignment(db, options[0].id)
    receipt = rewards.case_receipts(db, [board.id], user.id)[board.id]
    assert receipt["amount"] == 10
    assert receipt["period_day"] == "2026-10-13"
    assert rewards.status(db, user.id, now=later.ended_at)["quotas"]["daily"]["used"] == 20


def test_suspended_recipient_does_not_block_global_expiry_reconciliation(db):
    rewards = service()
    from app.services.boards import expire_stale_boards
    inactive, first, first_options, _ = setup(db)
    _, second, second_options, _ = setup(db)
    inactive.status = "SUSPENDED"
    for board, options in ((first, first_options), (second, second_options)):
        board.status = "LOCKED"
        board.expires_at = datetime(2026, 10, 12, tzinfo=timezone.utc)
        options[0].status, options[0].settled_at = "LOCKED", None
    db.commit()
    assert expire_stale_boards(db) == 2
    assert rewards.assignment_receipt(db, first_options[0].id, inactive.id)["status"] == "REJECTED"
    assert db.get(ContractBoard, second.id).status == "EXPIRED"


def test_suspension_preserves_existing_reward_obligations_and_corrections(db):
    rewards = service()
    user, _, options, _ = setup(db)
    user.status = "SUSPENDED"
    db.commit()
    receipt = rewards.settle_assignment(db, options[0].id)
    assert receipt["amount"] == 10
    deliver_all(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 10
    correction = rewards.correct_entitlement(db, receipt["id"], request_key=str(uuid4()),
                                             actor_user_id=user.id, reason="Invalid result after suspension")
    assert correction["delta"] == -10
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 0
