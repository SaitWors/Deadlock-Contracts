"""Owner-only aggregate instrumentation for the arena pilot."""
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from .community import no_store
from .db import get_db
from .models import User
from .services.arena_telemetry import pilot_metrics


def build_router(require_permission):
    router = APIRouter(prefix="/api/owner/arena", tags=["Arena pilot"])

    @router.get("/telemetry")
    def telemetry(response: Response, owner: User = Depends(require_permission("archive.grant_self")),
                  db: Session = Depends(get_db)):
        no_store(response)
        return pilot_metrics(db)

    return router
