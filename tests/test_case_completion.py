from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models import BoardOption, ContractBoard, MissionDefinition, OutboxEvent, RewardLedgerEntry, User, utcnow
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
    assert result["progression"]["before"]["total_xp"] == 50
    assert result["progression"]["after"]["total_xp"] == 75


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


def test_progression_replay_ends_at_current_balance_and_includes_exact_level_boundary(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id)
    # Levels 1 and 2 cost 130 and 170 XP. The case replays from 120 to 300,
    # regardless of the historic award balance and later unrelated XP.
    _award(factory, user_id, task_ids[0], delta=180, balance_after=180)
    with factory() as db:
        db.get(User, user_id).xp = 300
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


def test_balance_reduction_clamps_replay_start_without_changing_receipt(community):
    factory, player = community
    user_id, client = player()
    board_id, task_ids = _case(factory, user_id)
    _award(factory, user_id, task_ids[0], delta=500, balance_after=20)

    result = _completion(client, board_id)

    assert result["total_xp"] == 500
    assert result["progression"]["before"]["total_xp"] == 0
    assert result["progression"]["after"]["total_xp"] == 20


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
