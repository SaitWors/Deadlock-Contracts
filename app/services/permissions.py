from __future__ import annotations

"""Role -> permission policy for Deadlock Contracts staff access.

OWNER is still derived outside this module from the protected server-side
SteamID allowlist. This module only answers what an already-resolved role may do.
"""

ALL_PERMISSIONS = frozenset(
    {
        "admin.access",
        "admin.overview.read",
        "users.read",
        "users.manage_status",
        "users.manage_identity",
        "users.adjust_xp",
        "reviews.read",
        "reviews.claim",
        "reviews.decide",
        "matches.read",
        "boards.read",
        "companions.read",
        "companions.revoke",
        "missions.read",
        "missions.edit",
        "missions.publish",
        "generator.preview",
        "jobs.read",
        "jobs.retry",
        "outbox.read",
        "outbox.replay",
        "audit.read",
        "system.read",
        "announcements.read",
        "announcements.drafts.manage",
        "announcements.publish",
        "announcements.cancel",
        "announcements.metrics.read",
        "telegram.bind_self",
        "telegram.bindings.manage",
        "telegram.test",
    }
)

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "OWNER": ALL_PERMISSIONS,
    "ADMIN": frozenset(
        {
            "admin.access",
            "admin.overview.read",
            "users.read",
            "reviews.read",
            "reviews.claim",
            "reviews.decide",
            "matches.read",
            "boards.read",
            "companions.read",
            "companions.revoke",
            "missions.read",
            "generator.preview",
            "jobs.read",
            "jobs.retry",
            "outbox.read",
            "outbox.replay",
            "audit.read",
            "system.read",
            "announcements.read",
            "announcements.drafts.manage",
            "announcements.metrics.read",
            "telegram.bind_self",
            "telegram.test",
        }
    ),
    "MODERATOR": frozenset(
        {
            "admin.access",
            "reviews.read",
            "reviews.claim",
            "reviews.decide",
            "telegram.bind_self",
        }
    ),
    "TESTER": frozenset(),
    "PLAYER": frozenset(),
}


def normalize_role(role: str | None) -> str:
    value = str(role or "PLAYER").strip().upper()
    return value if value in ROLE_PERMISSIONS else "PLAYER"


def permissions_for_role(role: str | None) -> list[str]:
    """Stable, JSON-friendly sorted permission list."""
    return sorted(ROLE_PERMISSIONS[normalize_role(role)])


def role_has_permission(role: str | None, permission: str) -> bool:
    if permission not in ALL_PERMISSIONS:
        return False
    return permission in ROLE_PERMISSIONS[normalize_role(role)]
