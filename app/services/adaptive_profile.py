from __future__ import annotations

from statistics import median
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Match, MatchParticipant, User

PROFILE_VERSION = "adaptive-profile-1"
PROFILE_MATCH_LIMIT = 20
MIN_PERSONALIZATION_MATCHES = 5


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    rows = sorted(float(value) for value in values)
    if len(rows) == 1:
        return rows[0]
    point = max(0.0, min(1.0, q)) * (len(rows) - 1)
    lo = int(point)
    hi = min(len(rows) - 1, lo + 1)
    weight = point - lo
    return rows[lo] * (1.0 - weight) + rows[hi] * weight


def _metric_values(match: Match, participant: MatchParticipant) -> dict[str, float | None]:
    kda = None
    if participant.kills is not None and participant.deaths is not None and participant.assists is not None:
        kda = (participant.kills + participant.assists) / max(1, participant.deaths)
    return {
        "player.kills": float(participant.kills) if participant.kills is not None else None,
        "player.deaths": float(participant.deaths) if participant.deaths is not None else None,
        "player.assists": float(participant.assists) if participant.assists is not None else None,
        "player.kda": float(kda) if kda is not None else None,
        "player.net_worth.final": float(participant.net_worth) if participant.net_worth is not None else None,
        "player.hero_damage": float(participant.hero_damage) if participant.hero_damage is not None else None,
        "player.object_damage": float(participant.object_damage) if participant.object_damage is not None else None,
        "player.healing": float(participant.healing) if participant.healing is not None else None,
        "player.scoreboard_healing": float(participant.healing) if participant.healing is not None else None,
        "match.duration_s": float(match.duration_s) if match.duration_s is not None else None,
        "match.win": 1.0 if participant.won is True else (0.0 if participant.won is False else None),
    }


def _confidence(sample_size: int) -> str:
    if sample_size < MIN_PERSONALIZATION_MATCHES:
        return "COLD_START"
    if sample_size < 10:
        return "LOW"
    if sample_size < 15:
        return "MEDIUM"
    return "HIGH"


def build_adaptive_profile(
    db: Session,
    user: User,
    mode: str,
    *,
    limit: int = PROFILE_MATCH_LIMIT,
) -> dict[str, Any]:
    if user.account_id is None:
        return {
            "version": PROFILE_VERSION,
            "mode": mode,
            "sample_size": 0,
            "confidence": "COLD_START",
            "metrics": {},
        }

    rows = list(
        db.execute(
            select(Match, MatchParticipant)
            .join(MatchParticipant, MatchParticipant.match_id == Match.id)
            .where(
                MatchParticipant.account_id == int(user.account_id),
                Match.game_match_mode == mode,
                Match.is_final.is_(True),
                Match.scoring_status == "SCORED",
            )
            .order_by(Match.started_at.desc().nullslast(), Match.created_at.desc())
            .limit(max(1, min(50, int(limit))))
        ).all()
    )

    buckets: dict[str, list[float]] = {}
    for match, participant in rows:
        for metric, value in _metric_values(match, participant).items():
            if value is not None:
                buckets.setdefault(metric, []).append(value)

    metrics: dict[str, dict[str, float | int]] = {}
    for metric, values in buckets.items():
        if not values:
            continue
        metrics[metric] = {
            "n": len(values),
            "median": round(float(median(values)), 3),
            "p25": round(float(_percentile(values, 0.25) or 0.0), 3),
            "p60": round(float(_percentile(values, 0.60) or 0.0), 3),
            "p75": round(float(_percentile(values, 0.75) or 0.0), 3),
            "best": round(float(min(values) if metric == "player.deaths" else max(values)), 3),
        }

    return {
        "version": PROFILE_VERSION,
        "mode": mode,
        "sample_size": len(rows),
        "confidence": _confidence(len(rows)),
        "metrics": metrics,
    }
