from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .services.auth import require_user
from .services.case_completion import case_completion


router = APIRouter(prefix="/api/boards", tags=["Case completion"])


@router.get("/{board_id}/completion")
def completion_receipt(
    board_id: str,
    response: Response,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    receipt = case_completion(db, user, board_id)
    if receipt is None:
        raise HTTPException(404, "Доска не найдена")
    return receipt
