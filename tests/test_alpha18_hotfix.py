from __future__ import annotations

import inspect
from contextlib import contextmanager
from types import SimpleNamespace

from app.config import settings
from app.services import companion as companion_service
from app.worker import handle_resolve_companion_match_auto


STEAM_ID = 76561198697183120


@contextmanager
def rollout(*, enabled: bool, allow_all: bool, allowlist: tuple[str, ...]):
    old = {
        "gep_settlement_enabled": settings.gep_settlement_enabled,
        "gep_settlement_allow_all": settings.gep_settlement_allow_all,
        "gep_settlement_allowlist": settings.gep_settlement_allowlist,
    }
    object.__setattr__(settings, "gep_settlement_enabled", enabled)
    object.__setattr__(settings, "gep_settlement_allow_all", allow_all)
    object.__setattr__(settings, "gep_settlement_allowlist", allowlist)
    try:
        yield
    finally:
        for key, value in old.items():
            object.__setattr__(settings, key, value)


def test_alpha18_managed_device_suppresses_legacy_direct_resolver():
    device = SimpleNamespace(version="0.5.2-alpha.18")
    user = SimpleNamespace(steam_id64=STEAM_ID)

    with rollout(
        enabled=True,
        allow_all=False,
        allowlist=(str(STEAM_ID),),
    ):
        assert companion_service._gep_managed_direct_settlement(
            device,
            user,
        )

    source = inspect.getsource(
        companion_service._register_direct_match_job
    )
    assert "_gep_managed_direct_settlement" in source


def test_unmanaged_or_legacy_device_keeps_legacy_fallback_available():
    user = SimpleNamespace(steam_id64=STEAM_ID)

    with rollout(
        enabled=True,
        allow_all=False,
        allowlist=(str(STEAM_ID),),
    ):
        assert not companion_service._gep_managed_direct_settlement(
            SimpleNamespace(version="0.5.2-alpha.16"),
            user,
        )

    with rollout(
        enabled=True,
        allow_all=False,
        allowlist=("76561190000000000",),
    ):
        assert not companion_service._gep_managed_direct_settlement(
            SimpleNamespace(version="0.5.2-alpha.18"),
            user,
        )


def test_legacy_resolver_handler_has_client_attested_gep_short_circuit():
    source = inspect.getsource(handle_resolve_companion_match_auto)

    assert "GEP_SETTLEMENT_SOURCE" in source
    assert "GEP_INTEGRITY_CLIENT_ATTESTED" in source
    assert "Skipping legacy Companion resolver" in source
