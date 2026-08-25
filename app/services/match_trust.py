from __future__ import annotations


_CLIENT_PROVIDER_NAMES = {
    "companion",
    "gep",
    "gep_fallback",
    "overwolf_gep",
}


def provider_parts(value: str | None) -> list[str]:
    """Return stable, de-duplicated labels from a merged provider value."""

    parts: list[str] = []
    for raw in str(value or "").split("+"):
        part = raw.strip().lower()
        if part and part != "unknown" and part not in parts:
            parts.append(part)
    return parts


def is_client_provider_part(value: str) -> bool:
    part = str(value or "").strip().lower()
    return (
        part in _CLIENT_PROVIDER_NAMES
        or part.startswith("gep_")
        or part.startswith("overwolf_gep_")
        or part.startswith("companion_")
    )


def provider_has_client_source(value: str | None) -> bool:
    return any(is_client_provider_part(part) for part in provider_parts(value))


def provider_has_independent_source(value: str | None) -> bool:
    return any(not is_client_provider_part(part) for part in provider_parts(value))


def independent_provider_parts(value: str | None) -> list[str]:
    return [part for part in provider_parts(value) if not is_client_provider_part(part)]
