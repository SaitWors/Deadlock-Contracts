from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field, StrictBool, model_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .community import Strict, no_store
from .db import get_db
from .models import AuditLog, HeroVoteCampaign, HeroVoteSnapshot, HeroVoteSource, User, utcnow
from .services import hero_votes as polls
from .services.auth import require_csrf


class Candidate(Strict):
    hero_id: int = Field(strict=True, ge=1, le=100000)
    name_ru: str = Field(min_length=1, max_length=80)
    name_en: str = Field(min_length=1, max_length=80)
    released: StrictBool = False


class CampaignInput(Strict):
    title_ru: str = Field(min_length=3, max_length=120)
    title_en: str = Field(min_length=3, max_length=120)
    candidates: list[Candidate] = Field(min_length=2, max_length=12)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    providers: list[Literal["deadlock_labs", "statlocker"]] = Field(min_length=1, max_length=2)

    @model_validator(mode="after")
    def validate_campaign(self):
        if len({item.hero_id for item in self.candidates}) != len(self.candidates):
            raise ValueError("Hero IDs must be unique")
        if len(set(self.providers)) != len(self.providers):
            raise ValueError("Providers must be unique")
        if not any(not item.released for item in self.candidates):
            raise ValueError("At least one unreleased candidate is required")
        for value in (self.starts_at, self.ends_at):
            if value is not None and value.tzinfo is None:
                raise ValueError("Dates must include a timezone")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("End must follow start")
        return self


class EditCampaign(CampaignInput):
    expected_revision: int = Field(strict=True, ge=1)


class CampaignAction(Strict):
    expected_revision: int = Field(strict=True, ge=1)
    action: Literal["ACTIVATE", "HIDE", "END", "REFRESH"]


def audit(db, user, item, action):
    db.add(AuditLog(user_id=user.id, action=f"hero_votes.{action}", entity_type="hero_vote_campaign",
        entity_id=item.id, data={"revision": item.revision}))


def build_router(require_permission):
    router = APIRouter(prefix="/api", tags=["Community hero polls"])

    @router.get("/public/hero-votes")
    def public(response: Response, db: Session = Depends(get_db)):
        no_store(response)
        return polls.public_payload(db)

    @router.get("/admin/hero-votes")
    def campaigns(response: Response, staff: User = Depends(require_permission("hero_votes.read")), db: Session = Depends(get_db)):
        no_store(response)
        rows = db.scalars(select(HeroVoteCampaign).order_by(HeroVoteCampaign.created_at.desc()).limit(50)).all()
        return {"items": [polls.campaign_payload(db, item, admin=True) for item in rows], "preset": {
            "title_ru": "Город не спит", "title_en": "The City Never Sleeps", "candidates": polls.PRESET,
            "starts_at": None, "ends_at": "2026-10-20T21:00:00+00:00", "providers": list(polls.PROVIDERS)}}

    @router.post("/admin/hero-votes", dependencies=[Depends(require_csrf)])
    def create(payload: CampaignInput, staff: User = Depends(require_permission("hero_votes.manage")), db: Session = Depends(get_db)):
        item = HeroVoteCampaign(**payload.model_dump(exclude={"providers"}))
        db.add(item)
        db.flush()
        for provider in payload.providers:
            db.add(HeroVoteSource(campaign_id=item.id, provider=provider))
        audit(db, staff, item, "created")
        db.commit()
        return {"item": polls.campaign_payload(db, item, admin=True)}

    def claim(db, campaign_id, expected):
        if not db.execute(update(HeroVoteCampaign).where(HeroVoteCampaign.id == str(campaign_id),
                HeroVoteCampaign.revision == expected).values(revision=expected + 1, updated_at=utcnow())).rowcount:
            db.rollback()
            if not db.get(HeroVoteCampaign, str(campaign_id)):
                raise HTTPException(404, "Кампания не найдена / Campaign not found")
            raise HTTPException(409, "Кампания изменилась. Обновите список / Campaign changed; reload")
        return db.get(HeroVoteCampaign, str(campaign_id), populate_existing=True)

    @router.patch("/admin/hero-votes/{campaign_id}", dependencies=[Depends(require_csrf)])
    def edit(campaign_id: UUID, payload: EditCampaign, staff: User = Depends(require_permission("hero_votes.manage")), db: Session = Depends(get_db)):
        item = claim(db, campaign_id, payload.expected_revision)
        sources = db.scalars(select(HeroVoteSource).where(HeroVoteSource.campaign_id == item.id)).all()
        has_data = db.scalar(select(HeroVoteSnapshot.id).join(HeroVoteSource)
            .where(HeroVoteSource.campaign_id == item.id).limit(1)) is not None
        if has_data and {candidate.hero_id for candidate in payload.candidates} != {candidate["hero_id"] for candidate in item.candidates}:
            raise HTTPException(409, "Для другого состава героев создайте новую кампанию / Create a new campaign for different heroes")
        for key, value in payload.model_dump(exclude={"providers", "expected_revision"}).items():
            setattr(item, key, value)
        for source in sources:
            source.enabled = source.provider in payload.providers
        for provider in set(payload.providers) - {source.provider for source in sources}:
            db.add(HeroVoteSource(campaign_id=item.id, provider=provider))
        audit(db, staff, item, "edited")
        db.commit()
        return {"item": polls.campaign_payload(db, item, admin=True)}

    @router.post("/admin/hero-votes/{campaign_id}/actions", dependencies=[Depends(require_csrf)])
    def action(campaign_id: UUID, payload: CampaignAction, staff: User = Depends(require_permission("hero_votes.manage")), db: Session = Depends(get_db)):
        item = claim(db, campaign_id, payload.expected_revision)
        now = utcnow()
        if payload.action == "ACTIVATE":
            if item.ends_at and polls.aware(item.ends_at) <= now:
                raise HTTPException(409, "Срок кампании истёк. Измените дату завершения / Campaign end date has passed")
            db.execute(update(HeroVoteCampaign).where(HeroVoteCampaign.active_slot == "CURRENT", HeroVoteCampaign.id != item.id)
                .values(active_slot=None, visible=False, revision=HeroVoteCampaign.revision + 1, updated_at=now))
            db.flush()
            item.active_slot, item.visible, item.ended_at = "CURRENT", True, None
        elif payload.action == "HIDE":
            item.visible = False
        elif payload.action == "END":
            item.active_slot, item.visible, item.ended_at = None, False, now
        else:
            if not polls.is_live(item, now):
                raise HTTPException(409, "Сначала активируйте кампанию / Activate the campaign first")
            # Never bypass the per-source ten-minute request limit.
            sources = db.scalars(select(HeroVoteSource).where(HeroVoteSource.campaign_id == item.id, HeroVoteSource.enabled.is_(True))).all()
            if any(polls.aware(source.next_refresh_at) > now for source in sources):
                raise HTTPException(429, "Обновление уже запланировано; интервал 10 минут / Refresh already scheduled; interval is 10 minutes")
        audit(db, staff, item, payload.action.lower())
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Другая кампания была активирована одновременно / Another campaign was activated concurrently")
        return {"item": polls.campaign_payload(db, item, admin=True)}

    return router
