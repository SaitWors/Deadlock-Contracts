from __future__ import annotations

import re
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import BureauApplication, BureauBan, BureauMembership, PlayerBureau, User, utcnow
from .services import bureaus
from .services.achievements import achievement_collection
from .services.auth import require_csrf, require_user
from .services.leaderboard import public_leaderboard

router = APIRouter(prefix="/api", tags=["Player community"])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class BureauSettings(Strict):
    name: str = Field(min_length=10, max_length=64)
    tagline: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=1200)
    rules: str = Field(default="", max_length=1200)
    language: Literal["ru", "en", "any"] = "ru"
    theme: Literal["DOSSIER", "NOIR", "SIGNAL"] = "DOSSIER"
    recruitment: Literal["OPEN", "APPLICATION", "CLOSED"] = "APPLICATION"


class CreateBureau(BureauSettings):
    slug: str = Field(min_length=3, max_length=32, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class JoinBureau(Strict):
    agree_rules: Literal[True]
    message: str = Field(default="", max_length=500)


class ApplicationDecision(Strict):
    decision: Literal["ACCEPT", "REJECT"]


class MemberAction(Strict):
    action: Literal["PROMOTE", "DEMOTE", "REMOVE", "BAN", "TRANSFER"]
    reason: str = Field(default="", max_length=300)


class DisbandBureau(Strict):
    confirmation: str = Field(max_length=32)


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"


@router.get("/achievements")
def achievements(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    no_store(response)
    return achievement_collection(db, user.id)


@router.get("/leaderboard")
def my_leaderboard(response: Response, scope: Literal["all_time", "today", "rare", "mastery"] = "all_time",
                   limit: int = Query(default=50, ge=1, le=100), user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    no_store(response)
    return public_leaderboard(db, scope, limit=limit, viewer=user)


@router.get("/bureaus")
def directory(response: Response, q: str = Query(default="", max_length=64), offset: int = Query(default=0, ge=0, le=10000),
              user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    no_store(response)
    statement = select(PlayerBureau).where(PlayerBureau.status == "ACTIVE")
    if q.strip():
        search = q.strip().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
        statement = statement.where(or_(PlayerBureau.name.ilike(f"%{search}%", escape="\\"), PlayerBureau.slug.ilike(f"%{search}%", escape="\\")))
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    entries = db.scalars(statement.order_by(PlayerBureau.created_at.desc(), PlayerBureau.id).offset(offset).limit(24)).all()
    counts = dict(db.execute(select(BureauMembership.bureau_id, func.count()).where(BureauMembership.bureau_id.in_([item.id for item in entries]))
                             .group_by(BureauMembership.bureau_id)).all()) if entries else {}
    own = bureaus.profile_bureau(db, user.id, include_frozen=True)
    pending = db.scalars(select(PlayerBureau.slug).join(BureauApplication, BureauApplication.bureau_id == PlayerBureau.id)
                        .where(BureauApplication.user_id == user.id)).all()
    return {"items": [bureaus.summary(db, item, counts.get(item.id, 0)) for item in entries],
            "total": total, "offset": offset, "my_bureau": own, "pending_slugs": list(pending)}


def apply_settings(bureau: PlayerBureau, payload: BureauSettings) -> None:
    if not re.search(r"\bdeadlock\b", payload.name, re.IGNORECASE):
        raise HTTPException(422, "Название бюро должно содержать слово Deadlock")
    for key, value in payload.model_dump(exclude={"slug"}).items():
        setattr(bureau, key, value)


@router.post("/bureaus", dependencies=[Depends(require_csrf)])
def create(payload: CreateBureau, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    bureaus.lock_player(db, user.id)
    if bureaus.membership(db, user.id):
        raise HTTPException(409, "Можно состоять только в одном бюро")
    if db.scalar(select(PlayerBureau.id).where(PlayerBureau.slug == payload.slug)):
        raise HTTPException(409, "Этот адрес бюро уже занят")
    bureau = PlayerBureau(slug=payload.slug, owner_user_id=user.id)
    apply_settings(bureau, payload)
    db.add(bureau)
    # The slug is also protected by a unique index for competing creators.
    from sqlalchemy.exc import IntegrityError
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Этот адрес бюро уже занят") from exc
    bureaus.record_member(db, bureau, user.id, role="DIRECTOR")
    db.execute(delete(BureauApplication).where(BureauApplication.user_id == user.id))
    bureaus.audit(db, bureau, user.id, "created")
    bureaus.commit(db)
    return {"bureau": bureaus.detail(db, bureau, user)}


@router.get("/bureaus/{slug}")
def get_bureau(slug: str, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    no_store(response)
    bureau = db.scalar(select(PlayerBureau).where(PlayerBureau.slug == slug))
    if not bureau:
        raise HTTPException(404, "Бюро не найдено")
    return {"bureau": bureaus.detail(db, bureau, user)}


@router.put("/bureaus/{slug}", dependencies=[Depends(require_csrf)])
def update(slug: str, payload: BureauSettings, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    bureau = bureaus.lock_bureau(db, slug)
    bureaus.require_manager(db, bureau, user.id, director=True)
    apply_settings(bureau, payload)
    bureaus.audit(db, bureau, user.id, "updated")
    bureaus.commit(db)
    return {"bureau": bureaus.detail(db, bureau, user)}


@router.post("/bureaus/{slug}/join", dependencies=[Depends(require_csrf)])
def join(slug: str, payload: JoinBureau, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    bureau = bureaus.lock_bureau(db, slug)
    bureaus.lock_player(db, user.id)
    own = bureaus.membership(db, user.id)
    if own:
        if own.bureau_id == bureau.id:
            return {"bureau": bureaus.detail(db, bureau, user)}
        raise HTTPException(409, "Можно состоять только в одном бюро")
    bureaus.require_admission(db, bureau, user.id)
    if bureau.recruitment == "CLOSED":
        raise HTTPException(409, "Набор в бюро закрыт")
    if bureau.recruitment == "OPEN":
        bureaus.add_member(db, bureau, user.id)
        bureaus.audit(db, bureau, user.id, "joined")
    else:
        existing = db.scalar(select(BureauApplication).where(BureauApplication.bureau_id == bureau.id, BureauApplication.user_id == user.id))
        if existing is None:
            count = db.scalar(select(func.count()).select_from(BureauApplication).where(BureauApplication.user_id == user.id)) or 0
            if count >= 5:
                raise HTTPException(409, "Можно отправить не более пяти заявок одновременно")
            db.add(BureauApplication(bureau_id=bureau.id, user_id=user.id, message=payload.message))
            bureaus.audit(db, bureau, user.id, "applied")
    bureaus.commit(db)
    return {"bureau": bureaus.detail(db, bureau, user)}


@router.delete("/bureaus/{slug}/application", dependencies=[Depends(require_csrf)])
def cancel_application(slug: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    bureau = bureaus.lock_bureau(db, slug)
    db.execute(delete(BureauApplication).where(BureauApplication.bureau_id == bureau.id, BureauApplication.user_id == user.id))
    bureaus.commit(db)
    return {"bureau": bureaus.detail(db, bureau, user)}


@router.post("/bureaus/{slug}/applications/{application_id}", dependencies=[Depends(require_csrf)])
def decide(slug: str, application_id: UUID, payload: ApplicationDecision, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    bureau = bureaus.lock_bureau(db, slug)
    bureaus.require_manager(db, bureau, user.id)
    application = db.scalar(select(BureauApplication).where(BureauApplication.id == str(application_id), BureauApplication.bureau_id == bureau.id))
    if not application:
        raise HTTPException(404, "Заявка уже обработана или не найдена")
    if payload.decision == "ACCEPT":
        bureaus.add_member(db, bureau, application.user_id)
    else:
        db.delete(application)
    bureaus.audit(db, bureau, user.id, "application_decided", decision=payload.decision)
    bureaus.commit(db)
    return {"bureau": bureaus.detail(db, bureau, user)}


@router.post("/bureaus/{slug}/members/{member_id}", dependencies=[Depends(require_csrf)])
def member_action(slug: str, member_id: UUID, payload: MemberAction, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    bureau = bureaus.lock_bureau(db, slug)
    actor = bureaus.require_manager(db, bureau, user.id, director=payload.action not in {"REMOVE", "BAN"})
    target = db.scalar(select(BureauMembership).where(BureauMembership.id == str(member_id), BureauMembership.bureau_id == bureau.id))
    if not target:
        raise HTTPException(404, "Участник не найден")
    if target.user_id == user.id or target.role == "DIRECTOR" or (actor.role != "DIRECTOR" and target.role != "OPERATIVE"):
        raise HTTPException(403, "Недостаточно прав в этом бюро")
    if payload.action in {"REMOVE", "BAN"}:
        if len(payload.reason) < 3:
            raise HTTPException(422, "Укажите причину исключения")
        bureaus.operations.close_period(db, target.user_id, bureau.id)
        if payload.action == "BAN":
            ban = db.scalar(select(BureauBan).where(BureauBan.bureau_id == bureau.id, BureauBan.user_id == target.user_id))
            if ban is None:
                ban = BureauBan(bureau_id=bureau.id, user_id=target.user_id)
                db.add(ban)
            ban.active, ban.reason, ban.created_at = True, payload.reason, utcnow()
        db.delete(target)
    elif payload.action == "TRANSFER":
        bureaus.lock_player(db, target.user_id)
        actor.role = "OPERATIVE"
        target.role = "DIRECTOR"
        bureau.owner_user_id = target.user_id
    else:
        target.role = "MODERATOR" if payload.action == "PROMOTE" else "OPERATIVE"
    bureaus.audit(db, bureau, user.id, "member_changed", target=target.id, action=payload.action, reason=payload.reason)
    bureaus.commit(db)
    return {"bureau": bureaus.detail(db, bureau, user)}


@router.post("/bureaus/{slug}/leave", dependencies=[Depends(require_csrf)])
def leave(slug: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    bureau = bureaus.lock_bureau(db, slug)
    member = bureaus.membership(db, user.id)
    if member and member.bureau_id == bureau.id:
        if member.role == "DIRECTOR":
            raise HTTPException(409, "Сначала передайте руководство или распустите бюро")
        bureaus.operations.close_period(db, member.user_id, bureau.id)
        db.delete(member)
        bureaus.audit(db, bureau, user.id, "left")
    bureaus.commit(db)
    if bureau.status == "FROZEN":
        return {"left": True}
    return {"bureau": bureaus.detail(db, bureau, user)}


@router.delete("/bureaus/{slug}", dependencies=[Depends(require_csrf)])
def disband(slug: str, payload: DisbandBureau, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    bureau = bureaus.lock_bureau(db, slug)
    bureaus.require_manager(db, bureau, user.id, director=True)
    if payload.confirmation != bureau.slug:
        raise HTTPException(422, "Для удаления введите адрес бюро")
    bureaus.audit(db, bureau, user.id, "disbanded")
    bureaus.end_bureau(db, bureau)
    db.execute(delete(BureauApplication).where(BureauApplication.bureau_id == bureau.id))
    db.execute(delete(BureauMembership).where(BureauMembership.bureau_id == bureau.id))
    db.delete(bureau)
    bureaus.commit(db)
    return {"deleted": True}
