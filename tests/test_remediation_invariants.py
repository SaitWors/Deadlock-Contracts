from __future__ import annotations

from datetime import datetime, timedelta, timezone
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.db import Base
from app.config import settings
from app.models import (
    BoardOption,
    ContractBoard,
    Job,
    Match,
    MissionDefinition,
    OutboxEvent,
    RewardLedgerEntry,
    User,
)
from app.services.boards import GENERATOR_VERSION, lock_board, serialize_board, today_utc
from app.services.companion import _validated_client_timestamp, companion_version_supported, wake_discovery
from app.services.localization import error_metadata
from app.security import _rate_identities, _rate_rule
from app.worker import (
    _is_duplicate_reward_integrity_error,
    dispatch_outbox,
)


def _engine():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return engine


def test_heartbeat_wakes_attempt_suffixed_discovery_job() -> None:
    with Session(_engine()) as db:
        user = User(
            steam_id64=76561198980887041,
            account_id=1020621313,
            display_name="Wake Test",
        )
        db.add(user)
        db.flush()
        board = ContractBoard(
            user_id=user.id,
            board_date=today_utc(),
            status="LOCKED",
            game_match_mode="STANDARD",
            seed="wake-discovery",
            locked_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=6),
        )
        db.add(board)
        db.flush()
        original_run_after = datetime.now(timezone.utc) + timedelta(hours=1)
        job = Job(
            type="discover_match",
            user_id=user.id,
            board_id=board.id,
            payload={"board_id": board.id},
            idempotency_key=f"discover:{board.id}:attempt:1",
            run_after=original_run_after,
        )
        db.add(job)
        db.commit()

        woken = wake_discovery(db, user.id, "STANDARD")

        assert woken == [board.id]
        assert job.run_after < original_run_after


def test_lock_and_first_discovery_job_are_one_transaction() -> None:
    with Session(_engine()) as db:
        user = User(
            steam_id64=76561198980887041,
            account_id=1020621313,
            display_name="Atomic Lock Test",
        )
        mission = MissionDefinition(
            key="atomic-lock",
            version=2,
            title="Atomic lock",
            description="Atomic lock",
            metric="player.kills",
            operator="gte",
            target=5,
            reward_xp=50,
            required_capabilities=["summary.kills"],
            game_match_mode="STANDARD",
        )
        db.add_all([user, mission])
        db.flush()
        board = ContractBoard(
            user_id=user.id,
            board_date=today_utc(),
            status="OFFERED",
            game_match_mode="STANDARD",
            seed="atomic-lock",
            generator_version=GENERATOR_VERSION,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=6),
        )
        db.add(board)
        db.flush()
        option = BoardOption(
            board_id=board.id,
            mission_definition_id=mission.id,
            rendered_title=mission.title,
            rendered_description=mission.description,
            metric=mission.metric,
            operator=mission.operator,
            target=mission.target,
            reward_xp=mission.reward_xp,
            conditions=[
                {
                    "metric": mission.metric,
                    "operator": mission.operator,
                    "target": mission.target,
                    "capabilities": ["summary.kills"],
                }
            ],
            required_capabilities=["summary.kills"],
            required_game_match_mode="STANDARD",
        )
        db.add(option)
        db.commit()
        board_id = board.id
        option_id = option.id

        with patch(
            "app.services.boards.enqueue_job",
            side_effect=RuntimeError("injected enqueue failure"),
        ):
            with pytest.raises(RuntimeError, match="injected enqueue failure"):
                lock_board(db, user, [option_id], "STANDARD")
        db.rollback()
        db.expire_all()

        persisted_board = db.get(ContractBoard, board_id)
        persisted_option = db.get(BoardOption, option_id)
        assert persisted_board is not None
        assert persisted_board.status == "OFFERED"
        assert persisted_board.locked_at is None
        assert persisted_option is not None
        assert persisted_option.status == "OFFERED"
        assert persisted_option.selected is False
        assert db.scalar(select(Job).where(Job.payload["board_id"].as_string() == board_id)) is None


def test_database_enforces_one_active_case_per_user_and_mode() -> None:
    with Session(_engine()) as db:
        user = User(
            steam_id64=76561198980887041,
            account_id=1020621313,
            display_name="Active Case Constraint",
        )
        db.add(user)
        db.flush()
        db.add(
            ContractBoard(
                user_id=user.id,
                board_date=today_utc() - timedelta(days=1),
                status="LOCKED",
                game_match_mode="STANDARD",
                seed="active-case-one",
                locked_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(hours=6),
            )
        )
        db.commit()

        db.add(
            ContractBoard(
                user_id=user.id,
                board_date=today_utc(),
                status="VERIFYING",
                game_match_mode="STANDARD",
                seed="active-case-two",
                locked_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(hours=6),
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_consumer_board_hides_generator_internals_and_stringifies_match_id() -> None:
    with Session(_engine()) as db:
        user = User(
            steam_id64=76561198980887041,
            account_id=1020621313,
            display_name="Safe Board Serialization",
        )
        mission = MissionDefinition(
            key="safe-board",
            version=1,
            title="Safe board",
            description="Safe board",
            title_en="Safe board EN",
            description_en="Safe board description EN",
            metric="player.kills",
            operator="gte",
            target=5,
            reward_xp=50,
            game_match_mode="STANDARD",
        )
        match = Match(
            external_match_id=9_223_372_036_854_775_000,
            provider="test",
            mode_classifier_version="test",
        )
        db.add_all([user, mission, match])
        db.flush()
        board = ContractBoard(
            user_id=user.id,
            board_date=today_utc(),
            status="LOCKED",
            game_match_mode="STANDARD",
            seed="must-not-leak",
            generator_history=[{"secret": "must-not-leak"}],
            locked_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=6),
        )
        db.add(board)
        db.flush()
        option = BoardOption(
            board_id=board.id,
            mission_definition_id=mission.id,
            rendered_title=mission.title,
            rendered_description=mission.description,
            metric=mission.metric,
            operator=mission.operator,
            target=mission.target,
            reward_xp=mission.reward_xp,
            fingerprint="must-not-leak",
            generator_meta={
                "adaptive": {"profile": "FOCUSED"},
                "seed": "must-not-leak",
            },
            bound_match_id=match.id,
        )
        db.add(option)
        db.commit()
        db.refresh(board)

        payload = serialize_board(board)
        serialized_option = payload["options"][0]

        assert "seed" not in payload
        assert "generator_history" not in payload
        assert "fingerprint" not in serialized_option
        assert "generator_meta" not in serialized_option
        assert serialized_option["personalization"] == {"profile": "FOCUSED"}
        assert serialized_option["title_i18n"] == {"ru": "Safe board", "en": "Safe board EN"}
        assert serialized_option["description_i18n"]["en"] == "Safe board description EN"
        assert serialized_option["bound_match_id"] == "9223372036854775000"


def test_client_timestamps_are_diagnostic_and_server_bounded() -> None:
    now = datetime.now(timezone.utc)
    valid = (now - timedelta(minutes=1)).isoformat()

    assert _validated_client_timestamp(valid, now=now) == valid
    assert _validated_client_timestamp((now + timedelta(minutes=6)).isoformat(), now=now) is None
    assert _validated_client_timestamp((now - timedelta(days=90)).isoformat(), now=now) is None
    assert _validated_client_timestamp("2026-08-24T12:00:00", now=now) is None
    assert _validated_client_timestamp("not-a-date", now=now) is None


def test_minimum_companion_version_orders_prereleases_safely() -> None:
    floor = "0.5.2-alpha.5"
    assert companion_version_supported("0.5.2-alpha.5", floor) is True
    assert companion_version_supported("0.5.2-alpha.6", floor) is True
    assert companion_version_supported("0.5.2-beta.1", floor) is True
    assert companion_version_supported("0.5.2", floor) is True
    assert companion_version_supported("0.5.2-alpha.4", floor) is False
    assert companion_version_supported("not-a-version", floor) is False


def test_error_contract_is_stable_and_localized() -> None:
    error = error_metadata("Доска не найдена", 404, "en")

    assert error == {
        "code": "BOARD_NOT_FOUND",
        "message_key": "errors.board_not_found",
        "message": "Board not found",
    }


def test_rate_limit_uses_route_ip_and_hashed_device_identity() -> None:
    token = "secret-device-token-that-must-not-enter-redis"
    identities = _rate_identities(
        "companion-heartbeat",
        "203.0.113.9",
        Headers({"Authorization": f"Bearer {token}"}),
    )

    assert identities[0] == "companion-heartbeat:ip:203.0.113.9"
    assert identities[1].startswith("companion-heartbeat:device:")
    assert all(token not in item for item in identities)
    assert _rate_rule("/api/companion/heartbeat") == (
        "companion-heartbeat",
        180,
        60,
    )


class _ConstraintFailure(Exception):
    def __init__(self, constraint_name: str):
        super().__init__(constraint_name)
        self.diag = SimpleNamespace(constraint_name=constraint_name)


def test_only_reward_source_unique_constraint_counts_as_duplicate() -> None:
    duplicate = IntegrityError(
        "insert reward",
        {},
        _ConstraintFailure("uq_reward_source"),
    )
    unrelated = IntegrityError(
        "insert reward",
        {},
        _ConstraintFailure("fk_reward_user"),
    )
    assert _is_duplicate_reward_integrity_error(duplicate) is True
    assert _is_duplicate_reward_integrity_error(unrelated) is False


def test_unrelated_outbox_integrity_error_is_retried_not_published() -> None:
    with Session(_engine()) as db:
        user = User(
            steam_id64=76561198980887041,
            account_id=1020621313,
            display_name="Outbox Test",
        )
        db.add(user)
        db.flush()
        event = OutboxEvent(
            event_type="assignment.settled",
            aggregate_id="outbox-integrity",
            payload={
                "status": "COMPLETED",
                "reward_xp": 100,
                "assignment_id": "assignment-integrity",
                "user_id": user.id,
            },
            run_after=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        db.add(event)
        db.commit()
        event_id = event.id

        real_commit = db.commit
        commit_count = 0

        def fail_first_commit() -> None:
            nonlocal commit_count
            commit_count += 1
            if commit_count == 1:
                raise IntegrityError(
                    "insert reward",
                    {},
                    _ConstraintFailure("fk_reward_user"),
                )
            real_commit()

        with patch.object(db, "commit", side_effect=fail_first_commit):
            assert dispatch_outbox(db) is True

        db.expire_all()
        persisted = db.get(OutboxEvent, event_id)
        assert persisted is not None
        assert persisted.published_at is None
        assert persisted.attempts == 1
        assert persisted.dead_lettered_at is None
        assert persisted.last_error
        assert db.scalar(
            select(RewardLedgerEntry).where(
                RewardLedgerEntry.source_id == "assignment-integrity"
            )
        ) is None


def test_reward_kill_switch_keeps_settlement_durable_and_unpublished() -> None:
    with Session(_engine()) as db:
        user = User(
            steam_id64=76561198980887041,
            account_id=1020621313,
            display_name="Reward Freeze",
        )
        db.add(user)
        db.flush()
        event = OutboxEvent(
            event_type="assignment.settled",
            aggregate_id="reward-freeze",
            payload={
                "status": "COMPLETED",
                "reward_xp": 100,
                "assignment_id": "assignment-freeze",
                "user_id": user.id,
            },
            run_after=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        db.add(event)
        db.commit()

        with patch(
            "app.worker.settings",
            replace(settings, reward_settlement_enabled=False),
        ):
            assert dispatch_outbox(db) is False

        db.refresh(event)
        db.refresh(user)
        assert event.published_at is None
        assert event.dead_lettered_at is None
        assert event.attempts == 0
        assert user.xp == 0
