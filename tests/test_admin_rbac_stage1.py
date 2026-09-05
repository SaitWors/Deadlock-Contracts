from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from app.main import ACCESS_ROLES, _display_badges
from app.services.permissions import (
    ALL_PERMISSIONS,
    ROLE_PERMISSIONS,
    permissions_for_role,
    role_has_permission,
)


def test_owner_has_every_known_permission() -> None:
    assert ROLE_PERMISSIONS["OWNER"] == ALL_PERMISSIONS
    assert permissions_for_role("OWNER") == sorted(ALL_PERMISSIONS)


def test_moderator_is_review_only_staff() -> None:
    expected = {
        "admin.access",
        "reviews.read",
        "reviews.claim",
        "reviews.decide",
        "telegram.bind_self",
    }
    assert set(permissions_for_role("MODERATOR")) == expected
    assert role_has_permission("MODERATOR", "reviews.read")
    assert role_has_permission("MODERATOR", "reviews.decide")
    assert not role_has_permission("MODERATOR", "users.read")
    assert not role_has_permission("MODERATOR", "jobs.read")
    assert not role_has_permission("MODERATOR", "outbox.read")
    assert not role_has_permission("MODERATOR", "system.read")
    assert not role_has_permission("MODERATOR", "users.adjust_xp")


def test_admin_does_not_gain_owner_only_mutations() -> None:
    assert role_has_permission("ADMIN", "users.read")
    assert role_has_permission("ADMIN", "jobs.retry")
    assert role_has_permission("ADMIN", "outbox.replay")
    assert not role_has_permission("ADMIN", "users.manage_status")
    assert not role_has_permission("ADMIN", "users.manage_identity")
    assert not role_has_permission("ADMIN", "users.adjust_xp")
    assert not role_has_permission("ADMIN", "missions.edit")
    assert not role_has_permission("ADMIN", "missions.publish")
    assert not role_has_permission("ADMIN", "telegram.bindings.manage")


def test_display_badges_covers_every_stored_access_role() -> None:
    expected = {
        "PLAYER": ["PLAYER"],
        "TESTER": ["TESTER"],
        "MODERATOR": ["PLAYER"],
        "ADMIN": ["ADMIN"],
    }
    assert ACCESS_ROLES == set(expected)

    for role, badges in expected.items():
        user = SimpleNamespace(
            steam_id64=None,
            access_role=role,
            public_badges=[],
        )
        assert _display_badges(user) == badges


def test_moderator_access_role_survives_public_badge_serialization() -> None:
    user = SimpleNamespace(
        steam_id64=None,
        access_role="MODERATOR",
        public_badges=["CONTRIBUTOR"],
    )
    assert user.access_role == "MODERATOR"
    assert _display_badges(user) == ["CONTRIBUTOR", "PLAYER"]


def test_player_and_tester_are_not_staff() -> None:
    for role in ("PLAYER", "TESTER", None, "garbage"):
        assert not role_has_permission(role, "admin.access")
        assert not role_has_permission(role, "reviews.read")


def test_unknown_permission_is_fail_closed() -> None:
    assert not role_has_permission("OWNER", "root.shell")
    assert not role_has_permission("ADMIN", "whatever.new.permission")


def test_main_source_uses_staff_permission_boundary() -> None:
    src = Path("app/main.py").read_text(encoding="utf-8")

    assert 'ACCESS_ROLES = {"PLAYER", "TESTER", "MODERATOR", "ADMIN"}' in src
    assert 'Literal["PLAYER", "TESTER", "MODERATOR", "ADMIN"]' in src
    assert "def _require_staff_identity(" in src
    assert "def _require_staff(" in src
    assert "def _require_permission(permission: str):" in src
    assert 'Depends(_require_permission("reviews.read"))' in src
    assert 'Depends(_require_permission("reviews.decide"))' in src
    assert '"is_staff": role_has_permission(role, "admin.access")' in src
    assert '"permissions": permissions_for_role(role)' in src
    review_block = src[
        src.index('def admin_auto_reviews('):
        src.index('@app.get("/api/admin/auto-reviews/{review_id}")')
    ]
    assert "status: Literal[" in review_block
    for value in ("OPEN", "ALL", "PENDING", "NEEDS_INFO", "RESOLVED", "REJECTED"):
        assert f'"{value}"' in review_block
    assert 'AutoReviewCase.status.in_(("PENDING", "NEEDS_INFO"))' in review_block


def test_review_serializer_has_moderator_redaction() -> None:
    src = Path("app/main.py").read_text(encoding="utf-8")
    assert "def _serialize_auto_review(db: Session, item: AutoReviewCase, *, redact: bool = False)" in src
    serializer = src[
        src.index("def _serialize_auto_review("):
        src.index("def _admin_status_payload(")
    ]
    # Stage 3 reformatted this expression across multiple lines. Verify the
    # redaction branch semantically instead of pinning it to one formatting
    # representation.
    assert '"account_id": (' in serializer
    assert "if redact" in serializer
    assert "(owner.account_id if owner else None)" in serializer
    assert '"context": {} if redact else item.context' in serializer


def test_frontend_uses_permissions_and_open_review_inbox() -> None:
    src = Path("frontend/src/Dashboard.tsx").read_text(encoding="utf-8")

    assert 'type AccessRole = "OWNER" | "ADMIN" | "MODERATOR" | "TESTER" | "PLAYER"' in src
    assert "is_staff: boolean" in src
    assert "permissions: string[]" in src
    assert "ADMIN_SECTION_PERMISSIONS" in src
    assert "firstAdminSectionForPermissions" in src
    assert "user.is_staff" in src
    assert "user.is_admin &&" not in src
    assert "/api/admin/auto-reviews?status=OPEN" in src
    assert '<option>MODERATOR</option>' in src
    assert 'value="MODERATOR">MODERATOR — только Review + TOTP' in src
