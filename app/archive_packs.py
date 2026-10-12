from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .archive import EconomyScope, Rank, Revision
from .community import Strict, no_store
from .db import get_db
from .models import (ArchiveCard, ArchiveOperation, ArchivePack, ArchivePackVersion,
                     ArchiveShowcase, PublicProfile, User, utcnow)
from .services import archive_packs as service
from .services.archive import lock_user
from .services.auth import require_csrf, require_user


class Entry(Strict):
    card_id: UUID
    weight: int = Field(ge=1, le=10000, strict=True)


class PackDesign(Strict):
    title: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=600)
    price: int = Field(ge=1, le=100000, strict=True)
    draws: int = Field(ge=1, le=5, strict=True)
    entries: list[Entry] = Field(min_length=1, max_length=400)
    active: bool = False
    starter: bool = False

    @field_validator("entries")
    @classmethod
    def distinct_cards(cls, entries):
        if len({entry.card_id for entry in entries}) != len(entries):
            raise ValueError("Each card appears once in the pool; use its weight")
        return entries


class PackEdit(PackDesign):
    revision: int = Field(ge=1, strict=True)


class RequestKey(Strict):
    request_key: UUID
    scope: EconomyScope = "REAL"


class OpenPack(RequestKey):
    revision: int = Field(ge=1, strict=True)
    starter: bool = False


class AcquireCard(RequestKey):
    expected_price: int = Field(ge=1, le=100000, strict=True)


class GrantCard(RequestKey):
    scope: EconomyScope = "SANDBOX"
    quantity: int = Field(ge=1, le=100, strict=True)
    note: str = Field(min_length=3, max_length=300)

    @field_validator("note")
    @classmethod
    def meaningful_reason(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("Give a reason for the adjustment")
        return value.strip()


class GrantTokens(RequestKey):
    scope: EconomyScope = "SANDBOX"
    delta: int = Field(ge=-1000000, le=1000000, strict=True)
    note: str = Field(min_length=3, max_length=300)

    @field_validator("note")
    @classmethod
    def meaningful_reason(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("Give a reason for the adjustment")
        return value.strip()

    @field_validator("delta")
    @classmethod
    def nonzero(cls, delta):
        if delta == 0:
            raise ValueError("Choose a nonzero adjustment")
        return delta


class Showcase(Strict):
    revision: int = Field(ge=0, strict=True)
    card_ids: list[UUID] = Field(max_length=3)
    is_public: bool = False

    @field_validator("card_ids")
    @classmethod
    def distinct_cards(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("Choose distinct cards")
        return values


class Favorite(Strict):
    favorite: bool = Field(strict=True)
    scope: EconomyScope = "REAL"


def build_router(require_permission, effective_role):
    router = APIRouter(prefix="/api", tags=["Archive packs"])

    def packs(db, offset, *, owner=False):
        statement = select(ArchivePack)
        if not owner:
            statement = statement.where(ArchivePack.active.is_(True))
        total = db.scalar(select(func.count()).select_from(statement.subquery()))
        rows = db.scalars(statement.order_by(ArchivePack.created_at.desc(), ArchivePack.id).offset(offset).limit(8)).all()
        return {"items": [service.pack_payload(db, row) for row in rows], "total": total}

    @router.get("/archive/packs")
    def catalog(response: Response, offset: int = Query(default=0, ge=0, le=100000),
                scope: EconomyScope = "REAL",
                user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        benefit_key = "starter" if scope == "REAL" else "starter:sandbox"
        claimed = db.scalar(select(ArchiveOperation.id).where(ArchiveOperation.user_id == user.id,
                                                              ArchiveOperation.benefit_key == benefit_key))
        return {**packs(db, offset), "starter_claimed": bool(claimed), "scope": scope}

    @router.get("/archive/packs/{pack_id}")
    def details(pack_id: UUID, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        pack = db.get(ArchivePack, str(pack_id))
        if not pack or (not pack.active and effective_role(user) != "OWNER"):
            raise HTTPException(404, "Pack not found")
        return {"pack": service.pack_payload(db, pack, detailed=True)}

    @router.post("/archive/packs/{pack_id}/open", dependencies=[Depends(require_csrf)])
    def open_pack(pack_id: UUID, payload: OpenPack, user: User = Depends(require_user), db: Session = Depends(get_db)):
        return service.open_pack(db, user.id, str(pack_id), payload)

    @router.post("/archive/cards/{card_id}/acquire", dependencies=[Depends(require_csrf)])
    def acquire(card_id: UUID, payload: AcquireCard, user: User = Depends(require_user), db: Session = Depends(get_db)):
        return service.acquire(db, user.id, str(card_id), payload)

    @router.get("/archive/inventory")
    def inventory(response: Response, hero: str = Query(default="", max_length=40), rank: Rank | None = None,
                  q: str = Query(default="", max_length=80), offset: int = Query(default=0, ge=0, le=100000),
                  favorites_only: bool = False,
                  scope: EconomyScope = "REAL",
                  user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        return service.inventory(db, user.id, hero, rank, q, offset, favorites_only, scope)

    @router.get("/archive/favorites")
    def favorites(response: Response, scope: EconomyScope = "REAL",
                  user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        return {"card_ids": service.favorite_card_ids(db, user.id, scope)}

    @router.put("/archive/favorites/{card_id}", dependencies=[Depends(require_csrf)])
    def save_favorite(card_id: UUID, payload: Favorite, response: Response,
                      user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        return service.set_favorite(db, user.id, str(card_id), payload.favorite, payload.scope)

    @router.post("/archive/items/{item_id}/recycle", dependencies=[Depends(require_csrf)])
    def recycle(item_id: UUID, payload: RequestKey, user: User = Depends(require_user), db: Session = Depends(get_db)):
        return service.recycle(db, user.id, str(item_id), payload)

    @router.get("/archive/inventory/coverage")
    def owned_coverage(response: Response, scope: EconomyScope = "REAL",
                       user: User = Depends(require_user), db: Session = Depends(get_db)):
        from .models import ArchiveItem
        no_store(response)
        rows = db.execute(select(ArchiveCard.hero, ArchiveCard.rank, func.count(func.distinct(ArchiveCard.id)))
                          .join(ArchiveItem, ArchiveItem.card_id == ArchiveCard.id)
                          .where(ArchiveItem.user_id == user.id, ArchiveItem.state == "OWNED", ArchiveItem.scope == scope)
                          .group_by(ArchiveCard.hero, ArchiveCard.rank)).all()
        return {"items": [{"hero": hero, "rank": rank, "count": count} for hero, rank, count in rows]}

    @router.get("/archive/openings")
    def history(response: Response, offset: int = Query(default=0, ge=0, le=100000),
                scope: EconomyScope = "REAL",
                user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        statement = select(ArchiveOperation).where(ArchiveOperation.user_id == user.id, ArchiveOperation.scope == scope)
        total = db.scalar(select(func.count()).select_from(statement.subquery()))
        rows = db.scalars(statement.order_by(ArchiveOperation.created_at.desc(), ArchiveOperation.id).offset(offset).limit(10)).all()
        return {"items": [service.receipt_payload(row) for row in rows], "total": total}

    @router.get("/archive/requests/{request_key}")
    def request_result(request_key: UUID, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        lock_user(db, user.id)
        operation = db.scalar(select(ArchiveOperation).where(ArchiveOperation.user_id == user.id,
                                                             ArchiveOperation.request_key == str(request_key)))
        return {"operation": service.receipt_payload(operation) if operation else None}

    @router.get("/archive/showcase")
    def showcase(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        return service.showcase_settings(db, user.id)

    @router.put("/archive/showcase", dependencies=[Depends(require_csrf)])
    def save_showcase(payload: Showcase, user: User = Depends(require_user), db: Session = Depends(get_db)):
        lock_user(db, user.id)
        row = db.get(ArchiveShowcase, user.id)
        if payload.revision != (row.revision if row else 0):
            raise HTTPException(409, "Витрина изменилась. Обновите страницу / Refresh showcase")
        ids = [str(value) for value in payload.card_ids]
        if any(not service.owns_card(db, user.id, card_id) for card_id in ids):
            raise HTTPException(422, "Выберите карточки из своей коллекции / Choose owned cards")
        if row is None:
            row = ArchiveShowcase(user_id=user.id, revision=0)
            db.add(row)
        row.card_ids = ids
        row.is_public = payload.is_public
        row.revision += 1
        db.commit()
        return service.showcase_settings(db, user.id)

    @router.get("/public/players/{slug}/archive/cards/{card_id}/image")
    def public_image(slug: str, card_id: UUID, db: Session = Depends(get_db)):
        profile = db.scalar(select(PublicProfile).join(User, PublicProfile.user_id == User.id).where(
            PublicProfile.slug == slug, PublicProfile.is_public.is_(True), User.status == "ACTIVE"))
        show = db.get(ArchiveShowcase, profile.user_id) if profile else None
        if not show or not show.is_public or str(card_id) not in show.card_ids or not service.owns_card(db, show.user_id, str(card_id)):
            raise HTTPException(404, "Image not found")
        card = db.get(ArchiveCard, str(card_id))
        if not card or not card.image_data:
            raise HTTPException(404, "Image not found")
        return Response(card.image_data, media_type="image/webp", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

    @router.get("/owner/archive/packs")
    def own_packs(response: Response, offset: int = Query(default=0, ge=0, le=100000),
                  owner: User = Depends(require_permission("packs.manage")), db: Session = Depends(get_db)):
        no_store(response)
        return packs(db, offset, owner=True)

    @router.post("/owner/archive/packs/preview", dependencies=[Depends(require_csrf)])
    def preview(payload: PackDesign, owner: User = Depends(require_permission("packs.manage")), db: Session = Depends(get_db)):
        config = service.configuration(db, payload)
        return {"recommendation": service.recommendation(config["entries"], config["draws"]), "odds": service.rank_odds(config["entries"])}

    @router.post("/owner/archive/packs", dependencies=[Depends(require_csrf)])
    def create(payload: PackDesign, owner: User = Depends(require_permission("packs.manage")), db: Session = Depends(get_db)):
        lock_user(db, owner.id)
        config = service.configuration(db, payload)
        pack = ArchivePack(creator_id=owner.id, active=payload.active, starter=payload.starter)
        db.add(pack)
        db.flush()
        version = ArchivePackVersion(pack_id=pack.id, revision=1, config=config)
        db.add(version)
        service.audit(db, owner.id, "pack_created", pack.id, {"revision": 1, "active": pack.active, "starter": pack.starter})
        db.commit()
        return {"pack": service.pack_payload(db, pack, detailed=True, version=version)}

    @router.put("/owner/archive/packs/{pack_id}", dependencies=[Depends(require_csrf)])
    def edit(pack_id: UUID, payload: PackEdit, owner: User = Depends(require_permission("packs.manage")), db: Session = Depends(get_db)):
        lock_user(db, owner.id)
        pack = db.scalar(select(ArchivePack).where(ArchivePack.id == str(pack_id)).with_for_update())
        if not pack:
            raise HTTPException(404, "Pack not found")
        if pack.revision != payload.revision:
            raise HTTPException(409, "Конверт изменился. Обновите редактор / Refresh pack editor")
        config = service.configuration(db, payload)
        pack.revision += 1
        pack.active, pack.starter, pack.updated_at = payload.active, payload.starter, utcnow()
        version = ArchivePackVersion(pack_id=pack.id, revision=pack.revision, config=config)
        db.add(version)
        service.audit(db, owner.id, "pack_updated", pack.id, {"revision": pack.revision, "active": pack.active, "starter": pack.starter})
        db.commit()
        return {"pack": service.pack_payload(db, pack, detailed=True, version=version)}

    @router.post("/owner/archive/packs/{pack_id}/pause", dependencies=[Depends(require_csrf)])
    def pause(pack_id: UUID, payload: Revision, owner: User = Depends(require_permission("packs.manage")), db: Session = Depends(get_db)):
        lock_user(db, owner.id)
        pack = db.scalar(select(ArchivePack).where(ArchivePack.id == str(pack_id)).with_for_update())
        if not pack or pack.revision != payload.revision:
            raise HTTPException(409, "Обновите конверт / Refresh pack")
        previous = service.pack_version(db, pack)
        pack.active = False
        pack.revision += 1
        pack.updated_at = utcnow()
        version = ArchivePackVersion(pack_id=pack.id, revision=pack.revision, config=previous.config)
        db.add(version)
        service.audit(db, owner.id, "pack_paused", pack.id, {"revision": pack.revision})
        db.commit()
        return {"pack": service.pack_payload(db, pack, version=version)}

    @router.post("/owner/archive/tokens", dependencies=[Depends(require_csrf)])
    def grant_tokens(payload: GrantTokens, owner: User = Depends(require_permission("archive.grant_self")), db: Session = Depends(get_db)):
        kind = "OWNER_REAL_ADJUSTMENT" if payload.scope == "REAL" else "OWNER_TOKENS"
        operation, replay = service.begin(db, owner.id, kind, payload.request_key,
                                           {"delta": payload.delta, "note": payload.note}, scope=payload.scope)
        if replay:
            return service.receipt_payload(operation)
        service.audit(db, owner.id, "owner_grant_tokens", operation.id, {"delta": payload.delta, "note": payload.note,
                                                                       "scope": payload.scope, "recipient_id": owner.id})
        return service.finish(db, operation, delta=payload.delta, allow_debt=payload.scope == "REAL")

    @router.post("/owner/archive/cards/{card_id}/grant", dependencies=[Depends(require_csrf)])
    def grant_card(card_id: UUID, payload: GrantCard, owner: User = Depends(require_permission("archive.grant_self")), db: Session = Depends(get_db)):
        return service.acquire(db, owner.id, str(card_id), payload, owner=True)

    return router
