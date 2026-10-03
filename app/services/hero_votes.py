"""Read-only, cached community polls. These are never Valve vote totals."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import delete, or_, select, update

from ..models import HeroVoteCampaign, HeroVoteSnapshot, HeroVoteSource, utcnow, uuid4

INTERVAL = timedelta(minutes=10)
STALE_AFTER = timedelta(minutes=25)
PROVIDERS = {
    "deadlock_labs": {
        "name": "Deadlock Labs", "kind": "COMMUNITY_POLL",
        "url": "https://deadlocklabs.gg/updates/city-never-sleeps/",
        "endpoint": "https://deadlocklabs.gg/api/backend/v1/hero-votes",
    },
    "statlocker": {
        "name": "Statlocker", "kind": "RELEASE_PREDICTIONS",
        "url": "https://statlocker.gg/cns-sweep/predict",
        "endpoint": "https://statlocker.gg/api/cns-predict/community",
    },
}
PRESET = [
    {"hero_id": 85, "name_ru": "Соломон", "name_en": "Solomon", "released": False},
    {"hero_id": 88, "name_ru": "Баба", "name_en": "Baba", "released": False},
    {"hero_id": 78, "name_ru": "Мертвец Дэнни", "name_en": "Deadman Danny", "released": False},
    {"hero_id": 86, "name_ru": "Вайолет", "name_en": "Violet", "released": False},
    {"hero_id": 87, "name_ru": "Медсестра Харроу", "name_en": "Nurse Harrow", "released": False},
    {"hero_id": 84, "name_ru": "Крысиный король", "name_en": "Rat King", "released": True},
]


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def stamp(value: datetime | None) -> str | None:
    return aware(value).isoformat() if value else None


def is_live(campaign: HeroVoteCampaign, now: datetime) -> bool:
    return bool(campaign.active_slot and campaign.visible and not campaign.ended_at
        and (not campaign.starts_at or aware(campaign.starts_at) <= now)
        and (not campaign.ends_at or now < aware(campaign.ends_at)))


def parse_labs(payload: object, candidates: list[dict]) -> dict[str, int]:
    if not isinstance(payload, dict) or not isinstance(payload.get("counts"), dict):
        raise ValueError("Invalid counts")
    counts = payload["counts"]
    # An exact mapping prevents attaching an old/different poll to a new campaign.
    if set(counts) != {str(item["hero_id"]) for item in candidates}:
        raise ValueError("Candidate mapping changed")
    if any(type(value) is not int or not 0 <= value <= 10**12 for value in counts.values()):
        raise ValueError("Invalid vote count")
    return dict(counts)


def standings(counts: dict[str, int], candidates: list[dict]) -> dict:
    total = sum(counts.values())
    rows = [{**item, "votes": counts[str(item["hero_id"])],
        "percent": round(counts[str(item["hero_id"])] * 100 / total, 2) if total else 0}
        for item in candidates]
    rows.sort(key=lambda item: (item["released"], -item["votes"], item["hero_id"]))
    eligible = [item for item in rows if not item["released"]]
    top = eligible[0]["votes"] if eligible else 0
    leaders = [item["hero_id"] for item in eligible if item["votes"] == top] if top else []
    gap = top - eligible[1]["votes"] if len(eligible) > 1 else None
    return {"total_votes": total, "rows": rows, "leader_ids": leaders,
        "gap_votes": gap if top else None,
        "gap_percent": round(gap * 100 / total, 2) if top and gap is not None else None}


def source_payload(db, source: HeroVoteSource, campaign: HeroVoteCampaign, now: datetime) -> dict:
    info = PROVIDERS[source.provider]
    observations = db.scalars(select(HeroVoteSnapshot).where(HeroVoteSnapshot.source_id == source.id)
        .order_by(HeroVoteSnapshot.observed_at.desc(), HeroVoteSnapshot.id.desc()).limit(2)).all()
    latest = observations[0] if observations else None
    result = {"provider": source.provider, "name": info["name"], "kind": info["kind"],
        "url": info["url"], "enabled": source.enabled, "status": source.status,
        "last_attempt_at": stamp(source.last_attempt_at), "updated_at": stamp(source.last_success_at),
        "next_refresh_at": stamp(source.next_refresh_at),
        "stale": bool(latest and (source.status != "OK" or now - aware(latest.observed_at) > STALE_AFTER)),
        "result": standings(latest.counts, campaign.candidates) if latest else None, "change": None}
    if len(observations) == 2:
        previous = standings(observations[1].counts, campaign.candidates)
        current = result["result"]
        result["change"] = {"since": stamp(observations[1].observed_at),
            "leader_changed": current["leader_ids"] != previous["leader_ids"],
            "previous_leader_ids": previous["leader_ids"],
            "votes_delta": current["total_votes"] - previous["total_votes"],
            "gap_delta": current["gap_votes"] - previous["gap_votes"]
                if current["gap_votes"] is not None and previous["gap_votes"] is not None else None}
    return result


def campaign_payload(db, campaign: HeroVoteCampaign, *, admin=False, now=None) -> dict:
    now = now or utcnow()
    sources = db.scalars(select(HeroVoteSource).where(HeroVoteSource.campaign_id == campaign.id)
        .order_by(HeroVoteSource.provider)).all()
    result = {"id": campaign.id, "title_ru": campaign.title_ru, "title_en": campaign.title_en,
        "candidates": campaign.candidates, "starts_at": stamp(campaign.starts_at), "ends_at": stamp(campaign.ends_at),
        "sources": [source_payload(db, source, campaign, now) for source in sources]}
    if admin:
        result.update(revision=campaign.revision, visible=campaign.visible, active=bool(campaign.active_slot),
            ended_at=stamp(campaign.ended_at), live=is_live(campaign, now), created_at=stamp(campaign.created_at))
    return result


def public_payload(db) -> dict:
    now = utcnow()
    campaign = db.scalar(select(HeroVoteCampaign).where(HeroVoteCampaign.active_slot == "CURRENT"))
    return {"enabled": bool(campaign and is_live(campaign, now)), "server_time": stamp(now),
        "refresh_seconds": 60, "poll_interval_seconds": int(INTERVAL.total_seconds()),
        "campaign": campaign_payload(db, campaign, now=now) if campaign and is_live(campaign, now) else None}


def fetch_counts(provider: str, candidates: list[dict], client: httpx.Client) -> tuple[str, dict | None]:
    # Only fixed, reviewed HTTPS GET URLs; never receive user URLs or Steam credentials.
    try:
        with client.stream("GET", PROVIDERS[provider]["endpoint"]) as response:
            if provider == "statlocker" and response.status_code in (401, 403):
                return "AUTH_REQUIRED", None
            response.raise_for_status()
            content = bytearray()
            for block in response.iter_bytes():
                content.extend(block)
                if len(content) > 64 * 1024:
                    return "INVALID_DATA", None
        if provider == "statlocker":
            # Its prediction schema is not a vote tally, even if it becomes public.
            return "UNSUPPORTED", None
        return "OK", parse_labs(json.loads(content), candidates)
    except (ValueError, TypeError, KeyError):
        return "INVALID_DATA", None
    except httpx.HTTPError:
        return "UNAVAILABLE", None


def maintenance(factory, *, client=None, now=None) -> int:
    fixed_clock = now is not None
    now = now or utcnow()
    with factory() as db:
        campaign = db.scalar(select(HeroVoteCampaign).where(HeroVoteCampaign.active_slot == "CURRENT"))
        if not campaign or not is_live(campaign, now):
            return 0
        campaign_id, revision, candidates = campaign.id, campaign.revision, campaign.candidates
        ids = list(db.scalars(select(HeroVoteSource.id).where(HeroVoteSource.campaign_id == campaign_id,
            HeroVoteSource.enabled.is_(True), HeroVoteSource.next_refresh_at <= now)))
    own_client = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(8, connect=3), follow_redirects=False,
        headers={"User-Agent": "Deadlock-Contracts/community-polls", "Accept": "application/json"})
    refreshed = 0
    try:
        for source_id in ids:
            token = uuid4()
            with factory() as db:
                claimed = db.execute(update(HeroVoteSource).where(HeroVoteSource.id == source_id,
                    HeroVoteSource.enabled.is_(True), HeroVoteSource.next_refresh_at <= now,
                    or_(HeroVoteSource.lease_until.is_(None), HeroVoteSource.lease_until <= now))
                    .values(lease_token=token, lease_until=now + timedelta(seconds=45),
                        last_attempt_at=now, next_refresh_at=now + INTERVAL)).rowcount
                db.commit()
                if not claimed:
                    continue
                provider = db.get(HeroVoteSource, source_id).provider
            status, counts = fetch_counts(provider, candidates, client)
            observed_at = now if fixed_clock else utcnow()
            with factory() as db:
                campaign = db.get(HeroVoteCampaign, campaign_id)
                source = db.scalar(select(HeroVoteSource).where(HeroVoteSource.id == source_id,
                    HeroVoteSource.lease_token == token).with_for_update())
                if not source:
                    continue
                source.lease_token, source.lease_until = None, None
                # A hide/end/edit made during the network call invalidates this response.
                if not campaign or campaign.revision != revision or not source.enabled or not is_live(campaign, observed_at):
                    db.commit()
                    continue
                source.status = status
                if counts is not None:
                    source.last_success_at = observed_at
                    db.add(HeroVoteSnapshot(source_id=source_id, counts=counts, observed_at=observed_at))
                    # Keep a month of observations and the previous good result after outages.
                    keep = select(HeroVoteSnapshot.id).where(HeroVoteSnapshot.source_id == source_id)
                    keep = keep.order_by(HeroVoteSnapshot.observed_at.desc()).limit(2)
                    db.execute(delete(HeroVoteSnapshot).where(HeroVoteSnapshot.source_id == source_id,
                        HeroVoteSnapshot.observed_at < now - timedelta(days=30), HeroVoteSnapshot.id.not_in(keep)))
                db.commit()
                refreshed += 1
    finally:
        if own_client:
            client.close()
    return refreshed
