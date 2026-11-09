from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import date, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import BoardOption, ContractBoard, MissionDefinition, OutboxEvent, RewardLedgerEntry, User, utcnow
from app.services.case_completion import maybe_capture_result
from test_player_community import community


def _case(factory, user_id, statuses=("COMPLETED",), *, attempts=3, board_status="SETTLED", nominal_xp=50):
    with factory() as db:
        board = ContractBoard(
            user_id=user_id, board_date=date(2026, 1, 1), seed=str(uuid4()),
            status=board_status, game_match_mode="STANDARD", attempts_used=attempts,
            max_attempts=3, expires_at=utcnow() - timedelta(days=1),
        )
        db.add(board)
        db.flush()
        task_ids = []
        for index, status in enumerate(statuses):
            mission = MissionDefinition(
                key=f"completion-{uuid4()}", title=f"Задание {index}", title_en=f"Task {index}",
                description="Completion fixture", metric="player.kills", operator="gte", target=1,
                reward_xp=nominal_xp,
            )
            db.add(mission)
            db.flush()
            option = BoardOption(
                board_id=board.id, mission_definition_id=mission.id,
                rendered_title=mission.title, rendered_description=mission.description,
                metric=mission.metric, operator=mission.operator, target=mission.target,
                reward_xp=nominal_xp, selected=True, status=status,
                created_at=utcnow() + timedelta(seconds=index),
            )
            db.add(option)
            db.flush()
            task_ids.append(option.id)
        db.commit()
        return board.id, task_ids


def _award(factory, user_id, task_id, *, delta=50, source_type="assignment", asset="XP", balance_after=None):
    with factory() as db:
        user = db.get(User, user_id)
        user.xp = user.xp + delta if balance_after is None else balance_after
        db.add(RewardLedgerEntry(
            user_id=user_id, source_id=task_id, source_type=source_type, asset=asset,
            delta=delta, balance_after=user.xp,
        ))
        db.commit()


def _completion(client, board_id):
    response = client.get(f"/api/boards/{board_id}/completion")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    return response.json()


@pytest.mark.parametrize("task_count", [1, 2, 3])
def test_completed_case_can_finish_early_with_actual_awarded_xp(community, task_count):
    factory, player = community
    user_id, client = player("Finisher")
    board_id, task_ids = _case(factory, user_id, ("COMPLETED",) * task_count, attempts=1, nominal_xp=500)
    for task_id in task_ids:
        _award(factory, user_id, task_id, delta=30)

    result = _completion(client, board_id)

    assert result["board_id"] == board_id
    assert result["ready"] is True
    assert result["replayable"] is True
    assert result["reason"] is None
    assert result["user"] == {"id": user_id, "display_name": "Finisher", "avatar_url": None}
    assert result["attempts_used"] == 1
    assert result["max_attempts"] == 3
    assert [task["id"] for task in result["tasks"]] == task_ids
    assert [task["xp"] for task in result["tasks"]] == [30] * task_count
    assert result["tasks"][0]["title_i18n"] == {"ru": "Задание 0", "en": "Task 0"}
    assert result["total_xp"] == 30 * task_count
    assert result["progression"]["before"]["total_xp"] == 0
    assert result["progression"]["after"]["total_xp"] == 30 * task_count


def test_completed_case_waits_for_asynchronous_reward_receipt(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id, ("COMPLETED", "COMPLETED"))
    _award(factory, user_id, task_ids[0], delta=30)

    result = _completion(client, board_id)

    assert result["ready"] is False
    assert result["reason"] == "REWARDS_PENDING"
    assert [task["status"] for task in result["tasks"]] == ["COMPLETED", "COMPLETED"]
    assert [task["xp"] for task in result["tasks"]] == [30, 0]
    assert result["total_xp"] == 30
    _award(factory, user_id, task_ids[1], delta=40)
    assert _completion(client, board_id)["ready"] is True


@pytest.mark.parametrize("status,board_status,reason", [
    ("VERIFYING", "VERIFYING", "VERIFYING"),
    ("REVIEW_REQUIRED", "REVIEW_REQUIRED", "REVIEW_REQUIRED"),
    ("LOCKED", "LOCKED", "IN_PROGRESS"),
    ("VERIFYING", "SETTLED", "VERIFYING"),
    ("REVIEW_REQUIRED", "SETTLED", "REVIEW_REQUIRED"),
])
def test_last_attempt_does_not_finish_unresolved_tasks(community, status, board_status, reason):
    factory, player = community
    user_id, client = player()
    board_id, _ = _case(factory, user_id, (status,), board_status=board_status)

    result = _completion(client, board_id)

    assert result["ready"] is False
    assert result["reason"] == reason
    with factory() as db:
        assert db.get(ContractBoard, board_id).status == board_status
        assert db.scalar(select(BoardOption.status).where(BoardOption.board_id == board_id)) == status


@pytest.mark.parametrize("statuses", [("FAILED",), ("FAILED", "VOID", "EXPIRED")])
def test_final_failed_case_has_zero_xp_and_preserves_outcomes(community, statuses):
    factory, player = community
    user_id, client = player()
    board_id, _ = _case(factory, user_id, statuses)

    result = _completion(client, board_id)

    assert result["ready"] is True
    assert result["total_xp"] == 0
    assert result["replayable"] is False
    assert [task["status"] for task in result["tasks"]] == list(statuses)
    assert result["progression"]["before"] == result["progression"]["after"]


def test_mixed_case_uses_only_completed_task_receipts(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id, ("COMPLETED", "FAILED", "VOID"))
    for task_id in task_ids:
        _award(factory, user_id, task_id, delta=25)

    result = _completion(client, board_id)

    assert result["ready"] is True
    assert [task["xp"] for task in result["tasks"]] == [25, 0, 0]
    assert result["total_xp"] == 25
    assert result["progression"]["before"]["total_xp"] == 0
    assert result["progression"]["after"]["total_xp"] == 25


@pytest.mark.parametrize("statuses,attempts,board_status", [
    (("COMPLETED", "FAILED"), 1, "SETTLED"),
    (("COMPLETED",), 1, "LOCKED"),
    (("FAILED",), 3, "EXPIRED"),
    ((), 3, "SETTLED"),
    (("COMPLETED",) * 4, 3, "SETTLED"),
])
def test_only_a_settled_case_with_valid_selection_can_finish(community, statuses, attempts, board_status):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id, statuses, attempts=attempts, board_status=board_status)
    for task_id in task_ids:
        _award(factory, user_id, task_id)

    result = _completion(client, board_id)

    assert result["ready"] is False
    assert result["reason"] == "IN_PROGRESS"


@pytest.mark.parametrize("source_type", ["assignment", "AUTO_REVIEW", "MANUAL_EVIDENCE"])
def test_reward_receipts_accept_each_trusted_source(community, source_type):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id)
    _award(factory, user_id, task_ids[0], delta=15, source_type=source_type)

    result = _completion(client, board_id)

    assert result["ready"] is True
    assert result["total_xp"] == 15


@pytest.mark.parametrize("source_type,asset,delta", [
    ("ADMIN_ADJUSTMENT", "XP", 50),
    ("assignment", "COIN", 50),
    ("assignment", "XP", -50),
    ("assignment", "XP", 0),
])
def test_untrusted_non_xp_and_nonpositive_receipts_cannot_supply_awarded_xp(community, source_type, asset, delta):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id)
    _award(factory, user_id, task_ids[0], delta=delta, source_type=source_type, asset=asset)

    result = _completion(client, board_id)

    assert result["ready"] is False
    assert result["reason"] == "REWARDS_PENDING"
    assert result["total_xp"] == 0


def test_zero_nominal_xp_completion_does_not_wait_for_a_reward(community):
    factory, player = community
    user_id, client = player()
    board_id, _ = _case(factory, user_id, nominal_xp=0)

    result = _completion(client, board_id)

    assert result["ready"] is True
    assert result["total_xp"] == 0


def test_progression_replay_uses_actual_ledger_balances_and_exact_level_boundary(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id)
    # Levels 1 and 2 cost 130 and 170 XP. Later unrelated XP must not
    # rewrite the real case receipt, which crossed from 120 to 300.
    _award(factory, user_id, task_ids[0], delta=180, balance_after=300)
    with factory() as db:
        db.get(User, user_id).xp = 900
        db.commit()

    result = _completion(client, board_id)

    assert result["progression"]["before"]["total_xp"] == 120
    assert result["progression"]["after"]["total_xp"] == 300
    assert result["progression"]["after"]["level"] == 3
    assert result["progression"]["levels"] == [
        {"level": 1, "start_xp": 0, "end_xp": 130},
        {"level": 2, "start_xp": 130, "end_xp": 300},
        {"level": 3, "start_xp": 300, "end_xp": 520},
    ]


def test_impossible_ledger_start_shows_static_final_without_inventing_a_start(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id)
    _award(factory, user_id, task_ids[0], delta=500, balance_after=20)

    result = _completion(client, board_id)

    assert result["total_xp"] == 500
    assert result["replayable"] is False
    assert result["progression"]["before"] is None
    assert result["progression"]["after"]["total_xp"] == 20
    assert result["progression"]["levels"] == []


def test_receipt_is_private_to_owner_and_unknown_board_is_not_found(community):
    factory, player = community
    user_id, client = player()
    _, other = player("Other")
    board_id, _ = _case(factory, user_id)

    assert other.get(f"/api/boards/{board_id}/completion").status_code == 404
    assert client.get(f"/api/boards/{uuid4()}/completion").status_code == 404
    client.cookies.clear()
    assert client.get(f"/api/boards/{board_id}/completion").status_code == 401


def test_reading_or_replaying_receipt_never_settles_or_awards_again(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id)
    with factory() as db:
        db.add(OutboxEvent(event_type="assignment.settled", aggregate_id=task_ids[0], payload={
            "assignment_id": task_ids[0], "user_id": user_id, "status": "COMPLETED", "reward_xp": 50,
        }))
        db.commit()

    assert _completion(client, board_id)["reason"] == "REWARDS_PENDING"
    _award(factory, user_id, task_ids[0], delta=40)
    first = _completion(client, board_id)
    assert first == _completion(client, board_id)
    with factory() as db:
        assert db.get(User, user_id).xp == 40
        assert db.scalar(select(func.count()).select_from(RewardLedgerEntry)) == 1
        assert db.scalar(select(OutboxEvent.published_at)) is None
        assert db.get(ContractBoard, board_id).status == "SETTLED"
        assert db.get(ContractBoard, board_id).completion_result is None


def test_historical_receipt_stays_identical_after_later_profile_xp(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id)
    _award(factory, user_id, task_ids[0], delta=60, balance_after=300)
    first = _completion(client, board_id)
    with factory() as db:
        db.get(User, user_id).xp = 950
        db.commit()

    assert _completion(client, board_id) == first
    assert first["progression"]["before"]["total_xp"] == 240
    assert first["progression"]["after"]["total_xp"] == 300
    with factory() as db:
        assert db.get(ContractBoard, board_id).completion_result is None


def test_old_zero_xp_case_has_no_fabricated_profile_progression(community):
    factory, player = community
    user_id, client = player()
    board_id, _ = _case(factory, user_id, ("FAILED",))
    first = _completion(client, board_id)
    with factory() as db:
        db.get(User, user_id).xp = 700
        db.commit()

    assert _completion(client, board_id) == first
    assert first["replayable"] is False
    assert first["progression"] == {"before": None, "after": None, "levels": []}


def test_interleaved_noncase_xp_makes_old_case_static_even_if_balances_chain(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id, ("COMPLETED", "COMPLETED"))
    _award(factory, user_id, task_ids[0], delta=40)
    # Net-zero unrelated activity still makes a continuous case-only replay
    # historically misleading, even though the case balances fit together.
    _award(factory, user_id, "other-plus", delta=20, source_type="ADMIN_ADJUSTMENT")
    _award(factory, user_id, "other-minus", delta=-20, source_type="ADMIN_ADJUSTMENT")
    _award(factory, user_id, task_ids[1], delta=60)

    result = _completion(client, board_id)

    assert result["ready"] is True
    assert result["replayable"] is False
    assert result["total_xp"] == 100
    assert result["progression"]["before"] is None
    assert result["progression"]["after"]["total_xp"] == 100


def test_multiple_trusted_sources_for_one_task_do_not_invent_replay_order(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id)
    _award(factory, user_id, task_ids[0], delta=30)
    _award(factory, user_id, task_ids[0], delta=20, source_type="AUTO_REVIEW")

    result = _completion(client, board_id)

    assert result["replayable"] is False
    assert result["total_xp"] == 50
    assert result["tasks"][0]["xp"] == 50
    assert result["progression"]["before"] is None
    assert result["progression"]["after"]["total_xp"] == 50


def test_new_uncertain_case_saves_static_actual_profile_once(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id, ("COMPLETED", "COMPLETED"))
    _award(factory, user_id, task_ids[0], delta=30)
    _award(factory, user_id, "other", delta=100, source_type="ADMIN_ADJUSTMENT")
    _award(factory, user_id, task_ids[1], delta=20)
    with factory() as db:
        db.get(User, user_id).xp = 400
        db.commit()
    # A session that read the empty snapshot before another worker saved it
    # must not replace that first result when it later tries to capture.
    with factory() as stale, factory() as current:
        stale_board = stale.get(ContractBoard, board_id)
        assert stale_board.completion_result is None
        saved = maybe_capture_result(current, board_id)
        current.commit()
        with factory() as later:
            later.get(User, user_id).xp = 800
            later.commit()
        assert maybe_capture_result(stale, board_id) == saved
        stale.commit()

    result = _completion(client, board_id)
    assert result["result_source"] == "saved"
    assert result["replayable"] is False
    assert result["progression"]["before"] is None
    assert result["progression"]["after"]["total_xp"] == 400
    assert {key: value for key, value in result.items() if key != "user"} == saved


@pytest.mark.parametrize("statuses,nominal_xp", [(("FAILED", "VOID"), 50), (("COMPLETED",), 0)])
def test_new_zero_xp_case_captures_known_unchanged_profile(community, statuses, nominal_xp):
    factory, player = community
    user_id, client = player()
    board_id, _ = _case(factory, user_id, statuses, nominal_xp=nominal_xp)
    with factory() as db:
        db.get(User, user_id).xp = 300
        saved = maybe_capture_result(db, board_id)
        db.commit()
        assert saved["replayable"] is True
    first = _completion(client, board_id)
    with factory() as db:
        db.get(User, user_id).xp = 900
        db.commit()

    assert _completion(client, board_id) == first
    assert first["progression"]["before"] == first["progression"]["after"]
    assert first["progression"]["after"]["total_xp"] == 300


def test_worker_saves_after_last_actual_reward_and_retries_never_award_again(community, monkeypatch):
    from app import worker
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id, ("COMPLETED", "COMPLETED"))
    monkeypatch.setattr(worker, "settings", replace(worker.settings, reward_settlement_enabled=True))

    def deliver(task_id, reward):
        with factory() as db:
            db.add(OutboxEvent(event_type="assignment.settled", aggregate_id=task_id, payload={
                "assignment_id": task_id, "board_id": board_id, "user_id": user_id,
                "status": "COMPLETED", "reward_xp": reward,
            }))
            db.commit()
            assert worker.dispatch_outbox(db) is True

    deliver(task_ids[0], 30)
    with factory() as db:
        assert db.get(ContractBoard, board_id).completion_result is None
        assert db.get(User, user_id).xp == 30
    deliver(task_ids[1], 40)
    first = _completion(client, board_id)
    assert first["ready"] is True
    assert first["replayable"] is True
    assert first["result_source"] == "saved"
    assert [task["xp"] for task in first["tasks"]] == [30, 40]
    assert first["progression"]["before"]["total_xp"] == 0
    assert first["progression"]["after"]["total_xp"] == 70
    with factory() as db:
        db.get(User, user_id).xp = 600
        db.commit()
    deliver(task_ids[1], 40)

    assert _completion(client, board_id) == first
    with factory() as db:
        assert db.get(User, user_id).xp == 600
        assert db.scalar(select(func.count()).select_from(RewardLedgerEntry)) == 2
        assert db.scalar(select(func.count()).select_from(OutboxEvent).where(OutboxEvent.published_at.is_not(None))) == 3


def test_failed_outbox_captures_zero_xp_without_writing_a_ledger_entry(community, monkeypatch):
    from app import worker
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id, ("FAILED",))
    monkeypatch.setattr(worker, "settings", replace(worker.settings, reward_settlement_enabled=True))
    with factory() as db:
        db.get(User, user_id).xp = 180
        db.add(OutboxEvent(event_type="assignment.settled", aggregate_id=task_ids[0], payload={
            "assignment_id": task_ids[0], "user_id": user_id, "status": "FAILED", "reward_xp": 0,
        }))
        db.commit()
        assert worker.dispatch_outbox(db) is True
        assert db.scalar(select(func.count()).select_from(RewardLedgerEntry)) == 0
        assert db.get(User, user_id).xp == 180

    result = _completion(client, board_id)
    assert result["result_source"] == "saved"
    assert result["replayable"] is True
    assert result["progression"]["before"] == result["progression"]["after"]
    assert result["progression"]["after"]["total_xp"] == 180


def test_concurrent_capture_returns_the_same_first_saved_receipt(tmp_path, monkeypatch):
    from app.services import case_completion as completion_service

    engine = create_engine(f"sqlite:///{tmp_path / 'concurrent-receipt.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        user = User(display_name="Concurrent", xp=160)
        db.add(user)
        db.commit()
        user_id = user.id
    board_id, _ = _case(factory, user_id, ("FAILED",))
    barrier = Barrier(2)
    build_result = completion_service._result

    def simultaneous_result(db, board, **kwargs):
        result = build_result(db, board, **kwargs)
        # Distinct candidates prove the losing writer returns the first saved
        # receipt rather than overwriting it or returning its own candidate.
        result["capture_token"] = uuid4().hex
        barrier.wait(timeout=10)
        return result

    monkeypatch.setattr(completion_service, "_result", simultaneous_result)

    def capture():
        with factory() as db:
            receipt = maybe_capture_result(db, board_id)
            db.commit()
            return receipt

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first, second = list(executor.map(lambda _: capture(), range(2)))
        assert first == second
        assert first["progression"]["after"]["total_xp"] == 160
        with factory() as db:
            assert db.get(ContractBoard, board_id).completion_result == first
            assert db.get(User, user_id).xp == 160
            assert db.scalar(select(func.count()).select_from(RewardLedgerEntry)) == 0
    finally:
        engine.dispose()
