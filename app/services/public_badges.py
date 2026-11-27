from __future__ import annotations

from ..models import User

PUBLIC_BADGES = {"DEVELOPER", "STREAMER", "EARLY_TESTER", "CONTRIBUTOR"}


def stored_public_badges(user: User) -> set[str]:
    return {str(badge).upper() for badge in (getattr(user, "public_badges", None) or [])} & PUBLIC_BADGES
