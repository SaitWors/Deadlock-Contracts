from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from ..config import settings

STEAM_ID64_BASE = 76561197960265728


def _pick(mapping: dict[str, Any] | None, *keys: str) -> Any:
    if not mapping:
        return None
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]
    return None


def _coalesce(*values: Any) -> Any:
    """Return the first value that is not None/empty while preserving valid zeroes."""
    for value in values:
        if value is not None and value != "":
            return value
    return None


def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _bounded_int(value: Any, minimum: int, maximum: int) -> int | None:
    parsed = _to_int(value)
    if parsed is None or parsed < minimum or parsed > maximum:
        return None
    return parsed


def _to_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "win", "won", "victory"}:
        return True
    if text in {"false", "0", "no", "loss", "lost", "defeat"}:
        return False
    return None


def _to_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        number = float(value)
        if number > 10_000_000_000:
            number /= 1000
        try:
            return datetime.fromtimestamp(number, tz=timezone.utc)
        except (ValueError, OSError, OverflowError):
            return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _walk_dicts(value: Any):
    """Bounded traversal of provider JSON, prioritising useful match/player branches.

    Detailed Deadlock metadata can contain enormous damage matrices. The old
    generic DFS could exhaust its 50k-node budget before reaching players[].
    We skip known irrelevant heavy branches and prioritise player/match data.
    """

    PRIORITY_KEYS = {
        "players",
        "player",
        "match_info",
        "match",
        "metadata",
        "data",
        "match_metadata",
    }

    # These branches can contain tens of thousands of objects but are not
    # needed to identify the requested player. Note: stats is intentionally
    # not traversed because _find_player reads candidate["stats"] directly.
    SKIP_KEYS = {
        "stats",
        "damage_matrix",
        "damage_sources",
        "damage_to_players",
        "source_details",
        "custom_user_stats",
        "death_details",
        "watched_death_replays",
        "match_tracked_stats",
        "team_tracked_stats",
    }

    stack: list[tuple[Any, int]] = [(value, 0)]
    visited = 0
    max_visited = 200_000

    while stack and visited < max_visited:
        current, depth = stack.pop()
        visited += 1

        if isinstance(current, dict):
            yield current

            if depth >= 16:
                continue

            low_priority = []
            high_priority = []

            for key, child in current.items():
                if key in SKIP_KEYS:
                    continue

                item = (child, depth + 1)

                if key in PRIORITY_KEYS:
                    high_priority.append(item)
                else:
                    low_priority.append(item)

            # LIFO: priority branches must be appended last.
            stack.extend(low_priority)
            stack.extend(high_priority)

        elif isinstance(current, list):
            if depth >= 16:
                continue

            # Preserve natural list order under LIFO.
            for child in reversed(current):
                stack.append((child, depth + 1))


def _find_player(metadata: dict[str, Any] | None, account_id: int) -> dict[str, Any] | None:
    """Find the richest representation of the requested player.

    Deadlock metadata may contain several objects for the same account:
    compact summary objects as well as the detailed player object carrying
    stats[]. Prefer detailed stats instead of returning the first match.
    """
    if not metadata:
        return None

    best: dict[str, Any] | None = None
    best_score = -1

    for candidate in _walk_dicts(metadata):
        candidate_account = _to_int(
            _pick(candidate, "account_id", "accountId", "player_account_id")
        )
        candidate_steam = _to_int(
            _pick(candidate, "steam_id", "steam_id64", "steamId")
        )

        identity_matches = (
            candidate_account == account_id
            or (
                candidate_steam is not None
                and candidate_steam - STEAM_ID64_BASE == account_id
            )
        )

        if not identity_matches:
            continue

        score = 0

        stats = candidate.get("stats")
        if isinstance(stats, list) and any(isinstance(x, dict) for x in stats):
            # The detailed metadata object is by far the most valuable one.
            score += 1000
            score += min(len(stats), 100)

            latest = _latest_stats_snapshot(candidate)
            if latest.get("player_damage") is not None:
                score += 200
            if latest.get("teammate_healing") is not None:
                score += 200
            if latest.get("player_healing") is not None:
                score += 50

        stat_keys = {
            "kills",
            "player_kills",
            "deaths",
            "player_deaths",
            "assists",
            "player_assists",
            "net_worth",
            "networth",
        }

        score += 10 * len(stat_keys.intersection(candidate.keys()))

        if candidate.get("hero_id") is not None:
            score += 5
        if candidate.get("player_team") is not None or candidate.get("team") is not None:
            score += 5

        if score > best_score:
            best = candidate
            best_score = score

    return best


def _looks_like_street_brawl(payload: Any) -> bool:
    """Return True only for strong Street Brawl post-match markers.

    Valve metadata can expose the ``street_brawl_rounds`` key for more than one
    mode, so the key alone is not sufficient: the rounds list must be non-empty.
    History-specific brawl score fields are also treated as strong evidence.
    """
    if not payload:
        return False
    for candidate in _walk_dicts(payload):
        rounds = candidate.get("street_brawl_rounds")
        if isinstance(rounds, list) and len(rounds) > 0:
            return True
        if any(candidate.get(key) not in (None, "") for key in ("brawl_score_team0", "brawl_score_team1", "brawl_avg_round_time_s")):
            return True
    return False


def _latest_stats_snapshot(player: dict[str, Any] | None) -> dict[str, Any]:
    if not player:
        return {}
    stats = player.get("stats")
    if not isinstance(stats, list):
        return {}
    candidates = [item for item in stats if isinstance(item, dict)]
    if not candidates:
        return {}
    return max(candidates, key=lambda item: _to_int(item.get("time_stamp_s")) or -1)


def classify_mode(
    match_mode: Any,
    game_mode: Any = None,
    fallback_match_mode: Any = None,
    fallback_game_mode: Any = None,
) -> tuple[str, str, str]:
    """Map provider mode fields without silently treating unknown modes as Standard.

    Numeric mappings below are production-observed Deadlock API payloads:
    * match_mode=1 + game_mode=1 -> STANDARD
    * match_mode=4 + game_mode=1 -> RANKED
    * match_mode=1 + game_mode=4 -> STREET_BRAWL

    Unknown pairs remain UNKNOWN and may be upgraded later by strong semantic
    post-match markers such as a non-empty ``street_brawl_rounds`` list.
    """
    resolved_match_mode = _coalesce(match_mode, fallback_match_mode)
    resolved_game_mode = _coalesce(game_mode, fallback_game_mode)
    raw_parts = []
    if resolved_match_mode not in (None, ""):
        raw_parts.append(f"match_mode={resolved_match_mode}")
    if resolved_game_mode not in (None, ""):
        raw_parts.append(f"game_mode={resolved_game_mode}")
    raw = ", ".join(raw_parts)

    match_mode_int = _to_int(resolved_match_mode)
    game_mode_int = _to_int(resolved_game_mode)
    if match_mode_int is not None or game_mode_int is not None:
        # Exact mode: do not infer from only one numeric dimension.
        if match_mode_int == 1 and game_mode_int == 1:
            return "STANDARD", raw, "HIGH"
        if match_mode_int in {4, 8} and game_mode_int == 1:
            return "RANKED", raw, "HIGH"
        if match_mode_int == 1 and game_mode_int == 4:
            return "STREET_BRAWL", raw, "HIGH"
        return "UNKNOWN", raw, "LOW"

    match_text = str(resolved_match_mode or "").strip().lower()
    game_text = str(resolved_game_mode or "").strip().lower()
    if any(token in match_text for token in ("street brawl", "street_brawl", "streetbrawl", "brawl")) or any(token in game_text for token in ("street brawl", "street_brawl", "streetbrawl", "brawl")):
        return "STREET_BRAWL", raw or "street_brawl", "HIGH"
    game_is_normal = not game_text or any(token in game_text for token in ("normal", "standard"))
    match_is_unranked = any(token in match_text for token in ("unranked", "standard"))
    match_is_ranked = any(token in match_text for token in ("ranked", "competitive", "calibration")) and not match_is_unranked

    if match_is_unranked and game_is_normal:
        return "STANDARD", raw or "match_mode=unranked", "HIGH"
    if match_is_ranked and game_is_normal:
        return "RANKED", raw or "match_mode=ranked", "HIGH"
    # Compatibility for a source that exposes only a textual game mode.
    if not match_text and game_is_normal and game_text:
        return "STANDARD", raw, "MEDIUM"
    return "UNKNOWN", raw, "LOW"


def normalize_deadlock_match(
    account_id: int,
    history: dict[str, Any],
    metadata: dict[str, Any] | None,
) -> dict[str, Any]:
    player = _find_player(metadata, account_id) or history
    root = metadata or history
    match_id = _to_int(
        _coalesce(
            _pick(history, "match_id", "matchId"),
            _pick(root, "match_id", "matchId"),
        )
    )
    if match_id is None:
        raise ValueError("Provider response has no match_id")

    duration_s = _bounded_int(
        _coalesce(
            _pick(history, "match_duration_s", "duration_s", "duration"),
            _pick(root, "match_duration_s", "duration_s", "duration"),
        ),
        0,
        6 * 60 * 60,
    )
    started_at = _to_datetime(
        _coalesce(
            _pick(history, "start_time", "startTime", "started_at"),
            _pick(root, "start_time", "startTime", "started_at"),
        )
    )
    ended_at = started_at + timedelta(seconds=duration_s) if started_at and duration_s is not None else None
    mode, mode_raw, confidence = classify_mode(
        _pick(history, "match_mode", "matchMode"),
        _pick(history, "game_mode", "gameMode"),
        _pick(root, "match_mode", "matchMode"),
        _pick(root, "game_mode", "gameMode"),
    )
    # Semantic safety net for future enum changes. A non-empty rounds list or
    # brawl score fields are stronger evidence than an otherwise unknown pair.
    if mode == "UNKNOWN" and (_looks_like_street_brawl(history) or _looks_like_street_brawl(metadata)):
        mode = "STREET_BRAWL"
        mode_raw = (mode_raw + ("; " if mode_raw else "") + "street_brawl_marker")[:128]
        confidence = "HIGH"

    player_team = _to_int(_pick(player, "player_team", "team", "team_id"))
    latest_stats = _latest_stats_snapshot(player)
    match_result = _coalesce(
        _pick(history, "match_result", "result"),
        _pick(root, "match_result", "result"),
    )
    outcome_raw = _coalesce(
        _pick(history, "player_match_outcome", "playerMatchOutcome"),
        _pick(player, "player_match_outcome", "playerMatchOutcome"),
        _pick(root, "player_match_outcome", "playerMatchOutcome"),
    )
    outcome = _to_int(outcome_raw)

    won: bool | None
    scoring_status = "SCORED"
    if outcome_raw is not None:
        if outcome == 1:
            won = True
        elif outcome == 2:
            won = False
        else:
            won = None
            scoring_status = {
                0: "INVALID",
                3: "PENALIZED",
                4: "PENALIZED_PARTY",
                5: "NOT_SCORED",
            }.get(outcome, "UNKNOWN")
    else:
        # Legacy/provider fallback when the explicit outcome field is absent.
        won = _to_bool(_pick(player, "won", "is_winner"))
        if won is None:
            result_int = _to_int(match_result)
            if result_int is not None and player_team is not None:
                won = result_int == player_team
        if won is None and isinstance(match_result, str):
            won = _to_bool(match_result)

    participant = {
        "account_id": account_id,
        "steam_id64": account_id + STEAM_ID64_BASE,
        "hero_id": _bounded_int(
            _coalesce(
                _pick(player, "hero_id", "heroId"),
                _pick(history, "hero_id", "heroId"),
            ),
            0,
            10_000,
        ),
        "team": _bounded_int(player_team, 0, 16),
        "won": won,
        "kills": _bounded_int(
            _coalesce(_pick(player, "kills", "player_kills"), _pick(history, "player_kills", "kills")),
            0,
            500,
        ),
        "deaths": _bounded_int(
            _coalesce(_pick(player, "deaths", "player_deaths"), _pick(history, "player_deaths", "deaths")),
            0,
            500,
        ),
        "assists": _bounded_int(
            _coalesce(_pick(player, "assists", "player_assists"), _pick(history, "player_assists", "assists")),
            0,
            1_000,
        ),
        "net_worth": _bounded_int(
            _coalesce(_pick(player, "net_worth", "networth"), _pick(history, "net_worth", "networth")),
            0,
            10_000_000,
        ),
        "hero_damage": _bounded_int(
            _coalesce(
                _pick(player, "hero_damage", "player_damage", "damage_to_players"),
                _pick(latest_stats, "player_damage", "hero_damage"),
            ),
            0,
            100_000_000,
        ),
        "object_damage": _bounded_int(_pick(player, "object_damage", "objective_damage", "damage_to_objects"), 0, 100_000_000),
        "healing": _bounded_int(
            _coalesce(
                # Contract means healing teammates. A real zero must remain
                # zero and must not fall through to self/player healing.
                _pick(player, "teammate_healing"),
                _pick(latest_stats, "teammate_healing"),
                _pick(player, "hero_healing", "healing"),
                _pick(latest_stats, "hero_healing", "healing"),
            ),
            0,
            100_000_000,
        ),
    }
    capability_fields = {
        "summary.result": participant["won"],
        "summary.kills": participant["kills"],
        "summary.deaths": participant["deaths"],
        "summary.assists": participant["assists"],
        "summary.net_worth": participant["net_worth"],
        "summary.hero_damage": participant["hero_damage"],
        "summary.object_damage": participant["object_damage"],
        "summary.healing": participant["healing"],
        "summary.duration": duration_s,
    }
    capabilities = [name for name, value in capability_fields.items() if value is not None]
    hash_source = {"history": history, "metadata": metadata}
    payload_hash = hashlib.sha256(json.dumps(hash_source, sort_keys=True, default=str).encode()).hexdigest()
    # Keep only the queried player's relevant evidence when explicitly enabled;
    # never retain the entire roster by default.
    raw_summary = {"history": history, "player": player} if settings.store_provider_raw else None
    final_raw = _pick(root, "is_final", "isFinal", "final")
    is_final = _to_bool(final_raw) if final_raw is not None else True
    return {
        "external_match_id": match_id,
        "provider": "deadlock_api",
        "provider_payload_hash": payload_hash,
        "started_at": started_at,
        "ended_at": ended_at,
        "duration_s": duration_s,
        "game_match_mode": mode,
        "provider_mode_raw": mode_raw,
        "mode_classifier_version": settings.mode_classifier_version,
        "mode_confidence": confidence,
        "scoring_status": scoring_status,
        "game_version": (str(_pick(root, "game_version", "build_id", "version") or "")[:64] or None),
        "is_final": bool(is_final),
        "capabilities": capabilities,
        "raw_summary": raw_summary,
        "participant": participant,
    }

