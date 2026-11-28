from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from hashlib import sha256
from threading import BoundedSemaphore
from typing import Literal

from sqlalchemy import and_, case, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, sessionmaker

from ..config import settings
from ..foundation_banner_models import FoundationBanner
from ..models import ArchiveCard, ArchiveItem, Match, MatchParticipant, User, utcnow
from .archive import HEROES, aware
from .personal_progress import RECENT_MATCH_LIMIT, group_hero_matches
from .providers import DeadlockApiProvider, ProviderError, ProviderRateLimited

log = logging.getLogger(__name__)

BannerMode = Literal["favorite_hero", "collection", "selected_card", "random_hero", "off"]
STAT_TTL = timedelta(days=1)
STALE_TTL = timedelta(days=30)
REFRESH_LEASE = timedelta(seconds=max(120, 6 * settings.request_timeout_seconds))
REFRESH_SLOTS = BoundedSemaphore(2)
MIN_MATCHES = 5

# IDs from https://api.deadlock-api.com/v1/assets/heroes, joined to the existing archive roster.
# Catalogue keys describe the design subject and are independent of internal Valve class names.
HERO_KEYS = {
    1: "infernus", 2: "seven", 3: "vindicta", 4: "lady-geist", 6: "abrams", 7: "wraith",
    8: "mcginnis", 10: "paradox", 11: "dynamo", 12: "kelvin", 13: "haze", 14: "holliday",
    15: "bebop", 16: "calico", 17: "grey-talon", 18: "mo-krill", 19: "shiv", 20: "ivy",
    25: "warden", 27: "yamato", 31: "lash", 35: "viscous", 50: "pocket", 52: "mirage",
    58: "vyper", 60: "sinclair", 63: "mina", 64: "drifter", 65: "venator", 66: "victor",
    67: "paige", 69: "the-doorman", 72: "billy", 76: "graves", 77: "apollo", 78: "deadman-danny",
    79: "rem", 80: "silver", 81: "celeste", 84: "rat-king", 85: "solomon", 86: "violet",
    87: "nurse-harrow", 88: "baba",
}


def most_played_hero(rows: list[dict[str, int]], minimum: int = MIN_MATCHES) -> int | None:
    sample_size = sum(row["matches_played"] for row in rows if row["hero_id"] in HERO_KEYS)
    if sample_size < minimum:
        return None
    leader = min(rows, key=lambda row: (-row["matches_played"], -row["last_played"], row["hero_id"]))
    return leader["hero_id"] if leader["hero_id"] in HERO_KEYS else None


def favorite_from_provider(provider: DeadlockApiProvider, account_id: int, now: datetime) -> int | None:
    for window in (30, 90, None):
        start = int((now - timedelta(days=window)).timestamp()) if window is not None else None
        hero_id = most_played_hero(provider.hero_stats(account_id, start))
        if hero_id is not None:
            return hero_id
    return None


def _local_hero(db: Session, account_id: int) -> int | None:
    matches = list(db.execute(
        select(Match, MatchParticipant)
        .join(MatchParticipant, MatchParticipant.match_id == Match.id)
        .where(
            MatchParticipant.account_id == account_id,
            Match.game_match_mode == "STANDARD", Match.is_final.is_(True),
            func.coalesce(MatchParticipant.scoring_status, Match.scoring_status) == "SCORED",
            MatchParticipant.hero_id.is_not(None),
        )
        .order_by(Match.started_at.desc().nullslast(), Match.created_at.desc(), Match.id.desc())
        .limit(RECENT_MATCH_LIMIT)
    ).all())
    return most_played_hero([{
        "hero_id": hero_id,
        "matches_played": len(rows),
        "last_played": max(int(aware(match.started_at or match.created_at).timestamp()) for match, _ in rows),
    } for hero_id, rows in group_hero_matches(matches).items()], minimum=1)


def ensure_banner_state(db: Session, user_id: str) -> FoundationBanner:
    row = db.get(FoundationBanner, user_id)
    if row is not None:
        return row
    insert = postgres_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    db.execute(insert(FoundationBanner).values(user_id=user_id).on_conflict_do_nothing(
        index_elements=[FoundationBanner.user_id]
    ))
    return db.get(FoundationBanner, user_id)


def _active_account(user_id: str, account_id: int):
    return exists().where(User.id == user_id, User.status == "ACTIVE", User.account_id == account_id)


def claim_refresh(db: Session, user_id: str, account_id: int, now: datetime) -> bool:
    if db.scalar(select(exists().where(FoundationBanner.provider_pause_until > now))):
        return False
    if not db.scalar(select(_active_account(user_id, account_id))):
        return False
    ensure_banner_state(db, user_id)
    account_changed = or_(FoundationBanner.stat_account_id.is_(None), FoundationBanner.stat_account_id != account_id)
    claimed = db.execute(update(FoundationBanner).where(
        FoundationBanner.user_id == user_id,
        FoundationBanner.mode == "favorite_hero",
        or_(account_changed, and_(
            or_(FoundationBanner.next_refresh_at.is_(None), FoundationBanner.next_refresh_at <= now),
            or_(FoundationBanner.refresh_lease_until.is_(None), FoundationBanner.refresh_lease_until <= now),
        )),
    ).values(
        stat_account_id=account_id,
        hero_id=case((account_changed, None), else_=FoundationBanner.hero_id),
        hero_observed_at=case((account_changed, None), else_=FoundationBanner.hero_observed_at),
        consecutive_failures=case((account_changed, 0), else_=FoundationBanner.consecutive_failures),
        next_refresh_at=case((account_changed, None), else_=FoundationBanner.next_refresh_at),
        refresh_lease_until=now + REFRESH_LEASE,
    ).execution_options(synchronize_session=False)).rowcount
    db.commit()
    return bool(claimed)


def save_refresh(
    db: Session, user_id: str, account_id: int, started: datetime, *,
    hero_id: int | None = None, retry_after: int | None = None, failed: bool = False,
    completed: datetime | None = None,
) -> None:
    now = completed or started
    row = db.scalar(select(FoundationBanner).where(
        FoundationBanner.user_id == user_id, FoundationBanner.stat_account_id == account_id,
        FoundationBanner.refresh_lease_until == started + REFRESH_LEASE,
        _active_account(user_id, account_id),
    ).with_for_update().execution_options(populate_existing=True))
    if row is None:
        return
    if failed or retry_after is not None:
        row.consecutive_failures = min(row.consecutive_failures + 1, 6)
        delay = max(900 * 2 ** (row.consecutive_failures - 1), retry_after or 0)
        row.next_refresh_at = now + timedelta(seconds=min(delay, 6 * 3600) if retry_after is None else delay)
        if retry_after is not None:
            row.provider_pause_until = now + timedelta(seconds=retry_after)
    else:
        row.next_refresh_at = now + STAT_TTL
        row.consecutive_failures = 0
        if hero_id is not None:
            row.hero_id = hero_id
            row.hero_observed_at = now
    row.refresh_lease_until = None
    db.commit()


def refresh_in_background(
    factory: sessionmaker, user_id: str, account_id: int, started: datetime,
) -> None:
    try:
        with factory() as db:
            if not db.scalar(select(_active_account(user_id, account_id))):
                return
        try:
            with DeadlockApiProvider() as provider:
                hero_id = favorite_from_provider(provider, account_id, started)
        except ProviderRateLimited as error:
            result = {"retry_after": error.retry_after}
        except ProviderError:
            result = {"failed": True}
        else:
            result = {"hero_id": hero_id}
        with factory() as db:
            save_refresh(db, user_id, account_id, started, completed=utcnow(), **result)
    except Exception:
        # The lease expires after a crashed request or transient database failure.
        log.exception("Foundation banner refresh failed")
    finally:
        REFRESH_SLOTS.release()


def eligible_cards():
    return select(ArchiveCard).where(
        ArchiveCard.status == "PUBLISHED", ArchiveCard.banner_artwork.is_(True),
        ArchiveCard.rights_confirmed.is_(True), ArchiveCard.artist != "",
        ArchiveCard.hero.in_(HEROES), ArchiveCard.image_digest.is_not(None), ArchiveCard.image_data.is_not(None),
    )


def _owned_by(user_id: str):
    return exists().where(
        ArchiveItem.user_id == user_id, ArchiveItem.card_id == ArchiveCard.id,
        ArchiveItem.scope == "REAL", ArchiveItem.state == "OWNED", ArchiveItem.test_grant.is_(False),
    )


def rotated_card(cards: list[ArchiveCard], seed: str, day: date) -> ArchiveCard | None:
    # Identical bytes can be published under different designs or rarity levels.
    unique = {card.image_digest: card for card in sorted(cards, key=lambda card: card.id, reverse=True)}
    if not unique:
        return None
    options = sorted(unique.values(), key=lambda card: card.id)
    offset = int.from_bytes(sha256(seed.encode()).digest()[:8], byteorder="big")
    return options[(day.toordinal() + offset) % len(options)]


def banner_card(db: Session, user: User, row: FoundationBanner | None, now: datetime) -> ArchiveCard | None:
    mode = row.mode if row is not None else "favorite_hero"
    if mode == "off":
        return None
    cards = eligible_cards()
    if mode == "selected_card":
        return db.scalar(cards.where(ArchiveCard.id == row.selected_card_id))
    if mode == "collection":
        cards = cards.where(_owned_by(user.id))
    day = now.date()
    if row is not None and row.daily_date == day and row.daily_card_id is not None and (
        mode != "favorite_hero" or row.daily_account_id == user.account_id
    ):
        pinned = db.scalar(cards.where(ArchiveCard.id == row.daily_card_id))
        if pinned is not None:
            return pinned
    seed = f"{user.id}:{mode}"
    if mode == "favorite_hero":
        if user.account_id is None:
            return None
        hero_id = None
        if row is not None and row.stat_account_id == user.account_id and row.hero_observed_at is not None:
            if aware(row.hero_observed_at) + STALE_TTL > now:
                hero_id = row.hero_id
        hero = HERO_KEYS.get(hero_id or _local_hero(db, user.account_id))
        if hero is None:
            return None
        cards = cards.where(ArchiveCard.hero == hero)
        seed += ":" + hero
    chosen = rotated_card(list(db.scalars(cards)), seed, day)
    if chosen is None:
        return None
    row = ensure_banner_state(db, user.id)
    pinned_id = row.daily_card_id
    result = db.execute(update(FoundationBanner).where(
        FoundationBanner.user_id == user.id, FoundationBanner.mode == mode,
        FoundationBanner.daily_date.is_not_distinct_from(row.daily_date),
        FoundationBanner.daily_card_id.is_not_distinct_from(pinned_id),
    ).values(daily_card_id=chosen.id, daily_date=day, daily_account_id=user.account_id)
    .execution_options(synchronize_session=False)).rowcount
    # The caller may still use its already loaded row to schedule a refresh.
    db.commit()
    if result:
        return chosen
    current = db.get(FoundationBanner, user.id, populate_existing=True)
    if (
        current is not None and current.mode == mode and current.daily_date == day
        and current.daily_card_id is not None and current.daily_account_id == user.account_id
    ):
        return db.scalar(cards.where(ArchiveCard.id == current.daily_card_id))
    return None
