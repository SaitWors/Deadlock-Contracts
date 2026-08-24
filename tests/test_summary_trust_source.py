from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKER = (ROOT / "app/worker.py").read_text(encoding="utf-8")
BACKGROUND = (
    ROOT / "companion/src/background-engine.js"
).read_text(encoding="utf-8")


def test_companion_merge_is_explicitly_diagnostic_only():
    assert '"trust_class": "T0_UNTRUSTED"' in WORKER
    assert '"scoring_contribution": False' in WORKER


def test_companion_never_adds_scoring_capabilities():
    merge_start = WORKER.index("def merge_companion_evidence(")
    merge_end = WORKER.index("def _companion_evidence_for(", merge_start)
    merge_source = WORKER[merge_start:merge_end]
    assert "capabilities.add(" not in merge_source
    assert 'data["capabilities"] =' not in merge_source


def test_client_only_normalization_fails_closed():
    start = WORKER.index("def _normalized_from_companion_evidence(")
    end = WORKER.index("def _finish_discovery_jobs_for_board(", start)
    source = WORKER[start:end]
    assert "return None" in source
    assert '"scoring_status": "SCORED"' not in source


def test_nested_info_update_is_distinct_from_cached_get_info():
    assert "function extractMatchInfo(mi, source = 'get_info')" in BACKGROUND
    assert "applyMatchOutcome(mi.match_outcome, source)" in BACKGROUND
    assert "function classifyInfoSource(result)" in BACKGROUND
    assert (
        "return result?.feature && result?.info "
        "? 'info_update' : 'get_info'"
    ) in BACKGROUND
    assert "const source = classifyInfoSource(result)" in BACKGROUND
    assert "extractMatchInfo(res.match_info, source)" in BACKGROUND


def test_flat_deadlock_info_update_remains_supported():
    assert "applyMatchOutcome(value, 'info_update')" in BACKGROUND


def test_result_marker_still_requires_real_info_update_and_exact_current_match():
    assert "source === 'info_update' && state.matchId" in BACKGROUND
    assert "state.matchOutcomeEventAt = nowIso()" in BACKGROUND
    assert "state.matchOutcomeEventMatchId = Number(state.matchId)" in BACKGROUND
