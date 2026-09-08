from __future__ import annotations

from datetime import timezone

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, text
from uuid import uuid4

from app.db import engine, SessionLocal
from app.models import BureauMembership, BureauMembershipPeriod, PlayerBureau, PublicProfile, User


def current_revision() -> str:
    with engine.connect() as connection:
        revision = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()

    return str(revision)


def main() -> None:
    config = Config("alembic.ini")
    scripts = ScriptDirectory.from_config(config)

    heads = scripts.get_heads()
    if len(heads) != 1:
        raise RuntimeError(
            f"Expected exactly one Alembic head, got: {heads}"
        )

    head = heads[0]
    revision = scripts.get_revision(head)

    if revision is None:
        raise RuntimeError(f"Alembic head {head!r} not found")

    parent = revision.down_revision
    if not isinstance(parent, str):
        raise RuntimeError(
            f"Latest migration must have one parent, got: {parent!r}"
        )

    before = current_revision()
    if before != head:
        raise RuntimeError(
            f"Database must begin at head {head}, got {before}"
        )

    # Preserve the existing profile and preserve membership history across the latest migration.
    token = uuid4().hex[:12]
    with SessionLocal() as db:
        player = User(display_name="Migration preservation check")
        db.add(player)
        db.flush()
        player_id = player.id
        db.add(PublicProfile(user_id=player.id, slug=f"migration-{token}", headline="Preserved headline", is_public=False, show_stats=False, theme="NOIR"))
        bureau = PlayerBureau(slug=f"migration-bureau-{token}", name="Deadlock Migration", owner_user_id=player.id)
        db.add(bureau); db.flush()
        bureau_id = bureau.id
        member = BureauMembership(bureau_id=bureau.id, user_id=player.id, role="DIRECTOR")
        db.add(member); db.flush()
        member_id, joined_at = member.id, member.joined_at
        db.add(BureauMembershipPeriod(id=member_id, bureau_id=bureau.id, user_id=player.id, joined_at=joined_at))
        db.commit()

    print(f"Downgrade smoke: {head} -> {parent}")
    command.downgrade(config, parent)

    downgraded = current_revision()
    if downgraded != parent:
        raise RuntimeError(
            f"Expected revision {parent}, got {downgraded}"
        )

    print(f"Upgrade smoke: {parent} -> {head}")
    command.upgrade(config, "head")

    upgraded = current_revision()
    if upgraded != head:
        raise RuntimeError(
            f"Expected revision {head}, got {upgraded}"
        )

    command.check(config)
    with SessionLocal() as db:
        profile = db.query(PublicProfile).filter_by(user_id=player_id).one()
        assert profile.headline == "Preserved headline" and profile.theme == "NOIR"
        assert profile.is_public is False and profile.show_stats is False
        assert profile.show_bureau is False
        assert profile.showcase_order == ["contracts", "achievements", "bureau"]
        assert profile.pinned_contract_ids == []
        bureau = db.get(PlayerBureau, bureau_id)
        assert bureau.status == "ACTIVE" and bureau.moderation_note == ""
        period = db.get(BureauMembershipPeriod, member_id)
        assert period.user_id == player_id and period.bureau_id == bureau_id
        assert period.joined_at.replace(tzinfo=timezone.utc) == joined_at and period.left_at is None
        db.execute(delete(BureauMembershipPeriod).where(BureauMembershipPeriod.id == member_id))
        db.execute(delete(PlayerBureau).where(PlayerBureau.id == bureau_id))
        db.execute(delete(User).where(User.id == player_id))
        db.commit()
    print("Existing profile preserved; bureau remains active; membership history preserved")

    print(
        f"Migration smoke OK: "
        f"{head} -> {parent} -> {head}"
    )


if __name__ == "__main__":
    main()