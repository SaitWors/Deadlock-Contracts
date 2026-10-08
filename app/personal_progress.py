from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .services.auth import require_user
from .services.personal_progress import ProgressIntent, ProgressMode, build_personal_progress


router = APIRouter(prefix="/api", tags=["Personal progress"])


@router.get("/personal-progress")
def personal_progress(
    response: Response,
    mode: ProgressMode = "STANDARD",
    intent: ProgressIntent = "PRACTICE",
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    return build_personal_progress(db, user, mode, intent)
