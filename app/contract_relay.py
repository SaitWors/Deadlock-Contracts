from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import AuditLog, ContractRelayConnection, User, utcnow
from .relay_models import RelayFriendship
from .services.auth import require_csrf, require_user
from .services.relay_state import connection_status, iso, utc


PROFILE_PATH = "/api/profile/contract-relay"
ADMIN_PATH = "/api/admin/users/{user_id}/contract-relay"
player_router = APIRouter()


class RelayReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["confirm", "clear", "disconnect"]


def _connection(db: Session, user_id: str) -> ContractRelayConnection | None:
    return db.scalar(select(ContractRelayConnection).where(ContractRelayConnection.user_id == user_id))


def _lock_user(db: Session, user_id: str) -> User:
    # Serialize consent and admin review through the user row, including when consent is absent.
    user = db.get(User, user_id, populate_existing=True, with_for_update=True)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    return user


def _payload(response: Response, db: Session, connection: ContractRelayConnection | None) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    return {"connection": None if connection is None else {
        "id": connection.id,
        "consented_at": iso(connection.consented_at),
        "friendship_confirmed_at": iso(connection.friendship_confirmed_at),
        **connection_status(db, connection),
    }}


@player_router.get(PROFILE_PATH)
def get_connection(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    return _payload(response, db, _connection(db, user.id))


@player_router.put(PROFILE_PATH, dependencies=[Depends(require_csrf)])
def opt_in(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    user = _lock_user(db, user.id)
    if user.status != "ACTIVE" or not user.steam_id64 or not user.account_id:
        raise HTTPException(409, "Для участия требуется активный аккаунт Steam")
    connection = _connection(db, user.id)
    if connection is None:
        connection = ContractRelayConnection(user_id=user.id)
        db.add(connection)
        db.commit()
    return _payload(response, db, connection)


@player_router.delete(PROFILE_PATH, dependencies=[Depends(require_csrf)])
def opt_out(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    _lock_user(db, user.id)
    connection = _connection(db, user.id)
    if connection is not None:
        db.delete(connection)
        db.commit()
    return _payload(response, db, None)


def build_admin_router(require_admin) -> APIRouter:
    router = APIRouter()

    @router.get(ADMIN_PATH)
    def get_player_connection(
        user_id: UUID, response: Response, admin: User = Depends(require_admin), db: Session = Depends(get_db),
    ) -> dict:
        if db.get(User, str(user_id)) is None:
            raise HTTPException(404, "Пользователь не найден")
        return _payload(response, db, _connection(db, str(user_id)))

    @router.patch(ADMIN_PATH + "/{connection_id}", dependencies=[Depends(require_csrf)])
    def review_connection(
        user_id: UUID, connection_id: UUID, review: RelayReview, response: Response,
        admin: User = Depends(require_admin), db: Session = Depends(get_db),
    ) -> dict:
        user = _lock_user(db, str(user_id))
        connection = db.scalar(
            select(ContractRelayConnection).where(ContractRelayConnection.user_id == user.id).with_for_update()
        )
        if connection is None or connection.id != str(connection_id):
            raise HTTPException(409, "Запись об участии изменилась. Обновите страницу")
        if review.action == "confirm" and user.status != "ACTIVE":
            raise HTTPException(409, "Подтверждение доступно для активного игрока")

        if review.action == "disconnect":
            db.delete(connection)
            connection = None
        elif review.action == "confirm":
            if connection.friendship_confirmed_at is not None:
                return _payload(response, db, connection)
            connection.friendship_confirmed_at = utcnow()
        else:
            if connection.friendship_confirmed_at is None and connection_status(db, connection)["status"] != "connected":
                return _payload(response, db, connection)
            connection.friendship_confirmed_at = None
            latest = db.scalar(select(func.max(RelayFriendship.observed_at)).where(
                RelayFriendship.connection_id == connection.id
            ))
            now = utcnow()
            connection.friendship_cleared_at = max(now, utc(latest)) if latest else now
        db.add(AuditLog(
            user_id=admin.id, action=f"admin.contract_relay_{review.action}",
            entity_type="user", entity_id=user.id, data={},
        ))
        db.commit()
        return _payload(response, db, connection)

    return router
