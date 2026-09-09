"""Player communities. All membership writes lock the bureau before the user.

The bureau lock serializes capacity/role decisions in PostgreSQL; the unique
membership user index also prevents joining two different bureaus concurrently.
Community roles never grant application staff permissions or access to matches.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import AuditLog, BureauApplication, BureauBan, BureauMembership, BureauMembershipPeriod, PlayerBureau, PublicProfile, User

from . import bureau_operations as operations
from . import bureau_design

CAPACITY = 25
MANAGERS = {"DIRECTOR", "MODERATOR"}


def membership(db: Session, user_id: str) -> BureauMembership | None:
    return db.scalar(select(BureauMembership).where(BureauMembership.user_id == user_id).execution_options(populate_existing=True))


def lock_bureau(db: Session, slug: str) -> PlayerBureau:
    bureau = db.scalar(select(PlayerBureau).where(PlayerBureau.slug == slug).with_for_update().execution_options(populate_existing=True))
    if bureau is None:
        raise HTTPException(404, "Бюро не найдено")
    return bureau


def lock_player(db: Session, user_id: str) -> User:
    user = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
    if user is None or user.status != "ACTIVE":
        raise HTTPException(409, "Аккаунт недоступен")
    return user


def require_manager(db: Session, bureau: PlayerBureau, user_id: str, *, director: bool = False) -> BureauMembership:
    member = membership(db, user_id)
    if not member or member.bureau_id != bureau.id or member.role not in MANAGERS:
        raise HTTPException(403, "Недостаточно прав в этом бюро")
    if director and (member.role != "DIRECTOR" or bureau.owner_user_id != user_id):
        raise HTTPException(403, "Действие доступно только директору бюро")
    return member


def audit(db: Session, bureau: PlayerBureau, user_id: str | None, event: str, **data) -> None:
    db.add(AuditLog(user_id=user_id, action=f"bureau.{event}", entity_type="player_bureau", entity_id=bureau.id, data=data))


def commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Данные бюро изменились. Обновите страницу и повторите действие.") from exc


def summary(db: Session, bureau: PlayerBureau, count: int | None = None) -> dict:
    if count is None:
        count = db.scalar(select(func.count()).select_from(BureauMembership).where(BureauMembership.bureau_id == bureau.id)) or 0
    return {**bureau_design.summary(bureau), "slug": bureau.slug, "name": bureau.name, "tagline": bureau.tagline,
            "theme": bureau.theme, "language": bureau.language, "recruitment": bureau.recruitment,
            "member_count": count, "capacity": CAPACITY, "status": bureau.status, "moderation_note": bureau.moderation_note}


def profile_bureau(db: Session, user_id: str, *, include_frozen=False) -> dict | None:
    bureau = db.scalar(select(PlayerBureau).join(BureauMembership, BureauMembership.bureau_id == PlayerBureau.id).where(BureauMembership.user_id == user_id))
    return summary(db, bureau) if bureau and (include_frozen or bureau.status == "ACTIVE") else None


def detail(db: Session, bureau: PlayerBureau, viewer: User) -> dict:
    own = membership(db, viewer.id)
    inside = own is not None and own.bureau_id == bureau.id
    manager = inside and own.role in MANAGERS
    if bureau.status == "FROZEN" and not inside:
        raise HTTPException(404, "Бюро не найдено")
    rows = db.execute(select(BureauMembership, User, PublicProfile)
        .join(User, User.id == BureauMembership.user_id)
        .outerjoin(PublicProfile, PublicProfile.user_id == User.id)
        .where(BureauMembership.bureau_id == bureau.id)
        .order_by(BureauMembership.joined_at, BureauMembership.id)).all()
    members = []
    for member, player, profile in rows:
        public = bool(profile and profile.is_public and profile.show_bureau and player.status == "ACTIVE")
        # Outsiders see only explicitly published membership, never a private
        # Steam identity, internal user ID, or a link to a private profile.
        members.append({"id": member.id if inside else None, "role": member.role,
                        "display_name": player.display_name if inside or public else None,
                        "avatar_url": player.avatar_url if inside or public else None,
                        "profile_url": f"/u/{profile.slug}" if public else None,
                        "is_me": member.user_id == viewer.id})
    pending = db.scalar(select(BureauApplication).where(BureauApplication.bureau_id == bureau.id, BureauApplication.user_id == viewer.id))
    applications = []
    journal = []
    if manager:
        applications = [{"id": application.id, "display_name": player.display_name,
                         "message": application.message, "created_at": application.created_at.isoformat()}
                        for application, player in db.execute(select(BureauApplication, User)
                            .join(User, User.id == BureauApplication.user_id)
                            .where(BureauApplication.bureau_id == bureau.id)
                            .order_by(BureauApplication.created_at)).all()]
        journal = [{"action": log.action, "at": log.created_at.isoformat(), "actor": actor or "—", "data": log.data}
                   for log, actor in db.execute(select(AuditLog, User.display_name)
                       .outerjoin(User, User.id == AuditLog.user_id)
                       .where(AuditLog.entity_type == "player_bureau", AuditLog.entity_id == bureau.id)
                       .order_by(AuditLog.created_at.desc()).limit(20)).all()]
    ban = active_ban(db, bureau.id, viewer.id)
    bans = [{"id": b.id, "display_name": name, "reason": b.reason} for b, name in db.execute(
        select(BureauBan, User.display_name).join(User, User.id == BureauBan.user_id)
        .where(BureauBan.bureau_id == bureau.id, BureauBan.active.is_(True))).all()] if manager else []
    return {"bans": bans, "my_ban": {"reason": ban.reason} if ban else None, **summary(db, bureau, len(rows)), "description": bureau.description, "rules": bureau.rules,
            "members": members, "my_role": own.role if inside else None, "can_manage": bool(manager),
            "can_edit": bool(inside and own.role == "DIRECTOR" and bureau.owner_user_id == viewer.id),
            "application_pending": pending is not None, "applications": applications, "journal": journal,
            "design_revision": bureau.design_revision, "listed": bureau.listed,
            "welcome": bureau.welcome if inside else "",
            "role_titles": bureau_design.RoleTitles.model_validate(bureau.role_titles or {}).model_dump(),
            "created_at": bureau.created_at.isoformat()}


def require_active(bureau: PlayerBureau) -> None:
    if bureau.status != "ACTIVE":
        raise HTTPException(409, "Работа бюро приостановлена модератором")


def active_ban(db: Session, bureau_id: str, user_id: str) -> BureauBan | None:
    return db.scalar(select(BureauBan).where(BureauBan.bureau_id == bureau_id,
        BureauBan.user_id == user_id, BureauBan.active.is_(True)))


def require_admission(db: Session, bureau: PlayerBureau, user_id: str) -> None:
    require_active(bureau)
    if active_ban(db, bureau.id, user_id):
        raise HTTPException(403, "Повторное вступление в это бюро заблокировано")


def record_member(db: Session, bureau: PlayerBureau, user_id: str, role="OPERATIVE") -> None:
    item = BureauMembership(bureau_id=bureau.id, user_id=user_id, role=role)
    db.add(item); db.flush()
    db.add(BureauMembershipPeriod(id=item.id, bureau_id=bureau.id, user_id=user_id, joined_at=item.joined_at))


def end_bureau(db: Session, bureau: PlayerBureau) -> None:
    for member in db.scalars(select(BureauMembership).where(BureauMembership.bureau_id == bureau.id)):
        operations.close_period(db, member.user_id, bureau.id)
    operations.cancel_open(db, bureau.id, "Бюро распущено / Bureau disbanded")


def add_member(db: Session, bureau: PlayerBureau, user_id: str) -> None:
    lock_player(db, user_id)
    require_admission(db, bureau, user_id)
    if membership(db, user_id):
        raise HTTPException(409, "Можно состоять только в одном бюро")
    count = db.scalar(select(func.count()).select_from(BureauMembership).where(BureauMembership.bureau_id == bureau.id)) or 0
    if count >= CAPACITY:
        raise HTTPException(409, "В бюро закончились места")
    record_member(db, bureau, user_id)
    db.execute(delete(BureauApplication).where(BureauApplication.user_id == user_id))


def leave_for_account_deletion(db: Session, user_id: str) -> None:
    """Transfer a departing director to the oldest active member, or disband.

    Called before account deletion in its transaction; no public ghost owner.
    """
    member = membership(db, user_id)
    if member:
        bureau = db.scalar(select(PlayerBureau).where(PlayerBureau.id == member.bureau_id).with_for_update().execution_options(populate_existing=True))
        lock_player(db, user_id)
        current = membership(db, user_id)
        if not bureau or not current or current.bureau_id != bureau.id:
            # Another request moved the player while this request waited for
            # the bureau lock. Retry instead of deleting a new director without
            # holding the new bureau's lock, or taking locks in reverse order.
            raise HTTPException(409, "Данные бюро изменились. Обновите страницу и повторите действие.")
        member = current
        if bureau and bureau.owner_user_id == user_id:
            successor = db.scalar(select(BureauMembership).join(User, User.id == BureauMembership.user_id)
                .where(BureauMembership.bureau_id == bureau.id, BureauMembership.user_id != user_id, User.status == "ACTIVE")
                .order_by(BureauMembership.joined_at, BureauMembership.id).limit(1))
            if successor:
                successor.role = "DIRECTOR"
                bureau.owner_user_id = successor.user_id
                audit(db, bureau, None, "director_departed", successor=successor.id)
            else:
                end_bureau(db, bureau)
                db.execute(delete(BureauApplication).where(BureauApplication.bureau_id == bureau.id))
                db.execute(delete(BureauMembership).where(BureauMembership.bureau_id == bureau.id))
                db.delete(bureau)
        operations.close_period(db, user_id, bureau.id)
        db.execute(delete(BureauMembership).where(BureauMembership.user_id == user_id))
    else:
        lock_player(db, user_id)
        if membership(db, user_id):
            raise HTTPException(409, "Данные бюро изменились. Обновите страницу и повторите действие.")
    db.execute(delete(BureauApplication).where(BureauApplication.user_id == user_id))
