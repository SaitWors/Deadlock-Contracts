from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .community import Strict, no_store
from .db import get_db
from .models import ArchiveCard, ArchiveCipher, ArchiveLedger, User, utcnow
from .services import archive as service
from .services import archive_packs as packs
from .services.archive_seed import release_artwork_path
from .services.auth import require_csrf, require_user

Rank = Literal["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"]


class Design(Strict):
    hero: str = Field(max_length=40)
    rank: Rank = "F"
    title: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=600)
    artist: str = Field(default="", max_length=100)
    source_url: str = Field(default="", max_length=500)
    rights_confirmed: bool = False
    crop_x: int = Field(default=50, ge=0, le=100, strict=True)
    crop_y: int = Field(default=50, ge=0, le=100, strict=True)
    zoom: float = Field(default=1, ge=1, le=2, allow_inf_nan=False)
    image: str | None = Field(default=None, max_length=400_000)

    @field_validator("source_url")
    @classmethod
    def safe_source(cls, value):
        if value:
            parts = urlsplit(value)
            if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or any(ord(c) < 33 for c in value):
                raise ValueError("Use an HTTPS source URL")
        return value


class EditDesign(Design):
    revision: int = Field(ge=1)


class Revision(Strict):
    revision: int = Field(ge=1)


class Decision(Revision):
    action: Literal["PUBLISH", "REJECT", "ARCHIVE"]
    note: str = Field(min_length=3, max_length=600)


class Guess(Revision):
    symbols: list[int] = Field(min_length=4, max_length=4)

    @field_validator("symbols", mode="before")
    @classmethod
    def valid_symbols(cls, values):
        if not isinstance(values, list) or any(type(v) is not int or v not in range(6) for v in values) or len(set(values)) != 4:
            raise ValueError("Choose four distinct symbols")
        return values


def build_router(require_permission, effective_role):
    router = APIRouter(prefix="/api", tags=["Archive"])

    @router.get("/archive/releases/city-never-sleeps/{hero_key}.webp")
    def release_image(hero_key: str):
        image = release_artwork_path(hero_key)
        if image is None or not image.is_file():
            raise HTTPException(404, "Image not found")
        return FileResponse(image, media_type="image/webp", headers={
            "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff",
        })

    @router.get("/archive/meta")
    def meta(response: Response, user: User = Depends(require_user)):
        no_store(response)
        return {"ranks": service.RANKS, "heroes": [{"key": key, "name": name} for key, name in service.HEROES.items()],
                "can_publish": effective_role(user) in {"ADMIN", "OWNER"}, "frame_version": 1,
                "can_manage_packs": effective_role(user) == "OWNER", "direct_costs": packs.DIRECT_COST,
                "default_weights": packs.DEFAULT_WEIGHTS, "price_model": packs.PRICE_MODEL, "account_key": user.id}

    @router.get("/archive/wallet")
    def wallet(response: Response, offset: int = Query(default=0, ge=0, le=100000),
               user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        return service.wallet_payload(db, user.id, offset)

    @router.post("/archive/cipher", dependencies=[Depends(require_csrf)])
    def start(user: User = Depends(require_user), db: Session = Depends(get_db)):
        service.lock_user(db, user.id)
        week = service.week_start()
        rows = db.scalars(select(ArchiveCipher).where(ArchiveCipher.user_id == user.id, ArchiveCipher.week == week).order_by(ArchiveCipher.slot)).all()
        current = next((item for item in rows if item.status == "OPEN"), None)
        if not current:
            if len(rows) >= 5:
                raise HTTPException(409, "Пять недельных шифров завершены / Weekly ciphers complete")
            current = ArchiveCipher(user_id=user.id, week=week, slot=len(rows) + 1, solution=secrets.SystemRandom().sample(range(6), 4))
            db.add(current)
            db.flush()
        db.commit()
        return {"round": service.cipher_payload(current)}

    @router.post("/archive/cipher/{round_id}/guess", dependencies=[Depends(require_csrf)])
    def guess(round_id: UUID, payload: Guess, user: User = Depends(require_user), db: Session = Depends(get_db)):
        service.lock_user(db, user.id)
        item = db.scalar(select(ArchiveCipher).where(ArchiveCipher.id == str(round_id), ArchiveCipher.user_id == user.id).with_for_update())
        if not item:
            raise HTTPException(404, "Шифр не найден / Cipher not found")
        if item.week != service.week_start():
            raise HTTPException(409, "Началась новая неделя. Откройте новый шифр / A new week has started")
        if item.status != "OPEN" or (payload.revision == item.revision - 1 and item.guesses and payload.symbols == item.guesses[-1]):
            return {"round": service.cipher_payload(item)}
        if item.revision != payload.revision:
            raise HTTPException(409, "Шифр изменился. Обновите страницу / Refresh the cipher")
        assisted = len(item.guesses) >= 6
        if assisted and payload.symbols != item.solution:
            raise HTTPException(409, "Соберите комбинацию из разбора / Follow the explanation")
        item.guesses = [*item.guesses, payload.symbols]
        item.revision += 1
        if payload.symbols == item.solution:
            item.status = "ASSISTED" if assisted else "SOLVED"
            item.completed_at = utcnow()
            db.add(ArchiveLedger(user_id=user.id, source="cipher:" + item.id, reason="CIPHER", delta=30))
        db.commit()
        return {"round": service.cipher_payload(item)}

    def listing(db, statement, offset, *, private=False, staff=False):
        total = db.scalar(select(func.count()).select_from(statement.subquery()))
        rows = db.scalars(statement.order_by(ArchiveCard.updated_at.desc(), ArchiveCard.id).offset(offset).limit(18)).all()
        return {"items": [service.card_payload(row, private=private, staff=staff) for row in rows], "total": total}

    @router.get("/archive/cards")
    def catalog(response: Response, mine: bool = False, hero: str = Query(default="", max_length=40), rank: Rank | None = None,
                q: str = Query(default="", max_length=80), offset: int = Query(default=0, ge=0, le=100000),
                user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        statement = select(ArchiveCard)
        statement = statement.where(ArchiveCard.creator_id == user.id, ArchiveCard.status != "REMOVED") if mine else statement.where(ArchiveCard.status == "PUBLISHED")
        if hero:
            statement = statement.where(ArchiveCard.hero == hero)
        if rank:
            statement = statement.where(ArchiveCard.rank == rank)
        if q:
            escaped = q.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
            statement = statement.where(or_(ArchiveCard.title.ilike(f"%{escaped}%", escape="\\"), ArchiveCard.artist.ilike(f"%{escaped}%", escape="\\")))
        return listing(db, statement, offset, private=mine)

    @router.get("/archive/coverage")
    def coverage(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        rows = db.execute(select(ArchiveCard.hero, ArchiveCard.rank, func.count()).where(ArchiveCard.status == "PUBLISHED")
                          .group_by(ArchiveCard.hero, ArchiveCard.rank)).all()
        return {"items": [{"hero": hero, "rank": rank, "count": count} for hero, rank, count in rows]}

    @router.post("/archive/cards", dependencies=[Depends(require_csrf)])
    def create(payload: Design, user: User = Depends(require_user), db: Session = Depends(get_db)):
        service.lock_user(db, user.id)
        staff = effective_role(user) in {"ADMIN", "OWNER"}
        recent = db.scalar(select(func.count()).select_from(ArchiveCard).where(ArchiveCard.creator_id == user.id,
                            ArchiveCard.created_at >= utcnow() - timedelta(days=1)))
        opened = db.scalar(select(func.count()).select_from(ArchiveCard).where(ArchiveCard.creator_id == user.id,
                            ArchiveCard.status.in_(["DRAFT", "PENDING", "REJECTED"])))
        if recent >= (100 if staff else 3) or opened >= (500 if staff else 10):
            raise HTTPException(429, "Достигнут лимит черновиков: 3 за сутки, 10 открытых / Draft limit reached")
        card = ArchiveCard(creator_id=user.id)
        service.set_design(card, payload)
        db.add(card); db.flush()
        service.audit(db, user.id, card, "created")
        db.commit()
        return {"card": service.card_payload(card, private=True)}

    def own_card(db, card_id, user, revision):
        service.lock_user(db, user.id)
        card = db.scalar(select(ArchiveCard).where(ArchiveCard.id == str(card_id), ArchiveCard.creator_id == user.id).with_for_update())
        if not card or card.status == "REMOVED":
            raise HTTPException(404, "Карточка не найдена / Card not found")
        if card.revision != revision:
            raise HTTPException(409, "Карточка изменилась. Обновите список / Refresh the card")
        return card

    @router.put("/archive/cards/{card_id}", dependencies=[Depends(require_csrf)])
    def edit(card_id: UUID, payload: EditDesign, user: User = Depends(require_user), db: Session = Depends(get_db)):
        card = own_card(db, card_id, user, payload.revision)
        if card.status not in {"DRAFT", "REJECTED"}:
            raise HTTPException(409, "Сначала отзовите заявку; опубликованный дизайн неизменяем / Design is locked")
        service.set_design(card, payload)
        card.status = "DRAFT"; card.revision += 1
        service.audit(db, user.id, card, "edited")
        db.commit()
        return {"card": service.card_payload(card, private=True)}

    @router.post("/archive/cards/{card_id}/{action}", dependencies=[Depends(require_csrf)])
    def author_action(card_id: UUID, action: Literal["submit", "withdraw", "remove"], payload: Revision,
                      user: User = Depends(require_user), db: Session = Depends(get_db)):
        card = own_card(db, card_id, user, payload.revision)
        if action == "submit" and card.status in {"DRAFT", "REJECTED"}:
            if not card.image_digest or not card.rights_confirmed or not card.artist.strip():
                raise HTTPException(422, "Добавьте изображение, автора и подтвердите право использования / Complete image credits")
            card.status = "PENDING"; card.submitted_at = utcnow()
        elif action == "withdraw" and card.status == "PENDING":
            card.status = "DRAFT"
        elif action == "remove" and card.status in {"DRAFT", "REJECTED"}:
            card.status = "REMOVED"; card.image_data = None; card.image_digest = None
        else:
            raise HTTPException(409, "Действие недоступно для этого состояния / Invalid card state")
        card.updated_at = utcnow(); card.revision += 1
        service.audit(db, user.id, card, action)
        db.commit()
        return {"card": service.card_payload(card, private=True)}

    def serve_image(card):
        if not card or not card.image_data:
            raise HTTPException(404, "Image not found")
        return Response(card.image_data, media_type="image/webp", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

    @router.get("/archive/cards/{card_id}/image")
    def image(card_id: UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
        card = db.get(ArchiveCard, str(card_id))
        if not card or card.status == "REMOVED" or (card.status != "PUBLISHED" and card.creator_id != user.id
                                                    and not packs.owns_card(db, user.id, card.id)):
            raise HTTPException(404, "Image not found")
        return serve_image(card)

    @router.get("/admin/archive/cards")
    def queue(response: Response, status: Literal["PENDING", "PUBLISHED", "REJECTED", "ARCHIVED"] = "PENDING",
              offset: int = Query(default=0, ge=0, le=100000),
              staff: User = Depends(require_permission("cards.publish")), db: Session = Depends(get_db)):
        no_store(response)
        return listing(db, select(ArchiveCard).where(ArchiveCard.status == status), offset, private=True, staff=True)

    @router.get("/admin/archive/cards/{card_id}/image")
    def review_image(card_id: UUID, staff: User = Depends(require_permission("cards.publish")), db: Session = Depends(get_db)):
        card = db.get(ArchiveCard, str(card_id))
        if not card or card.status not in {"PENDING", "PUBLISHED", "REJECTED", "ARCHIVED"}:
            raise HTTPException(404, "Image not found")
        return serve_image(card)

    @router.post("/admin/archive/cards/{card_id}/decision", dependencies=[Depends(require_csrf)])
    def decide(card_id: UUID, payload: Decision, staff: User = Depends(require_permission("cards.publish")), db: Session = Depends(get_db)):
        card = db.scalar(select(ArchiveCard).where(ArchiveCard.id == str(card_id)).with_for_update())
        if not card:
            raise HTTPException(404, "Карточка не найдена / Card not found")
        if card.revision != payload.revision or (payload.action in {"PUBLISH", "REJECT"} and card.status != "PENDING") or (payload.action == "ARCHIVE" and card.status != "PUBLISHED"):
            raise HTTPException(409, "Заявка изменилась. Обновите очередь / Refresh the queue")
        card.status = {"PUBLISH": "PUBLISHED", "REJECT": "REJECTED", "ARCHIVE": "ARCHIVED"}[payload.action]
        card.revision += 1; card.review_note = payload.note; card.reviewed_by = staff.id; card.updated_at = utcnow()
        if payload.action == "PUBLISH":
            card.published_at = utcnow()
        service.audit(db, staff.id, card, payload.action.lower(), note=payload.note)
        db.commit()
        return {"card": service.card_payload(card, private=True, staff=True)}

    return router
