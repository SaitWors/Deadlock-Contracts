"""Player economy retirement without deleting historical data or admin tools."""
from fastapi import Depends, HTTPException

from ..models import User
from .auth import require_user


def retired_player_feature(user: User = Depends(require_user)):
    raise HTTPException(410, "Этот раздел закрыт. Доступна коллекция и бесплатный ежедневный конверт / This feature is retired. Use the collection and free daily pack")
