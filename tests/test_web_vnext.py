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
    assert 'os.getenv("APP_VERSION", "0.10.1-alpha.12")' in CONFIG
    assert "APP_VERSION: 0.10.1-alpha.12" in (ROOT / "compose.prod.yaml").read_text(encoding="utf-8")
    assert '"version": "0.10.1-alpha.12"' in (ROOT / "frontend/package.json").read_text(encoding="utf-8")


def test_public_and_authenticated_screens_share_the_bureau_header() -> None:
    assert "<BureauHeader" in LANDING and "<BureauHeader" in DASHBOARD
    assert "<CustomCursor" not in LANDING + DASHBOARD
    assert "innerHTML =" not in LANDING
    assert "prefers-reduced-motion:reduce" in (
        ROOT / "frontend/src/bureau.css"
    ).read_text(encoding="utf-8")


def test_active_case_is_server_state_only() -> None:
    assert "Only server-locked conditions appear here." in DASHBOARD
    assert "activeBoards" in DASHBOARD
    assert "SOURCE" in DASHBOARD
    assert 'language === "ru" ? "Сервер" : "Server"' in DASHBOARD


def test_fonts_are_self_hosted_and_csp_has_no_google_font_exception() -> None:
    combined = INDEX_CSS + VNEXT_CSS + SECURITY
    assert "fonts.googleapis.com" not in combined
    assert "fonts.gstatic.com" not in combined
    assert "./imports/city-fonts/city-fonts.css" in VNEXT_CSS


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
    assert 'id: "contracts"' in LANDING
    assert 'id: "cards"' in LANDING
    assert 'id: "leaderboards"' in LANDING
    assert 'label: ru ? "Коллекция" : "Collection"' in LANDING
    assert 'id: "campaigns",' not in LANDING

    assert "<Leaderboard" in LANDING and "<Leaderboard authenticated" in DASHBOARD
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

    assert '"web_version": "0.10.1-alpha.12"' in release
    assert '"companion_version": "0.5.2-alpha.18"' in release
    assert '"companion_manifest_version": "0.5.2.18"' in release

    assert 'href="#"' not in LANDING
    assert "This is a preview. Sign in for your real contracts, conditions and rewards." in LANDING
    assert "Примерить подпись" in LANDING

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


def test_landing_reveal_and_contract_preview_are_keyboard_accessible() -> None:
    assert 'data-contract-choice={c.id}' in LANDING
    assert 'aria-pressed={selected.includes(c.id)}' in LANDING
    assert 'className="ritual-skip"' in LANDING


def test_deploy_runs_migrations_before_recreating_services() -> None:
    deploy = (ROOT / "scripts/deploy-current.sh").read_text(encoding="utf-8")
    migrate = '"${COMPOSE[@]}" run --rm migrate'
    recreate = '"${COMPOSE[@]}" up -d --no-deps --force-recreate web worker'
    assert migrate in deploy
    assert deploy.index(migrate) < deploy.index(recreate)
