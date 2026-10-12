"""Authenticated arena HTTP boundary; plans contain choices, never outcomes."""
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .battle_models import BattleArtwork, BattleDefinitionVersion
from .community import Strict, no_store
from .db import get_db
from .models import ArchiveCard, AuditLog, User
from .services import battle_service as service, battle_social as social
from .services.auth import require_csrf, require_user

Scope = Literal["REAL", "SANDBOX"]


class Command(Strict):
    request_key: UUID


class Starter(Command):
    scope: Scope = "REAL"


class Slot(Strict):
    item_id: UUID
    line: int = Field(ge=0, le=2, strict=True)
    position: Literal["FRONT", "BACK"]


class Squad(Strict):
    expected_revision: int = Field(ge=0, strict=True)
    scope: Scope = "REAL"
    base_item_id: UUID | None = None
    slots: list[Slot] = Field(min_length=6, max_length=6)


class Start(Command):
    mode: Literal["TUTORIAL", "TRAINING", "ASSIGNED", "HARD", "TRIAL", "WEEKLY", "COPY"]
    scope: Scope = "REAL"
    squad_revision: int = Field(ge=1, strict=True)
    base_item_id: UUID | None = None
    patron_key: Literal["HIDDEN_KING", "ARCHMOTHER"] | None = None
    assignment_id: UUID | None = None
    copy_user_id: UUID | None = None


class Swap(Strict):
    type: Literal["SWAP"]
    first_id: str = Field(min_length=1, max_length=80)
    second_id: str = Field(min_length=1, max_length=80)


class HeroAbility(Strict):
    type: Literal["HERO_ABILITY"]
    actor_id: str = Field(min_length=1, max_length=80)
    target_id: str | None = Field(default=None, min_length=1, max_length=80)


class BaseAbility(Strict):
    type: Literal["BASE_ABILITY"]
    target_id: str | None = Field(default=None, min_length=1, max_length=80)
    line: int | None = Field(default=None, ge=0, le=2, strict=True)


class Plan(Command):
    expected_revision: int = Field(ge=1, strict=True)
    actions: list[Annotated[Swap | HeroAbility | BaseAbility, Field(discriminator="type")]] = Field(max_length=2)


class Surrender(Command):
    expected_revision: int = Field(ge=1, strict=True)


class Confirm(Command):
    squad_revision: int = Field(ge=1, strict=True)
    base_item_id: UUID | None = None


class Showcase(Strict):
    expected_revision: int = Field(ge=0, strict=True)
    is_public: bool
    base_item_id: UUID | None = None
    slots: list[Slot] = Field(min_length=6, max_length=6)


class Season(Command):
    title: str = Field(min_length=2, max_length=80)
    starts_at: datetime
    ends_at: datetime
    active: bool = False


class Approval(Strict):
    card_id: UUID
    definition_id: UUID
    approved: bool


def _private(response):
    no_store(response)


def build_router(require_permission=None, effective_role=None):
    router = APIRouter(prefix="/api", tags=["Card arena"])
    # Existing owner permission dependency additionally enforces session TOTP elevation.
    owner_dependency = require_permission("archive.grant_self") if require_permission else require_user

    @router.get("/arena/bootstrap")
    def bootstrap(response: Response, scope: Scope = "REAL", user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return service.bootstrap(db, user.id, scope)

    @router.get("/arena/requests/{request_key}")
    def recovery(request_key: UUID, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return service.request_result(db, user.id, str(request_key))

    @router.post("/arena/starter", dependencies=[Depends(require_csrf)])
    def starter(body: Starter, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return service.claim_starter(db, user.id, str(body.request_key), body.scope)

    @router.put("/arena/squad", dependencies=[Depends(require_csrf)])
    def squad(body: Squad, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return service.save_squad(db, user.id, body.expected_revision, body.scope,
            str(body.base_item_id) if body.base_item_id else None, [value.model_dump(mode="json") for value in body.slots])

    @router.post("/arena/matches", dependencies=[Depends(require_csrf)])
    def start(body: Start, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return service.start_match(db, user.id, body.model_dump(mode="json"))

    @router.get("/arena/matches/{match_id}")
    def match(match_id: UUID, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return service.get_match(db, user.id, str(match_id))

    @router.get("/arena/matches/{match_id}/cards/{card_id}/image")
    def match_image(match_id: UUID, card_id: UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
        card = service.match_card(db, user.id, str(match_id), str(card_id))
        return Response(card.image_data, media_type="image/webp", headers={
            "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

    @router.post("/arena/matches/{match_id}/plans", dependencies=[Depends(require_csrf)])
    def plan(match_id: UUID, body: Plan, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return service.submit_plan(db, user.id, str(match_id), str(body.request_key), body.expected_revision,
            [value.model_dump(mode="json", exclude_none=True) for value in body.actions])

    @router.post("/arena/matches/{match_id}/surrender", dependencies=[Depends(require_csrf)])
    def surrender(match_id: UUID, body: Surrender, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return service.surrender(db, user.id, str(match_id), str(body.request_key), body.expected_revision)

    @router.post("/arena/cleanup", dependencies=[Depends(require_csrf)])
    def cleanup(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return service.cleanup_expired(db, user.id)

    @router.post("/arena/rooms", dependencies=[Depends(require_csrf)])
    def room_create(body: Starter, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.create_room(db, user.id, str(body.request_key), body.scope)

    @router.get("/arena/rooms/{code}")
    def room_get(code: str, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.get_room(db, user.id, code)

    @router.post("/arena/rooms/{code}/join", dependencies=[Depends(require_csrf)])
    def room_join(code: str, body: Command, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.join_room(db, user.id, code, str(body.request_key))

    @router.post("/arena/rooms/{code}/confirm", dependencies=[Depends(require_csrf)])
    def room_confirm(code: str, body: Confirm, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.confirm_room(db, user.id, code, str(body.request_key), body.squad_revision,
            str(body.base_item_id) if body.base_item_id else None)

    @router.post("/arena/rooms/{code}/leave", dependencies=[Depends(require_csrf)])
    def room_leave(code: str, body: Command, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.leave_room(db, user.id, code, str(body.request_key))

    @router.post("/arena/queue", dependencies=[Depends(require_csrf)])
    def queue_join(body: Confirm, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.join_queue(db, user.id, str(body.request_key), body.squad_revision,
            str(body.base_item_id) if body.base_item_id else None)

    @router.get("/arena/queue")
    def queue_get(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.queue_status(db, user.id)

    @router.delete("/arena/queue", dependencies=[Depends(require_csrf)])
    def queue_cancel(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.cancel_queue(db, user.id)

    @router.get("/arena/leaderboard")
    def leaders(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.leaderboard(db)

    @router.put("/arena/showcase", dependencies=[Depends(require_csrf)])
    def showcase(body: Showcase, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        _private(response); return social.save_showcase(db, user.id, body.expected_revision, body.is_public,
            str(body.base_item_id) if body.base_item_id else None, [value.model_dump(mode="json") for value in body.slots])

    @router.get("/public/players/{slug}/arena/showcase")
    def public_showcase(slug: str, response: Response, db: Session = Depends(get_db)):
        no_store(response); return social.public_showcase(db, slug)

    @router.get("/public/players/{slug}/arena/cards/{card_id}/image")
    def public_image(slug: str, card_id: UUID, db: Session = Depends(get_db)):
        showcase = social.public_showcase(db, slug)["showcase"]
        cards = [value["card"] for value in showcase["heroes"]] + ([showcase["base_card"]] if showcase["base_card"] else [])
        if str(card_id) not in {card["id"] for card in cards}: raise HTTPException(404, "Image not found")
        card = db.get(ArchiveCard, str(card_id))
        if not card or not card.image_data: raise HTTPException(404, "Image not found")
        return Response(card.image_data, media_type="image/webp", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

    @router.post("/arena/season", dependencies=[Depends(require_csrf), Depends(owner_dependency)])
    def season(body: Season, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        if not effective_role or effective_role(user) != "OWNER": raise HTTPException(403, "Owner permission required")
        _private(response); return social.set_season(db, user.id, str(body.request_key), body.title, body.starts_at, body.ends_at, body.active)

    @router.put("/arena/artwork-approval", dependencies=[Depends(require_csrf), Depends(owner_dependency)])
    def approval(body: Approval, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        if not effective_role or effective_role(user) != "OWNER": raise HTTPException(403, "Owner permission required")
        service._lock_users(db, user.id)
        card = db.scalar(select(ArchiveCard).where(ArchiveCard.id == str(body.card_id)).with_for_update())
        definition = db.get(BattleDefinitionVersion, str(body.definition_id))
        if (not card or card.status != "PUBLISHED" or not definition or not definition.approved
                or definition.key != card.hero or (definition.category == "HERO" and card.rank not in service.engine.RANKS)
                or (definition.category == "BASE" and card.rank != "EX")):
            raise HTTPException(422, "Matching published artwork and approved definition required")
        row = db.get(BattleArtwork, card.id)
        if row is None:
            row = BattleArtwork(card_id=card.id, definition_id=definition.id); db.add(row)
        row.definition_id = definition.id; row.approved = body.approved
        db.add(AuditLog(user_id=user.id, action="arena.artwork_approval", entity_type="archive", entity_id=card.id,
            data={"definition_id": definition.id, "approved": body.approved}))
        db.commit(); _private(response)
        return {"card_id": card.id, "definition_id": definition.id, "approved": row.approved}

    @router.get("/arena/definitions", dependencies=[Depends(owner_dependency)])
    def definitions(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        if not effective_role or effective_role(user) != "OWNER": raise HTTPException(403, "Owner permission required")
        _private(response)
        return {"definitions": [dict(id=row.id, key=row.key, category=row.category, version=row.version,
            approved=row.approved, rules=row.rules) for row in db.scalars(select(BattleDefinitionVersion).order_by(BattleDefinitionVersion.key, BattleDefinitionVersion.version))]}

    return router
