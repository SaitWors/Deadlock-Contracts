"""Authored collection fixtures for disposable CI databases, never startup seed."""
from hashlib import sha256
from io import BytesIO
from uuid import NAMESPACE_URL, uuid5

from PIL import Image

from app.models import ArchiveCard, utcnow
from app.services.card_battle import HEROES, RANKS


def seed_original_archive_fixture(db):
    for index, hero in enumerate(HEROES):
        output = BytesIO()
        Image.new("RGB", (300, 450), (30 + index * 9, 70, 80)).save(output, "WEBP")
        artwork = output.getvalue()
        for rank in RANKS:
            identifier = str(uuid5(NAMESPACE_URL, f"ci-original-archive-v1:{hero}:{rank}"))
            if db.get(ArchiveCard, identifier) is None:
                db.add(ArchiveCard(id=identifier, hero=hero, rank=rank, title=f"CI original · {hero}",
                    artist="CI fixture", image_data=artwork, image_digest=sha256(artwork).hexdigest(),
                    status="PUBLISHED", published_at=utcnow()))
    db.flush()
