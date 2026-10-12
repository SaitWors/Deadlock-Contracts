"""Explicit authored archive fixtures; production arena seed must create no art."""
from hashlib import sha256
from io import BytesIO
from uuid import NAMESPACE_URL, uuid5

from PIL import Image

from app.battle_models import BattleArtwork
from app.models import ArchiveCard, utcnow
from app.services.battle_catalog import identity
from app.services.card_battle import BASES, HEROES, RANKS


def original_card_id(key, rank):
    return str(uuid5(NAMESPACE_URL, f"test-original-archive-v1:{key}:{rank}"))


def seed_original_catalogue(db):
    for index, key in enumerate([*HEROES, *[base for base in BASES if base != "ORDINARY"]]):
        output = BytesIO()
        Image.new("RGB", (300, 450), (30 + index * 9, 70, 80)).save(output, "WEBP")
        artwork = output.getvalue()
        for rank in RANKS if key in HEROES else ("EX",):
            card_id = original_card_id(key, rank)
            if db.get(ArchiveCard, card_id) is None:
                db.add(ArchiveCard(id=card_id, hero=key, rank=rank, title=f"Original archive · {key}",
                    artist="Regression fixture", image_data=artwork, image_digest=sha256(artwork).hexdigest(),
                    status="PUBLISHED", published_at=utcnow()))
                db.flush()
            if db.get(BattleArtwork, card_id) is None:
                db.add(BattleArtwork(card_id=card_id, definition_id=identity("definition", key), approved=True))
    db.flush()
