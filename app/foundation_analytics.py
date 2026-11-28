"""Authenticated browser activity ingress and a TOTP-protected aggregate report."""
from typing import Literal
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, UUID4
from sqlalchemy.orm import Session

from .community import no_store
from .db import get_db
from .models import User, utcnow
from .security import rate_limit_allow
from .security import rate_limit_allow
from .services.auth import require_csrf, require_user
from .services.foundation_analytics import foundation_metrics, onboarding_verified, record_event


class BrowserEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID4
    name: Literal[
        "session_started",
        "onboarding_started",
        "onboarding_skipped",
        "onboarding_completed",
        "contract_board_viewed",
        "contract_selected",
        "completion_viewed",
        "collection_viewed",
        "community_viewed",
    ]


async def _rate_limited_player(user: User = Depends(require_user)) -> User:
    allowed, retry_after = await rate_limit_allow(f"foundation-events:user:{user.id}", 36, 60)
    if not allowed:
        raise HTTPException(429, "Too many analytics events", headers={"Retry-After": str(retry_after)})
    return user


def build_router(require_admin):
    router = APIRouter(prefix="/api", tags=["Foundation analytics"])

    @router.post("/foundation/events", status_code=204, dependencies=[Depends(require_csrf)])
    def collect(event: BrowserEvent, user: User = Depends(_rate_limited_player), db: Session = Depends(get_db)):
        now = utcnow()
        if event.name == "onboarding_completed" and not onboarding_verified(db, user.id, now):
            raise HTTPException(409, "Progress is not confirmed")
        # Onboarding milestones are once per account. Other actions permit
        # repeat activity, with exact request replays deduplicated in the DB.
        event_id = (
            uuid5(NAMESPACE_URL, f"deadlock-contracts/foundation/{event.name}")
            if event.name.startswith("onboarding_")
            else event.event_id
        )
        record_event(db, user.id, str(event_id), event.name, now)
        db.commit()

    @router.get("/admin/foundation-analytics")
    def report(response: Response, _admin: User = Depends(require_admin), db: Session = Depends(get_db)):
        no_store(response)
        return foundation_metrics(db)

    return router
