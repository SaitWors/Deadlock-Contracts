from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Literal, TypedDict

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import (
    BoardMatchCandidate,
    BoardOption,
    ContractBoard,
    ContractRelayConnection,
    Job,
    Match,
    MatchParticipant,
    User,
)
from ..relay_models import RelayFriendship
from .auth import STEAM_ID64_BASE
from .public_badges import stored_public_badges
from .relay_state import FRESHNESS, observation_allowed, utc

TASK_TTL = timedelta(minutes=2)
TASK_LIMIT = 120
MAX_MATCH_ID = 2**63 - 1
MODES = ("STANDARD", "RANKED", "STREET_BRAWL")
HISTORY_CAPABILITIES = {
    "summary.result", "summary.kills", "summary.deaths", "summary.assists", "summary.net_worth", "summary.duration",
}


class Task(TypedDict):
    steam_id64: str
    operation: Literal["history", "metadata"]
    match_id: int | None
    waiting_since: datetime
    streamer: bool
    game_mode: str
    evidence: Literal["none", "stored_history"]
    locked_at: datetime
    baseline_match_id: int | None
    metadata_required: bool


def _capabilities(options: list[BoardOption]) -> set[str]:
    required = set()
    for option in options:
        required.update(str(value) for value in (option.required_capabilities or []) if value)
        for condition in option.conditions or []:
            if isinstance(condition, dict):
                required.update(str(value) for value in (condition.get("capabilities") or []) if value)
    return required


def _in_board_window(match: Match, board: ContractBoard, locked: datetime, now: datetime) -> bool:
    return (
        match.started_at is not None and locked < utc(match.started_at) <= now
        and match.game_match_mode == board.game_match_mode
        and (board.baseline_match_id or 0) < match.external_match_id <= MAX_MATCH_ID
    )


def task_snapshot(db: Session, node_id: str, now: datetime) -> dict:
    """Build a short-lived work set from live consent, friendship and contract state."""
    eligible = db.execute(
        select(ContractBoard, User, ContractRelayConnection, RelayFriendship)
        .join(User, User.id == ContractBoard.user_id)
        .join(ContractRelayConnection, ContractRelayConnection.user_id == User.id)
        .join(RelayFriendship, RelayFriendship.connection_id == ContractRelayConnection.id)
        .where(
            RelayFriendship.node_id == node_id,
            RelayFriendship.state == "connected",
            RelayFriendship.source.in_(("steam_session", "steam_web_api")),
            RelayFriendship.observed_at > now - FRESHNESS,
            ContractRelayConnection.auto_enrollment_expires_at.is_(None),
            User.status == "ACTIVE",
            User.relay_auto_enrollment_blocked.is_(False),
            User.account_id.between(1, 2**32 - 1),
            User.steam_id64 == STEAM_ID64_BASE + User.account_id,
            ContractBoard.locked_at <= now,
            ContractBoard.expires_at > now,
            ContractBoard.game_match_mode.in_(MODES),
            ContractBoard.status.in_(("LOCKED", "VERIFYING", "REVIEW_REQUIRED")),
        )
        .options(selectinload(ContractBoard.options.and_(BoardOption.selected.is_(True))))
        .order_by(ContractBoard.locked_at, ContractBoard.id)
    ).all()
    eligible = [row for row in eligible if observation_allowed(row[2], row[3].observed_at)]
    board_ids = [board.id for board, *_ in eligible]
    known: dict[str, list[tuple[BoardMatchCandidate, Match]]] = defaultdict(list)
    waiting: dict[str, set[str]] = defaultdict(set)
    if board_ids:
        for candidate, match in db.execute(
            select(BoardMatchCandidate, Match)
            .join(Match, Match.id == BoardMatchCandidate.match_id)
            .where(BoardMatchCandidate.board_id.in_(board_ids), BoardMatchCandidate.status.in_(("CAPTURED", "BOUND")))
        ):
            known[candidate.board_id].append((candidate, match))
        for board_id, match_id in db.execute(
            select(Job.board_id, Job.match_id).where(
                Job.board_id.in_(board_ids), Job.match_id.is_not(None),
                Job.type.in_(("evaluate_match", "refresh_review_match")), Job.status.in_(("PENDING", "RUNNING")),
            )
        ):
            waiting[board_id].add(match_id)

    match_ids = {option.bound_match_id for board, *_ in eligible for option in board.options if option.bound_match_id}
    match_ids.update(match.id for candidates in known.values() for _, match in candidates)
    owned = {}
    if match_ids:
        owned = {
            (match.id, account_id): match
            for match, account_id in db.execute(
                select(Match, MatchParticipant.account_id)
                .join(MatchParticipant, MatchParticipant.match_id == Match.id)
                .where(Match.id.in_(match_ids), Match.provider == "deadlock_api", Match.is_final.is_(True),
                       Match.integrity_status == "SERVER_VERIFIED")
            )
        }

    tasks: list[tuple[Task, datetime]] = []
    for board, user, _, friendship in eligible:
        locked = utc(board.locked_at)
        streamer = "STREAMER" in stored_public_badges(user)
        expires = min(utc(board.expires_at), utc(friendship.observed_at) + FRESHNESS)
        baseline = board.baseline_match_id
        started_waiting = locked
        locked_options = [option for option in board.options if option.status == "LOCKED"]
        pending = defaultdict(list)
        dates = {}
        for option in board.options:
            if option.status in ("VERIFYING", "REVIEW_REQUIRED") and option.bound_match_id in waiting[board.id]:
                pending[option.bound_match_id].append(option)
        captured = False
        for candidate, match in known[board.id]:
            if candidate.status == "BOUND":
                baseline = max(baseline or 0, match.external_match_id)
                if candidate.bound_at is not None:
                    started_waiting = max(started_waiting, utc(candidate.bound_at))
            if (match.id, user.account_id) not in owned or not _in_board_window(match, board, locked, now):
                continue
            if candidate.status == "CAPTURED" and locked_options:
                captured = True
                pending[match.id].extend(locked_options)
            dates[match.id] = utc(candidate.bound_at or candidate.captured_at)

        for match_id, options in pending.items():
            match = owned.get((match_id, user.account_id))
            if (
                not match or not _in_board_window(match, board, locked, now)
                or match.relay_provider_metadata_observed_at is not None
                or (_capabilities(options).issubset(match.capabilities or []) and match.duration_s is not None)
            ):
                continue
            tasks.append((Task(
                steam_id64=str(user.steam_id64), operation="metadata", match_id=match.external_match_id,
                waiting_since=min(now, max(locked, dates.get(match.id, locked))), streamer=streamer,
                game_mode=board.game_match_mode, evidence="stored_history", locked_at=locked,
                baseline_match_id=board.baseline_match_id, metadata_required=True,
            ), expires))

        if (board.status == "LOCKED" and locked_options and not captured and board.attempts_used < board.max_attempts
                and (baseline is None or 0 < baseline <= MAX_MATCH_ID)
                and not any(option.status == "VERIFYING" and option.bound_match_id for option in board.options)):
            tasks.append((Task(
                steam_id64=str(user.steam_id64), operation="history", match_id=None,
                waiting_since=min(now, started_waiting), streamer=streamer, game_mode=board.game_match_mode,
                evidence="none", locked_at=locked, baseline_match_id=baseline,
                metadata_required=bool(_capabilities(locked_options) - HISTORY_CAPABILITIES),
            ), expires))

    tasks.sort(key=lambda item: (item[0]["waiting_since"], item[0]["steam_id64"], item[0]["match_id"] or 0))
    selected = tasks[:TASK_LIMIT]
    expires_at = min((expires for _, expires in selected), default=now + TASK_TTL)
    return {
        "protocol_version": 1,
        "schema_version": 1,
        "generated_at": now,
        "expires_at": min(now + TASK_TTL, expires_at),
        "tasks": [task for task, _ in selected],
    }
