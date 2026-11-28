from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker, undefer

from .community import Strict, no_store
from .db import get_db
from .foundation_banner_models import FoundationBanner
from .models import ArchiveCard, ArchiveFavorite, User, utcnow
from .services.archive import HEROES, aware, lock_user, serve_archive_image
from .services.auth import require_csrf, require_user
from .services.foundation_banner import (
    REFRESH_SLOTS, BannerMode, banner_card, claim_refresh, eligible_cards, ensure_banner_state, refresh_in_background,
)

router = APIRouter(prefix="/api/foundation/banner", tags=["Foundation banner"])


class BannerPreferences(Strict):
    mode: BannerMode
    card_id: UUID | None = None


def _artwork(card: ArchiveCard) -> dict:
    return {
        "id": card.id, "hero_key": card.hero, "hero_name": HEROES[card.hero], "title": card.title,
        "artist": card.artist, "crop_x": card.crop_x, "crop_y": card.crop_y,
        "image_url": f"/api/foundation/banner/art/{card.id}?r={card.revision}",
    }


def _preferences(db: Session, user: User, row: FoundationBanner | None) -> dict:
    card = None
    if row is not None and row.selected_card_id is not None:
        card = db.scalar(eligible_cards().where(ArchiveCard.id == row.selected_card_id))
    return {
        "account_key": user.id,
        "mode": row.mode if row is not None else "favorite_hero",
        "selected_card": _artwork(card) if card is not None else None,
    }


@router.get("")
def banner(response: Response, tasks: BackgroundTasks,
           user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    no_store(response)
    now = utcnow()
    row = db.get(FoundationBanner, user.id)
    mode = row.mode if row is not None else "favorite_hero"
    card = banner_card(db, user, row, now)
    refreshing = False
    if mode == "favorite_hero" and user.account_id is not None and 0 < user.account_id <= 2**32 - 1:
        row_is_current = row is not None and row.stat_account_id == user.account_id
        cache_fresh = row_is_current and row.next_refresh_at is not None and aware(row.next_refresh_at) > now
        refreshing = bool(row_is_current and row.refresh_lease_until is not None and aware(row.refresh_lease_until) > now)
        if not cache_fresh and not refreshing:
            if REFRESH_SLOTS.acquire(blocking=False):
                try:
                    refreshing = claim_refresh(db, user.id, user.account_id, now)
                    if refreshing:
                        factory = sessionmaker(bind=db.get_bind(), autoflush=False, expire_on_commit=False)
                        tasks.add_task(refresh_in_background, factory, user.id, user.account_id, now)
                finally:
                    if not refreshing:
                        REFRESH_SLOTS.release()
            else:
                # Let the browser poll briefly when the bounded refresh pool is busy.
                refreshing = True
    return {
        "account_key": user.id, "mode": mode,
        "card": _artwork(card) if card is not None else None, "refreshing": refreshing,
    }


@router.get("/preferences")
def preferences(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    no_store(response)
    return _preferences(db, user, db.get(FoundationBanner, user.id))


@router.put("/preferences", dependencies=[Depends(require_csrf)])
def save_preferences(payload: BannerPreferences, response: Response,
                     user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    no_store(response)
    lock_user(db, user.id)
    card_id = str(payload.card_id) if payload.card_id is not None else None
    if payload.mode == "selected_card":
        if card_id is None or not db.scalar(eligible_cards().where(ArchiveCard.id == card_id).with_only_columns(ArchiveCard.id)):
            raise HTTPException(422, "Выберите доступную иллюстрацию / Choose available artwork")
    elif card_id is not None:
        raise HTTPException(422, "Карточка указывается только для ручного выбора / A card requires manual selection")
    row = ensure_banner_state(db, user.id)
    if row.mode != payload.mode or row.selected_card_id != card_id:
        row.mode = payload.mode
        row.selected_card_id = card_id
        row.daily_date = None
        row.daily_card_id = None
        row.daily_account_id = None
    db.commit()
    return _preferences(db, user, row)


@router.get("/options")
def options(response: Response, offset: int = Query(default=0, ge=0, le=100_000),
            user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    no_store(response)
    favorite = select(ArchiveFavorite.card_id).where(
        ArchiveFavorite.user_id == user.id, ArchiveFavorite.card_id == ArchiveCard.id,
    ).exists()
    page_size = 30
    cards = list(db.scalars(eligible_cards().order_by(
        favorite.desc(), ArchiveCard.hero, ArchiveCard.title, ArchiveCard.id,
    ).offset(offset).limit(page_size + 1)))
    return {"account_key": user.id, "items": [_artwork(card) for card in cards[:page_size]],
            "next_offset": offset + page_size if len(cards) > page_size else None}


@router.get("/art/{card_id}")
def artwork(card_id: UUID, _user: User = Depends(require_user), db: Session = Depends(get_db)) -> Response:
    card = db.scalar(eligible_cards().where(ArchiveCard.id == str(card_id)).options(undefer(ArchiveCard.image_data)))
    return serve_archive_image(card)
