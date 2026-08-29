from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

from app.config import settings
from app.services.companion import (
    select_primary_device,
    serialize_device,
    utcnow,
)


def _device(
    *,
    last_seen_at,
    game_running: bool,
    revoked_at=None,
    label: str = "Deadlock Contracts Desktop",
):
    return SimpleNamespace(
        revoked_at=revoked_at,
        last_seen_at=last_seen_at,
        game_running=game_running,
        phase="GameInProgress" if game_running else None,
        game_match_mode="STREET_BRAWL" if game_running else None,
        current_match_id=123456789 if game_running else None,
        identity_ok=True,
        version="0.5.2-alpha.14",
        gep_version="312.1.0",
        label=label,
    )


def test_primary_device_prefers_fresh_running_companion() -> None:
    now = utcnow()

    # This is the bug: a slightly newer idle Companion heartbeat used to mask
    # another fresh Companion which correctly reported Deadlock as running.
    newer_idle = _device(
        last_seen_at=now - timedelta(seconds=1),
        game_running=False,
        label="newer-idle",
    )
    running = _device(
        last_seen_at=now - timedelta(seconds=5),
        game_running=True,
        label="running",
    )
    stale_running = _device(
        last_seen_at=now
        - timedelta(
            seconds=settings.companion_online_seconds + 30
        ),
        game_running=True,
        label="stale-running",
    )
    revoked_running = _device(
        last_seen_at=now,
        game_running=True,
        revoked_at=now,
        label="revoked-running",
    )

    primary = select_primary_device(
        [
            newer_idle,
            stale_running,
            revoked_running,
            running,
        ]
    )
    assert primary is running

    status = serialize_device(primary)
    assert status["online"] is True
    assert status["game_running"] is True
    assert status["phase"] == "GameInProgress"
    assert status["current_match_id"] == "123456789"

    # Never resurrect stale "running" state.
    assert serialize_device(stale_running)["online"] is False
    assert serialize_device(stale_running)["game_running"] is False

    # If no fresh running device exists, use the freshest online device.
    assert (
        select_primary_device([stale_running, newer_idle])
        is newer_idle
    )

    # Revoked-only accounts have no primary device.
    assert select_primary_device([revoked_running]) is None
