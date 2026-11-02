"""Private coin receipts and authorized, append-only reward corrections."""
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import Field
from sqlalchemy.orm import Session

from .community import Strict, no_store
from .db import get_db
from .models import User
from .services import coin_rewards as service
from .services.auth import require_csrf, require_user
from .services.retired_economy import retired_player_feature


class Correction(Strict):
    request_key: UUID
    reason: str = Field(min_length=3, max_length=300)


def build_router(require_permission):
    router = APIRouter(prefix="/api", tags=["Coin rewards"])

    @router.get("/archive/coin-rewards", dependencies=[Depends(retired_player_feature)])
    def status(response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
        no_store(response)
        from .services.extra_coin_rewards import status as extra_status
        return {**service.status(db, user.id), **extra_status(db, user.id)}

    @router.post("/owner/archive/coin-rewards/{entitlement_id}/correct", dependencies=[Depends(require_csrf)])
    def correct(entitlement_id: UUID, payload: Correction, response: Response,
                owner: User = Depends(require_permission("archive.grant_self")), db: Session = Depends(get_db)):
        no_store(response)
        result = service.correct_entitlement(db, str(entitlement_id), request_key=payload.request_key,
                                             actor_user_id=owner.id, reason=payload.reason)
        db.commit()
        return result

    return router
