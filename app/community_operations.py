from __future__ import annotations

from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .community import Strict, no_store
from .db import get_db
from .models import BureauBan, BureauOperation, BureauReport, PlayerBureau, User, utcnow
from .services import bureaus, bureau_operations as operations
from .services.auth import require_csrf, require_user


class NewReport(Strict):
    kind: Literal["CONTENT", "BAN_APPEAL", "BUREAU_APPEAL"] = "CONTENT"
    message: str = Field(min_length=10, max_length=1000)


class Decision(Strict):
    revision: int = Field(ge=1)
    action: Literal["DISMISS", "WARN", "FREEZE", "RESTORE", "LIFT_BAN"]
    note: str = Field(min_length=10, max_length=1000)


class NewOperation(Strict):
    template: Literal["city_cases", "field_hospital", "five_witnesses"]
    days: Literal[1, 3, 7] = 7


class Reason(Strict):
    reason: str = Field(min_length=3, max_length=300)


def report_payload(item: BureauReport, bureau: PlayerBureau | None = None, *, staff=False) -> dict:
    result = {"id": item.id, "bureau_name": item.bureau_name, "bureau_slug": bureau.slug if bureau else None,
        "kind": item.kind, "message": item.message, "status": item.status, "revision": item.revision,
        "decision": item.decision, "decision_note": item.decision_note,
        "created_at": operations.aware(item.created_at).isoformat()}
    if staff:
        result.update(snapshot={key: value for key, value in item.snapshot.items() if key != "ban_created_at"}, bureau_status=bureau.status if bureau else "DELETED")
        result["current_artwork"] = {kind: f"/api/admin/bureaus/{bureau.slug}/media/{kind}?r={getattr(bureau, kind + '_digest')}"
            for kind in ("avatar", "cover") if getattr(bureau, kind + "_digest")} if bureau else {}
    return result


def require_member(db, bureau, user):
    own = bureaus.membership(db, user.id)
    if not own or own.bureau_id != bureau.id:
        raise HTTPException(403, "Доступно только участникам бюро")
    return own


def build_router(require_permission):
    router = APIRouter(prefix="/api", tags=["Bureau operations and moderation"])

    @router.get("/bureau-reports")
    def my_reports(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        rows = db.execute(select(BureauReport, PlayerBureau).outerjoin(PlayerBureau, PlayerBureau.id == BureauReport.bureau_id)
            .where(BureauReport.reporter_id == user.id).order_by(BureauReport.created_at.desc()).limit(30)).all()
        return {"items": [report_payload(report, bureau) for report, bureau in rows]}

    @router.post("/bureaus/{slug}/reports", dependencies=[Depends(require_csrf)])
    def report(slug: str, payload: NewReport, user: User = Depends(require_user), db: Session = Depends(get_db)):
        bureau = bureaus.lock_bureau(db, slug)
        bureaus.lock_player(db, user.id)  # serializes the cross-bureau daily limit
        if payload.kind == "BAN_APPEAL":
            if not bureaus.active_ban(db, bureau.id, user.id):
                raise HTTPException(409, "Активная блокировка не найдена")
        elif payload.kind == "BUREAU_APPEAL":
            bureaus.require_manager(db, bureau, user.id, director=True)
            if bureau.status != "FROZEN":
                raise HTTPException(409, "Бюро не приостановлено")
        existing = db.scalar(select(BureauReport).where(BureauReport.bureau_id == bureau.id,
            BureauReport.reporter_id == user.id, BureauReport.kind == payload.kind, BureauReport.status == "OPEN"))
        if existing:
            return {"report": report_payload(existing, bureau)}
        count = db.scalar(select(func.count()).select_from(BureauReport).where(BureauReport.reporter_id == user.id,
                            BureauReport.created_at >= utcnow() - timedelta(days=1))) or 0
        if count >= 5:
            raise HTTPException(429, "Можно отправить не более пяти обращений за сутки")
        ban = bureaus.active_ban(db, bureau.id, user.id)
        item = BureauReport(bureau_id=bureau.id, reporter_id=user.id, bureau_name=bureau.name,
            kind=payload.kind, message=payload.message,
            snapshot={"name": bureau.name, "description": bureau.description, "rules": bureau.rules,
                      "rank_director": (bureau.role_titles or {}).get("DIRECTOR", ""),
                      "rank_moderator": (bureau.role_titles or {}).get("MODERATOR", ""),
                      "rank_operative": (bureau.role_titles or {}).get("OPERATIVE", ""),
                      "avatar_digest": bureau.avatar_digest or "", "cover_digest": bureau.cover_digest or "",
                      "ban_reason": ban.reason if ban else "", "ban_created_at": operations.aware(ban.created_at).isoformat() if ban else "", "moderation_note": bureau.moderation_note})
        db.add(item); bureaus.commit(db)
        return {"report": report_payload(item, bureau)}

    @router.post("/bureaus/{slug}/bans/{ban_id}/lift", dependencies=[Depends(require_csrf)])
    def lift(slug: str, ban_id: UUID, payload: Reason, user: User = Depends(require_user), db: Session = Depends(get_db)):
        bureau = bureaus.lock_bureau(db, slug)
        bureaus.require_manager(db, bureau, user.id, director=True)
        ban = db.scalar(select(BureauBan).where(BureauBan.id == str(ban_id), BureauBan.bureau_id == bureau.id))
        if not ban:
            raise HTTPException(404, "Активная блокировка не найдена")
        if ban.active:
            ban.active = False
            bureaus.audit(db, bureau, user.id, "ban_lifted", reason=payload.reason)
        bureaus.commit(db)
        return {"bureau": bureaus.detail(db, bureau, user)}

    @router.get("/admin/bureaus/{slug}/media/{kind}")
    def review_media(slug: str, kind: Literal["avatar", "cover"], staff: User = Depends(require_permission("bureaus.moderate")), db: Session = Depends(get_db)):
        bureau = db.scalar(select(PlayerBureau).where(PlayerBureau.slug == slug))
        data = getattr(bureau, f"{kind}_data") if bureau else None
        if not data:
            raise HTTPException(404, "Image not found")
        return Response(data, media_type="image/webp", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

    @router.get("/admin/bureau-reports")
    def queue(response: Response, status: Literal["OPEN", "RESOLVED", "DISMISSED"] = "OPEN",
              offset: int = Query(default=0, ge=0, le=10000),
              staff: User = Depends(require_permission("bureaus.moderate")), db: Session = Depends(get_db)):
        no_store(response)
        rows = db.execute(select(BureauReport, PlayerBureau).outerjoin(PlayerBureau, PlayerBureau.id == BureauReport.bureau_id)
            .where(BureauReport.status == status).order_by(BureauReport.created_at, BureauReport.id).offset(offset).limit(20)).all()
        total = db.scalar(select(func.count()).select_from(BureauReport).where(BureauReport.status == status)) or 0
        return {"items": [report_payload(report, bureau, staff=True) for report, bureau in rows], "total": total}

    @router.post("/admin/bureau-reports/{report_id}/decision", dependencies=[Depends(require_csrf)])
    def decide(report_id: UUID, payload: Decision, staff: User = Depends(require_permission("bureaus.moderate")),
               db: Session = Depends(get_db)):
        initial = db.get(BureauReport, str(report_id))
        if not initial:
            raise HTTPException(404, "Обращение не найдено")
        bureau = db.scalar(select(PlayerBureau).where(PlayerBureau.id == initial.bureau_id).with_for_update()) if initial.bureau_id else None
        item = db.scalar(select(BureauReport).where(BureauReport.id == str(report_id)).with_for_update().execution_options(populate_existing=True))
        if item.status != "OPEN" or item.revision != payload.revision:
            raise HTTPException(409, "Обращение уже изменилось. Обновите очередь.")
        own = bureaus.membership(db, staff.id)
        if item.reporter_id == staff.id or (bureau and own and own.bureau_id == bureau.id):
            raise HTTPException(403, "Своё обращение или бюро должен проверить другой сотрудник")
        if not bureau and payload.action != "DISMISS":
            raise HTTPException(409, "Бюро уже удалено")
        if payload.action == "LIFT_BAN":
            ban = bureaus.active_ban(db, bureau.id, item.reporter_id)
            if item.kind != "BAN_APPEAL" or not ban:
                raise HTTPException(409, "Активная блокировка не найдена")
            if item.snapshot.get("ban_created_at") != operations.aware(ban.created_at).isoformat():
                raise HTTPException(409, "Блокировка изменилась после обращения. Отклоните старую апелляцию.")
            ban.active = False
        elif payload.action == "RESTORE":
            if item.kind != "BUREAU_APPEAL" or bureau.status != "FROZEN":
                raise HTTPException(409, "Бюро не приостановлено")
            bureau.status = "ACTIVE"
            bureau.moderation_note = ""
        elif payload.action == "FREEZE":
            bureau.status = "FROZEN"
            bureau.moderation_note = payload.note
            operations.cancel_open(db, bureau.id, payload.note)
        elif payload.action == "WARN":
            bureau.moderation_note = payload.note
        item.status = "DISMISSED" if payload.action == "DISMISS" else "RESOLVED"
        item.revision += 1
        item.decision, item.decision_note = payload.action, payload.note
        item.decided_by, item.decided_at = staff.id, utcnow()
        if bureau and payload.action != "DISMISS":
            # Do not leak report ID, text, identity, or appeal details to managers.
            bureaus.audit(db, bureau, None, "moderation_decision", action=payload.action)
        from .models import AuditLog
        db.add(AuditLog(user_id=staff.id, action="bureau_report.decided", entity_type="bureau_report",
                        entity_id=item.id, data={"action": payload.action, "revision": item.revision, "note": payload.note}))
        bureaus.commit(db)
        return {"report": report_payload(item, bureau, staff=True)}

    @router.get("/bureaus/{slug}/operations")
    def operation_list(slug: str, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        bureau = db.scalar(select(PlayerBureau).where(PlayerBureau.slug == slug))
        if not bureau:
            raise HTTPException(404, "Бюро не найдено")
        require_member(db, bureau, user)
        rows = db.scalars(select(BureauOperation).where(BureauOperation.bureau_id == bureau.id)
            .order_by(BureauOperation.started_at.desc()).limit(20)).all()
        return {"items": [operations.payload(db, row, user.id) for row in rows], "templates": operations.TEMPLATES}

    @router.post("/bureaus/{slug}/operations", dependencies=[Depends(require_csrf)])
    def start(slug: str, payload: NewOperation, user: User = Depends(require_user), db: Session = Depends(get_db)):
        bureau = bureaus.lock_bureau(db, slug)
        bureaus.require_manager(db, bureau, user.id)
        bureaus.require_active(bureau)
        now = utcnow()
        if db.scalar(select(BureauOperation.id).where(BureauOperation.bureau_id == bureau.id,
            BureauOperation.ends_at > now, BureauOperation.status != "CANCELLED")):
            raise HTTPException(409, "Сначала дождитесь завершения срока текущей операции")
        recent = db.scalar(select(func.count()).select_from(BureauOperation).where(BureauOperation.bureau_id == bureau.id,
                            BureauOperation.started_at >= now - timedelta(days=1))) or 0
        if recent >= 3:
            raise HTTPException(429, "Можно начать не более трёх операций за сутки")
        template = operations.TEMPLATES[payload.template]
        operation = BureauOperation(bureau_id=bureau.id, template=payload.template, target=template["target"],
            min_contributors=template["min_contributors"], started_at=now, ends_at=now + timedelta(days=payload.days))
        db.add(operation)
        bureaus.audit(db, bureau, user.id, "operation_started", template=payload.template)
        bureaus.commit(db)
        return {"operation": operations.payload(db, operation, user.id)}

    @router.post("/bureaus/{slug}/operations/{operation_id}/cancel", dependencies=[Depends(require_csrf)])
    def cancel(slug: str, operation_id: UUID, payload: Reason, user: User = Depends(require_user), db: Session = Depends(get_db)):
        bureau = bureaus.lock_bureau(db, slug)
        bureaus.require_manager(db, bureau, user.id, director=True)
        operation = db.scalar(select(BureauOperation).where(BureauOperation.id == str(operation_id), BureauOperation.bureau_id == bureau.id).with_for_update())
        if not operation:
            raise HTTPException(404, "Операция не найдена")
        if operation.status == "COMPLETED":
            raise HTTPException(409, "Завершённую операцию нельзя отменить")
        if operation.status != "CANCELLED":
            operation.status, operation.cancel_reason = "CANCELLED", payload.reason
            bureaus.audit(db, bureau, user.id, "operation_cancelled", reason=payload.reason)
        bureaus.commit(db)
        return {"operation": operations.payload(db, operation, user.id)}

    return router
