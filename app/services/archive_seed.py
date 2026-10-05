"""An insert-only catalogue release, independent of owned cards and pack versions."""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..models import ArchiveCard, utcnow
from .archive import HEROES


RELEASE_SOURCE_URL = "https://www.playdeadlock.com/cityneversleeps"
RELEASE_ARTWORK = Path(__file__).resolve().parents[1] / "data/archive/city-never-sleeps"
# This allowlist deliberately does not include user-authored catalogue records.
RELEASE_HEROES = ("nurse-harrow", "rat-king", "solomon", "deadman-danny", "baba", "violet")
# Keep this identity version stable: existing inventory and receipts refer to these IDs.
RELEASE_CARD_IDS = {hero: str(uuid5(NAMESPACE_URL, f"{RELEASE_SOURCE_URL}#contracts-archive-v1-{hero}"))
                    for hero in RELEASE_HEROES}


def release_artwork_path(hero: str) -> Path | None:
    """Only bundled official posters may be served by the public release route."""
    return RELEASE_ARTWORK / f"{hero}.webp" if hero in RELEASE_HEROES else None


@lru_cache(maxsize=1)
def _release_digests() -> dict[str, str]:
    manifest = json.loads((RELEASE_ARTWORK / "manifest.json").read_text())
    return {RELEASE_CARD_IDS[item["hero_key"]]: item["sha256"] for item in manifest["assets"]}


def is_release_poster(card) -> bool:
    """Presentation metadata follows the actual bundled bytes, not an editable ID."""
    if str(card.id) not in RELEASE_CARD_IDS.values() or card.source_url != RELEASE_SOURCE_URL:
        return False
    return bool(card.image_data and hashlib.sha256(card.image_data).hexdigest() == _release_digests()[str(card.id)])


def seed_archive_cards(db: Session) -> None:
    """Insert missing release IDs; never update a design or undo moderation."""
    dialect = db.get_bind().dialect.name
    insert = {"postgresql": postgresql_insert, "sqlite": sqlite_insert}.get(dialect)
    if insert is None:
        raise RuntimeError(f"Archive release seeding does not support {dialect}")
    now = utcnow()
    cards = []
    for hero, card_id in RELEASE_CARD_IDS.items():
        # Trusted, reviewed release assets are bundled unchanged. No user URL is fetched.
        artwork = (RELEASE_ARTWORK / f"{hero}.webp").read_bytes()
        cards.append({
            "id": card_id, "creator_id": None, "hero": hero, "rank": "F",
            "title": f"City Never Sleeps · {HEROES[hero]}",
            "description": "Официальная иллюстрация Valve / Official Valve artwork. "
                           "Неофициальная коллекция / Unofficial collection.",
            "artist": "Valve", "source_url": RELEASE_SOURCE_URL,
            # This field is an author's upload attestation, not an ownership claim.
            # Bundled system releases have source attribution instead of a user attestation.
            "rights_confirmed": False,
            "image_data": artwork, "image_digest": hashlib.sha256(artwork).hexdigest(),
            "crop_x": 50, "crop_y": 50, "zoom": 1.0, "frame_version": 1,
            "status": "PUBLISHED", "revision": 1,
            "review_note": "Bundled City Never Sleeps release. Official poster artwork credited to Valve; "
                           "source and original asset URLs are recorded in the release manifest.",
            "reviewed_by": None, "created_at": now, "updated_at": now,
            "submitted_at": None, "published_at": now,
        })
    # Unique primary keys arbitrate competing web-process startups. In particular,
    # ARCHIVED rows and administrator edits remain untouched on every later restart.
    db.execute(insert(ArchiveCard).values(cards).on_conflict_do_nothing(index_elements=["id"]))
    # The startup caller owns the transaction; do not commit unrelated work here.
