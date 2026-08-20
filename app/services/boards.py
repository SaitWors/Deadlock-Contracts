from __future__ import annotations

import hashlib
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..models import (
    AuditLog,
    BoardOption,
    ContractBoard,
    DailyRefreshState,
    Match,
    MatchParticipant,
    MissionDefinition,
    User,
)
from .jobs import enqueue_job
from .contract_factory import GENERATOR_VERSION, generate_contracts_v2
from .adaptive_profile import build_adaptive_profile

GAME_MODES = ("STANDARD", "RANKED", "STREET_BRAWL")
BOARD_SIZE = 6
MAX_SELECTED = 3
FREE_REROLLS_PER_DAY = 1


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def today_utc() -> date:
    """Логический день доски.

    Новый день начинается в BOARD_RESET_HOUR_UTC.
    При значении 3 это 03:00 UTC / 06:00 МСК.
    """
    return (
        utcnow()
        - timedelta(hours=settings.board_reset_hour_utc)
    ).date()

def _expiry(board_date: date) -> datetime:
    return datetime.combine(
        board_date + timedelta(days=1),
        time(hour=settings.board_reset_hour_utc),
        tzinfo=timezone.utc,
    )

def normalize_mode(mode: str | None) -> str:
    value = (mode or "STANDARD").strip().upper().replace("-", "_").replace(" ", "_")
    aliases = {"UNRANKED": "STANDARD", "NORMAL": "STANDARD", "BRAWL": "STREET_BRAWL", "STREETBRAWL": "STREET_BRAWL"}
    value = aliases.get(value, value)
    if value not in GAME_MODES:
        raise ValueError("Неизвестный режим матча")
    return value


def next_board_reset(
    now: datetime | None = None,
) -> datetime:
    current = now or utcnow()

    day = (
        current
        - timedelta(hours=settings.board_reset_hour_utc)
    ).date()

    return datetime.combine(
        day + timedelta(days=1),
        time(hour=settings.board_reset_hour_utc),
        tzinfo=timezone.utc,
    )


def expire_board(
    db: Session,
    board: ContractBoard,
    *,
    now: datetime | None = None,
) -> bool:
    current = now or utcnow()

    expires = board.expires_at

    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    # Если матч уже найден и идёт проверка —
    # не убиваем дело посреди серверной обработки.
    if board.status != "LOCKED" or expires > current:
        return False

    board.status = "EXPIRED"

    for option in board.options:
        if (
            option.selected
            and option.status
            not in {"COMPLETED", "FAILED", "EXPIRED"}
        ):
            option.status = "EXPIRED"
            option.settled_at = current
            option.explanation = (
                option.explanation
                or "Срок дела истёк. "
                   "Неиспользованные попытки сгорели."
            )

    db.add(
        AuditLog(
            user_id=board.user_id,
            action="board.expired",
            entity_type="board",
            entity_id=board.id,
            data={
                "attempts_used": board.attempts_used,
                "max_attempts": board.max_attempts,
            },
        )
    )

    db.commit()
    return True


def expire_stale_boards(db: Session) -> int:
    current = utcnow()

    boards = list(
        db.scalars(
            select(ContractBoard)
            .options(
                selectinload(ContractBoard.options)
            )
            .where(
                ContractBoard.status == "LOCKED",
                ContractBoard.expires_at <= current,
            )
        ).all()
    )

    count = 0

    for board in boards:
        if expire_board(db, board, now=current):
            count += 1

    return count


def _expire_old_offers(
    db: Session,
    user_id: str,
    mode: str,
) -> None:
    stale = list(
        db.scalars(
            select(ContractBoard)
            .options(
                selectinload(ContractBoard.options)
            )
            .where(
                ContractBoard.user_id == user_id,
                ContractBoard.game_match_mode == mode,
                ContractBoard.status == "OFFERED",
                ContractBoard.board_date < today_utc(),
            )
        ).all()
    )

    if not stale:
        return

    for board in stale:
        board.status = "EXPIRED"

        for option in board.options:
            if option.status == "OFFERED":
                option.status = "SKIPPED"

    db.commit()


def _load_board(
    db: Session,
    user_id: str,
    mode: str,
    *,
    for_update: bool = False,
) -> ContractBoard | None:

    # Уже принятое дело важнее новой дневной доски.
    # Оно переживает ежедневный reset,
    # пока не завершится или не истечёт.
    active_stmt = (
        select(ContractBoard)
        .options(
            selectinload(ContractBoard.options)
            .selectinload(BoardOption.match)
        )
        .where(
            ContractBoard.user_id == user_id,
            ContractBoard.game_match_mode == mode,
            ContractBoard.status.in_(
                (
                    "LOCKED",
                    "VERIFYING",
                    "REVIEW_REQUIRED",
                )
            ),
        )
        .order_by(
            ContractBoard.locked_at.asc().nullslast()
        )
    )

    if for_update:
        active_stmt = active_stmt.with_for_update()

    active = db.scalar(active_stmt)

    if active:
        if (
            active.status == "LOCKED"
            and expire_board(db, active)
        ):
            active = None
        else:
            return active

    stmt = (
        select(ContractBoard)
        .options(
            selectinload(ContractBoard.options)
            .selectinload(BoardOption.match)
        )
        .where(
            ContractBoard.user_id == user_id,
            ContractBoard.board_date == today_utc(),
            ContractBoard.game_match_mode == mode,
        )
    )

    if for_update:
        stmt = stmt.with_for_update()

    return db.scalar(stmt)

def _refresh_state(db: Session, user_id: str, *, for_update: bool = False) -> DailyRefreshState:
    stmt = select(DailyRefreshState).where(DailyRefreshState.user_id == user_id, DailyRefreshState.board_date == today_utc())
    if for_update:
        stmt = stmt.with_for_update()
    state = db.scalar(stmt)
    if state:
        return state
    state = DailyRefreshState(user_id=user_id, board_date=today_utc())
    db.add(state)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        state = db.scalar(stmt)
        if state:
            return state
        raise
    db.refresh(state)
    return state


def _eligible_missions(db: Session, mode: str) -> list[MissionDefinition]:
    return list(
        db.scalars(
            select(MissionDefinition).where(
                MissionDefinition.status == "PUBLISHED",
                MissionDefinition.version == 2,
                MissionDefinition.game_match_mode == mode,
            ).order_by(MissionDefinition.key)
        ).all()
    )


def _recent_generator_context(db: Session, board: ContractBoard) -> tuple[set[str], set[str]]:
    fingerprints: set[str] = set()
    signatures: set[str] = set()
    rows = list(
        db.scalars(
            select(BoardOption)
            .join(ContractBoard, ContractBoard.id == BoardOption.board_id)
            .where(
                ContractBoard.user_id == board.user_id,
                ContractBoard.game_match_mode == board.game_match_mode,
                ContractBoard.id != board.id,
                BoardOption.fingerprint.is_not(None),
            )
            .order_by(BoardOption.created_at.desc())
            .limit(72)
        ).all()
    )
    for option in rows:
        if option.fingerprint:
            fingerprints.add(option.fingerprint)
        meta = option.generator_meta or {}
        signature = str(meta.get("metric_signature") or "").strip()
        if signature:
            signatures.add(signature)
    for entry in board.generator_history or []:
        for fingerprint in entry.get("fingerprints", []) if isinstance(entry, dict) else []:
            if fingerprint:
                fingerprints.add(str(fingerprint))
        for signature in entry.get("metric_signatures", []) if isinstance(entry, dict) else []:
            if signature:
                signatures.add(str(signature))
    return fingerprints, signatures


def _generate_set(db: Session, board: ContractBoard, missions: list[MissionDefinition]):
    recent_fingerprints, recent_signatures = _recent_generator_context(db, board)
    profile = build_adaptive_profile(db, board.user, board.game_match_mode)
    return generate_contracts_v2(
        missions,
        board.seed,
        board_size=BOARD_SIZE,
        recent_fingerprints=recent_fingerprints,
        recent_metric_signatures=recent_signatures,
        adaptive_profile=profile,
    )


def _populate_options(db: Session, board: ContractBoard) -> None:
    missions = _eligible_missions(db, board.game_match_mode)
    selected = _generate_set(db, board, missions)
    board.generator_version = GENERATOR_VERSION
    for contract in selected:
        db.add(
            BoardOption(
                board_id=board.id,
                mission_definition_id=contract.mission_definition_id,
                rendered_title=contract.title,
                rendered_description=contract.description,
                metric=contract.metric,
                operator=contract.operator,
                target=contract.target,
                reward_xp=contract.reward_xp,
                difficulty=contract.difficulty,
                rarity=contract.rarity,
                drop_chance_pct=contract.drop_chance_pct,
                category=contract.category,
                conditions=[item.payload() for item in contract.conditions],
                fingerprint=contract.fingerprint,
                generator_meta=contract.generator_meta,
                required_capabilities=list(contract.required_capabilities),
                required_game_match_mode=contract.game_match_mode,
            )
        )



def upgrade_offered_boards_to_contracts_v2(db: Session) -> int:
    """Regenerate only still-OFFERED legacy boards with Contracts 2.0.

    Locked/settled/history boards are immutable. Existing offers can be replaced
    safely because the user has not committed contract selections yet.
    """
    boards = list(
        db.scalars(
            select(ContractBoard)
            .where(
                ContractBoard.status == "OFFERED",
                ContractBoard.generator_version != GENERATOR_VERSION,
            )
            .with_for_update()
        ).all()
    )
    upgraded = 0
    for board in boards:
        old_version = board.generator_version or "legacy-v3"
        old_options = list(
            db.scalars(
                select(BoardOption).where(BoardOption.board_id == board.id)
            ).all()
        )
        old_snapshot = {
            "generator_version": old_version,
            "titles": [option.rendered_title for option in old_options[:BOARD_SIZE]],
        }
        history = list(board.generator_history or [])
        history.append(old_snapshot)
        board.generator_history = history[-8:]

        db.execute(delete(BoardOption).where(BoardOption.board_id == board.id))
        board.seed = hashlib.sha256(
            (
                f"{board.user_id}:"
                f"{board.board_date.isoformat()}:"
                f"{board.game_match_mode}:"
                f"{board.generation}:board-v4"
            ).encode()
        ).hexdigest()
        board.generator_version = GENERATOR_VERSION
        _populate_options(db, board)
        db.add(
            AuditLog(
                user_id=board.user_id,
                action="board.generator_upgraded",
                entity_type="board",
                entity_id=board.id,
                data={
                    "from": old_version,
                    "to": GENERATOR_VERSION,
                    "mode": board.game_match_mode,
                    "generation": board.generation,
                },
            )
        )
        upgraded += 1
    return upgraded

def ensure_daily_board(
    db: Session,
    user: User,
    mode: str = "STANDARD",
) -> ContractBoard:

    mode = normalize_mode(mode)

    _expire_old_offers(
        db,
        user.id,
        mode,
    )

    board = _load_board(
        db,
        user.id,
        mode,
    )

    if board:
        return board

    day = today_utc()

    generation = 0

    seed = hashlib.sha256(
        (
            f"{user.id}:"
            f"{day.isoformat()}:"
            f"{mode}:"
            f"{generation}:board-v4"
        ).encode()
    ).hexdigest()

    board = ContractBoard(
        user_id=user.id,
        board_date=day,
        seed=seed,
        generation=generation,
        generator_version=GENERATOR_VERSION,
        expires_at=_expiry(day),
        game_match_mode=mode,
    )

    db.add(board)
    db.flush()

    _populate_options(
        db,
        board,
    )

    db.add(
        AuditLog(
            user_id=user.id,
            action="board.created",
            entity_type="board",
            entity_id=board.id,
            data={
                "date": str(day),
                "mode": mode,
                "generation": generation,
            },
        )
    )

    try:
        db.commit()

    except IntegrityError:
        db.rollback()

    result = _load_board(
        db,
        user.id,
        mode,
    )

    if not result:
        raise RuntimeError(
            "Не удалось создать ежедневную доску"
        )

    return result

def ensure_daily_boards(db: Session, user: User) -> list[ContractBoard]:
    return [ensure_daily_board(db, user, mode) for mode in GAME_MODES]


def reroll_board(db: Session, user: User, mode: str) -> ContractBoard:
    mode = normalize_mode(mode)
    ensure_daily_board(db, user, mode)
    board = _load_board(db, user.id, mode, for_update=True)
    state = _refresh_state(db, user.id, for_update=True)
    if not board:
        raise ValueError("Доска не найдена")
    if board.status != "OFFERED":
        raise ValueError("После фиксации дела эту доску пересобрать нельзя")
    if state.free_rerolls_used >= FREE_REROLLS_PER_DAY:
        raise ValueError("Бесплатная пересборка на сегодня уже использована")

    current_fingerprints = [item.fingerprint for item in board.options if item.fingerprint]
    current_signatures = [str((item.generator_meta or {}).get("metric_signature") or "") for item in board.options if (item.generator_meta or {}).get("metric_signature")]
    history = list(board.generator_history or [])
    history.append({"generation": board.generation, "fingerprints": current_fingerprints, "metric_signatures": current_signatures})
    board.generator_history = history[-8:]
    board.generation += 1
    board.generator_version = GENERATOR_VERSION
    board.seed = hashlib.sha256(f"{user.id}:{board.board_date.isoformat()}:{mode}:{board.generation}:board-v4".encode()).hexdigest()
    board.offered_at = utcnow()
    db.execute(delete(BoardOption).where(BoardOption.board_id == board.id))
    db.flush()
    _populate_options(db, board)
    state.free_rerolls_used += 1
    state.last_mode = mode
    db.add(AuditLog(user_id=user.id, action="board.rerolled", entity_type="board", entity_id=board.id, data={"mode": mode, "generation": board.generation}))
    db.commit()
    result = _load_board(db, user.id, mode)
    if not result:
        raise RuntimeError("Не удалось загрузить пересобранную доску")
    return result


def lock_board(
    db: Session,
    user: User,
    option_ids: list[str],
    mode: str = "STANDARD",
) -> ContractBoard:

    mode = normalize_mode(mode)

    ensure_daily_board(
        db,
        user,
        mode,
    )

    board = _load_board(
        db,
        user.id,
        mode,
        for_update=True,
    )

    if not board:
        raise ValueError("Доска не найдена")

    if board.status != "OFFERED":
        raise ValueError(
            "Дело этого режима уже зафиксировано"
        )

    board_expiry = board.expires_at.replace(
        tzinfo=board.expires_at.tzinfo
        or timezone.utc
    )

    if board_expiry <= utcnow():
        raise ValueError(
            "Доска уже обновилась. "
            "Откройте новую подборку"
        )

    unique_ids = list(
        dict.fromkeys(option_ids)
    )

    if not 1 <= len(unique_ids) <= MAX_SELECTED:
        raise ValueError(
            "Нужно выбрать от 1 до 3 контрактов"
        )

    valid = {
        option.id: option
        for option in board.options
    }

    if any(
        option_id not in valid
        for option_id in unique_ids
    ):
        raise ValueError(
            "Выбран контракт не с текущей доски"
        )

    now = utcnow()

    board.status = "LOCKED"
    board.locked_at = now

    # После принятия срок daily board
    # превращается в персональный срок дела.
    board.expires_at = (
        now
        + timedelta(
            hours=settings.case_ttl_hours
        )
    )

    board.attempts_used = 0
    board.max_attempts = settings.case_max_attempts

    board.baseline_match_id = (
        db.scalar(
            select(
                func.max(
                    Match.external_match_id
                )
            )
            .join(
                MatchParticipant,
                MatchParticipant.match_id
                == Match.id,
            )
            .where(
                MatchParticipant.account_id
                == user.account_id
            )
        )
        if user.account_id is not None
        else None
    )

    for option in board.options:

        if option.id in unique_ids:
            option.selected = True
            option.status = "LOCKED"
            option.locked_at = now

        else:
            option.status = "SKIPPED"

    db.add(
        AuditLog(
            user_id=user.id,
            action="board.locked",
            entity_type="board",
            entity_id=board.id,
            data={
                "assignment_count": len(unique_ids),
                "mode": mode,
                "expires_at":
                    board.expires_at.isoformat(),
                "max_attempts":
                    board.max_attempts,
            },
        )
    )

    db.commit()

    enqueue_job(
        db,
        "discover_match",
        {"board_id": board.id},
        f"discover:{board.id}:attempt:1",
        max_attempts=settings.max_discovery_attempts,
    )

    result = _load_board(
        db,
        user.id,
        mode,
    )

    if not result:
        raise RuntimeError(
            "Не удалось загрузить "
            "зафиксированную доску"
        )

    return result

def refresh_summary(
    db: Session,
    user_id: str,
) -> dict:

    state = _refresh_state(
        db,
        user_id,
    )

    remaining = max(
        0,
        FREE_REROLLS_PER_DAY
        - state.free_rerolls_used,
    )

    return {
        "free_per_day":
            FREE_REROLLS_PER_DAY,
        "used":
            state.free_rerolls_used,
        "remaining":
            remaining,
        "last_mode":
            state.last_mode,
        "reset_at":
            next_board_reset().isoformat(),
        "reset_hour_msk":
            6,
    }

def serialize_board(
    board: ContractBoard,
) -> dict:

    active = board.status in {
        "LOCKED",
        "VERIFYING",
        "REVIEW_REQUIRED",
    }

    return {
        "id": board.id,
        "date":
            board.board_date.isoformat(),
        "status":
            board.status,
        "game_match_mode":
            board.game_match_mode,
        "generation":
            board.generation,
        "generator_version":
            board.generator_version,

        "attempts_used":
            board.attempts_used,
        "max_attempts":
            board.max_attempts,
        "attempts_remaining":
            max(
                0,
                board.max_attempts
                - board.attempts_used,
            ),

        "offered_at":
            board.offered_at.isoformat(),

        "locked_at":
            board.locked_at.isoformat()
            if board.locked_at
            else None,

        "expires_at":
            board.expires_at.isoformat(),

        "case_expires_at":
            board.expires_at.isoformat()
            if active
            else None,

        "daily_reset_at":
            next_board_reset().isoformat(),

        "next_board_ready":
            bool(
                active
                and board.board_date
                < today_utc()
            ),

        "options": [
            {
                "id": option.id,
                "title":
                    option.rendered_title,
                "description":
                    option.rendered_description,
                "metric":
                    option.metric,
                "operator":
                    option.operator,
                "target":
                    option.target,
                "reward_xp":
                    option.reward_xp,
                "difficulty":
                    option.difficulty,
                "rarity":
                    option.rarity,
                "drop_chance_pct":
                    option.drop_chance_pct,
                "category":
                    option.category,
                "conditions":
                    option.conditions or [],
                "fingerprint":
                    option.fingerprint,
                "generator_meta":
                    option.generator_meta or {},
                "selected":
                    option.selected,
                "status":
                    option.status,
                "progress_current":
                    option.progress_current,
                "progress_target":
                    option.progress_target,
                "explanation":
                    option.explanation,
                "bound_match_id":
                    option.match.external_match_id
                    if option.match
                    else None,
            }
            for option in sorted(
                board.options,
                key=lambda item:
                    item.created_at,
            )
        ],
    }

