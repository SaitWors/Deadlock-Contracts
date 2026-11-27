from __future__ import annotations

import re
from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, undefer

from .db import get_db
from .models import AuditLog, ContractRelayConnection, User, utcnow
from .relay_models import RelayFriendship
from .services.auth import require_csrf, require_user
from .services.relay_state import connection_status, iso, utc


PROFILE_PATH = "/api/profile/contract-relay"
ADMIN_PATH = "/api/admin/users/{user_id}/contract-relay"
ADMIN_REVIEW_PATH = ADMIN_PATH + "/{connection_id}"
QUICK_INVITE_PATH = "/quick-invite"
RELAY_STEAM_PROFILE = "https://steamcommunity.com/id/deadlock-contracts-relay/"
QUICK_INVITE_URL = re.compile(r"https://s\.team/p/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/[A-Za-z0-9]+")
player_router = APIRouter()


class RelayReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["confirm", "clear", "disconnect"]


class RelayQuickInvite(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    url: SecretStr = Field(max_length=128)


def _connection(db: Session, user_id: str) -> ContractRelayConnection | None:
    return db.scalar(select(ContractRelayConnection).where(ContractRelayConnection.user_id == user_id))


def _lock_user(db: Session, user_id: str) -> User:
    # Serialize consent and admin review through the user row, including when consent is absent.
    user = db.get(User, user_id, populate_existing=True, with_for_update=True)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    return user


def _current_connection(db: Session, user: User, connection_id: UUID) -> ContractRelayConnection:
    connection = db.scalar(
        select(ContractRelayConnection).where(ContractRelayConnection.user_id == user.id).with_for_update()
    )
    if connection is None or connection.id != str(connection_id):
        raise HTTPException(409, "Запись об участии изменилась. Обновите страницу")
    return connection


def _invite_is_current(connection: ContractRelayConnection) -> bool:
    expires_at = connection.quick_invite_expires_at
    return expires_at is not None and utc(expires_at) > utcnow()


def _payload(response: Response, db: Session, connection: ContractRelayConnection | None, *, player: bool = False) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    if connection is None:
        return {"connection": None}
    status = connection_status(db, connection)
    payload = {
        "id": connection.id,
        "consented_at": iso(connection.consented_at),
        "friendship_confirmed_at": iso(connection.friendship_confirmed_at),
        **status,
    }
    if _invite_is_current(connection) and (not player or status["status"] != "connected"):
        payload["quick_invite_expires_at"] = iso(connection.quick_invite_expires_at)
    return {"connection": payload}


@player_router.get(PROFILE_PATH)
def get_connection(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    return _payload(response, db, _connection(db, user.id), player=True)


@player_router.get(PROFILE_PATH + QUICK_INVITE_PATH, response_class=RedirectResponse, status_code=303)
def open_quick_invite(user: User = Depends(require_user), db: Session = Depends(get_db)) -> RedirectResponse:
    connection = db.scalar(
        select(ContractRelayConnection).options(undefer(ContractRelayConnection.quick_invite_url))
        .where(ContractRelayConnection.user_id == user.id)
    )
    destination = RELAY_STEAM_PROFILE
    if (
        user.steam_id64 and connection and _invite_is_current(connection)
        and connection.quick_invite_url and QUICK_INVITE_URL.fullmatch(connection.quick_invite_url)
        and connection_status(db, connection)["status"] != "connected"
    ):
        destination = connection.quick_invite_url
    return RedirectResponse(destination, status_code=303, headers={
        "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    })


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
    return _payload(response, db, connection, player=True)


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

    @router.patch(ADMIN_REVIEW_PATH, dependencies=[Depends(require_csrf)])
    def review_connection(
        user_id: UUID, connection_id: UUID, review: RelayReview, response: Response,
        admin: User = Depends(require_admin), db: Session = Depends(get_db),
    ) -> dict:
        user = _lock_user(db, str(user_id))
        connection = _current_connection(db, user, connection_id)
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

    @router.put(ADMIN_REVIEW_PATH + QUICK_INVITE_PATH, dependencies=[Depends(require_csrf)])
    def publish_quick_invite(
        user_id: UUID, connection_id: UUID, invite: RelayQuickInvite, response: Response,
        admin: User = Depends(require_admin), db: Session = Depends(get_db),
    ) -> dict:
        url = invite.url.get_secret_value()
        if not QUICK_INVITE_URL.fullmatch(url):
            raise HTTPException(422, "Укажите ссылку Quick Invite из Steam")
        user = _lock_user(db, str(user_id))
        connection = _current_connection(db, user, connection_id)
        if user.status != "ACTIVE" or not user.steam_id64:
            raise HTTPException(409, "Для приглашения требуется активный аккаунт Steam")
        if connection.quick_invite_url != url:
            connection.quick_invite_url = url
            connection.quick_invite_expires_at = utcnow() + timedelta(hours=24)
            db.add(AuditLog(user_id=admin.id, action="admin.contract_relay_invite_publish",
                            entity_type="user", entity_id=user.id, data={}))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise HTTPException(409, "Ссылка Quick Invite уже назначена") from None
        return _payload(response, db, connection)

    @router.delete(ADMIN_REVIEW_PATH + QUICK_INVITE_PATH, dependencies=[Depends(require_csrf)])
    def revoke_quick_invite(
        user_id: UUID, connection_id: UUID, response: Response,
        admin: User = Depends(require_admin), db: Session = Depends(get_db),
    ) -> dict:
        user = _lock_user(db, str(user_id))
        connection = _current_connection(db, user, connection_id)
        if connection.quick_invite_url is not None:
            connection.quick_invite_url = None
            connection.quick_invite_expires_at = None
            db.add(AuditLog(user_id=admin.id, action="admin.contract_relay_invite_revoke",
                            entity_type="user", entity_id=user.id, data={}))
            db.commit()
        return _payload(response, db, connection)

    return router
