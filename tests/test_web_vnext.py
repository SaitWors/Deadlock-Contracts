from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANDING = (ROOT / "frontend/src/Landing.tsx").read_text(encoding="utf-8")
APP = (ROOT / "frontend/src/App.tsx").read_text(encoding="utf-8")
DASHBOARD = (ROOT / "frontend/src/Dashboard.tsx").read_text(encoding="utf-8")
INDEX_CSS = (ROOT / "frontend/src/index.css").read_text(encoding="utf-8")
VNEXT_CSS = (ROOT / "frontend/src/vnext.css").read_text(encoding="utf-8")
SECURITY = (ROOT / "app/security.py").read_text(encoding="utf-8")
CONFIG = (ROOT / "app/config.py").read_text(encoding="utf-8")
MAIN = (ROOT / "app/main.py").read_text(encoding="utf-8")


def test_release_version_is_consistent() -> None:
    assert 'os.getenv("APP_VERSION", "0.10.1-alpha.11")' in CONFIG
    assert "APP_VERSION: 0.10.1-alpha.11" in (ROOT / "compose.prod.yaml").read_text(encoding="utf-8")
    assert '"version": "0.10.1-alpha.11"' in (ROOT / "frontend/package.json").read_text(encoding="utf-8")


def test_landing_is_exact_legacy_motion_restore() -> None:
    for marker in (
        "function CustomCursor()",
        "function ScrambleText",
        "function CuratorTyper",
        "const PARTICLES = Array.from({ length: 22 }",
        'className="hero-grid',
        'className="radar-ring"',
        'className="scanline-overlay"',
        "useTilt(8)",
        "useRipple()",
        "AnimatedCounter",
    ):
        assert marker in LANDING


def test_active_case_is_server_state_only() -> None:
    assert "ACTIVE CASE / SERVER STATE" in DASHBOARD
    assert "activeBoards" in DASHBOARD
    assert "SOURCE" in DASHBOARD and ">SERVER<" in DASHBOARD


def test_fonts_are_self_hosted_and_csp_has_no_google_font_exception() -> None:
    combined = INDEX_CSS + VNEXT_CSS + SECURITY
    assert "fonts.googleapis.com" not in combined
    assert "fonts.gstatic.com" not in combined
    assert "./imports/fonts/" in VNEXT_CSS


def test_support_page_is_public() -> None:
    assert '@app.get("/support", include_in_schema=False)' in MAIN
    assert "supportDocument" in (ROOT / "app/static/legal.html").read_text(encoding="utf-8")


def test_board_endpoints_share_the_logical_reset_day() -> None:
    assert '"date": today_utc().isoformat()' in MAIN
    assert "ContractBoard.board_date == today_utc()" in MAIN


def test_admin_console_exposes_adaptive_and_verification_diagnostics_safely() -> None:
    assert 'verification_health' in MAIN
    assert 'adaptive_profiles' in MAIN
    assert '@app.post("/api/admin/boards/{board_id}/retry-verification"' in MAIN
    assert 'board.status != "VERIFYING"' in MAIN
    assert 'match.is_final' in MAIN
    assert 'admin.board_verification_retried' in MAIN
    assert 'Verification health' in DASHBOARD
    assert 'Adaptive Contracts profile' in DASHBOARD
    assert 'RECHECK VERIFYING' in DASHBOARD
    assert 'Why this contract / basis' in DASHBOARD


def test_failed_alpha3_motion_helper_is_not_part_of_runtime() -> None:
    assert not (ROOT / "frontend/src/LandingMotion.tsx").exists()
    assert "LandingMotion" not in LANDING


def test_public_navigation_and_verified_leaderboard_are_restored() -> None:
    normalized_landing = " ".join(
        LANDING.replace('"', "'").split()
    )

    assert (
        "{ id: 'campaigns', label: 'CAMPAIGNS · SOON' }"
        in normalized_landing
    )
    assert (
        "{ id: 'leaderboards', label: 'LEADERBOARD' }"
        in normalized_landing
    )

    assert (
        "fetch(`/api/public/leaderboard?scope=${leaderScope}&limit=50`"
        in LANDING
    )
    assert '@app.get("/api/public/leaderboard")' in MAIN

    leaderboard_service = (
        ROOT / "app/services/leaderboard.py"
    ).read_text(encoding="utf-8")

    assert "TRUSTED_REWARD_SOURCES" in leaderboard_service
    assert "ADMIN_ADJUSTMENT" not in leaderboard_service


def test_alpha11_public_release_hygiene() -> None:
    release = (
        ROOT / "release.json"
    ).read_text(encoding="utf-8")

    assert '"web_version": "0.10.1-alpha.11"' in release
    assert '"companion_version": "0.5.2-alpha.17"' in release
    assert '"companion_manifest_version": "0.5.2.17"' in release

    assert 'href="#"' not in LANDING
    assert "INTERACTIVE PREVIEW / NOT SAVED" in LANDING
    assert "ПРЕДПРОСМОТР · НЕ СОХРАНЯЕТСЯ" in LANDING

    legal = (
        ROOT / "app/static/legal.html"
    ).read_text(encoding="utf-8")

    for route, document_id in (
        ("/privacy", "privacyDocument"),
        ("/terms", "termsDocument"),
        ("/support", "supportDocument"),
        ("/status", "statusDocument"),
        ("/changelog", "changelogDocument"),
        ("/data-sources", "dataSourcesDocument"),
    ):
        assert f'@app.get("{route}"' in MAIN
        assert document_id in legal


def test_public_shell_does_not_mask_backend_outages_as_a_signed_out_session() -> None:
    assert "if (failed) return <Landing />" not in APP
    assert "SERVICE TEMPORARILY UNAVAILABLE" in APP
    assert "setAttempt((value) => value + 1)" in APP
    assert 'href="/status"' in APP
    assert 'href="/support"' in APP


def test_landing_reveal_and_contract_preview_are_keyboard_accessible() -> None:
    assert "return [setRef, visible]" in LANDING
    assert "ref={revealRef}" in LANDING
    assert "aria-pressed={isSelected}" in LANDING
    assert "aria-expanded={openFaq === i}" in LANDING


def test_deploy_runs_migrations_before_recreating_services() -> None:
    deploy = (ROOT / "scripts/deploy-current.sh").read_text(encoding="utf-8")
    migrate = '"${COMPOSE[@]}" run --rm migrate'
    recreate = '"${COMPOSE[@]}" up -d --no-deps --force-recreate web worker'
    assert migrate in deploy
    assert deploy.index(migrate) < deploy.index(recreate)
