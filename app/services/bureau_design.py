"""Bounded bureau presentation. Cosmetic ranks never change membership rights."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Appearance(Strict):
    accent: Literal["SAGE", "BRASS", "OCEAN", "PLUM", "EMBER"] = "SAGE"
    cover: Literal["AURORA", "GRID", "ARCHIVE", "PLAIN"] = "AURORA"
    emblem: Literal["compass", "swords", "shield", "crown", "eye", "moon", "feather", "flask-conical", "book-open", "handshake", "gem", "building-2"] = "compass"
    avatar_shape: Literal["ROUNDED", "CIRCLE", "SHIELD"] = "ROUNDED"
    roster_layout: Literal["CARDS", "LIST"] = "CARDS"
    cover_position: int = Field(default=50, ge=0, le=100)


class RoleTitles(Strict):
    DIRECTOR: str = Field(default="", max_length=24)
    MODERATOR: str = Field(default="", max_length=24)
    OPERATIVE: str = Field(default="", max_length=24)


def summary(bureau):
    return {
        "appearance": Appearance.model_validate(bureau.appearance or {}).model_dump(),
        "avatar_url": f"/api/bureaus/{bureau.slug}/media/avatar?r={bureau.avatar_digest}" if bureau.avatar_digest else None,
        "cover_url": f"/api/bureaus/{bureau.slug}/media/cover?r={bureau.cover_digest}" if bureau.cover_digest else None,
    }
