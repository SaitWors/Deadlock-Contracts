from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKER = (ROOT / "app/worker.py").read_text(encoding="utf-8")
BACKGROUND = (
    ROOT / "companion/src/background-engine.js"
).read_text(encoding="utf-8")


def test_live_healing_does_not_gain_summary_capability_during_generic_merge():
    assert '"healing": ("healing", None)' in WORKER


def test_standard_and_ranked_healing_gain_capability_only_in_finalization_block():
    final_marker = 'if evidence_mode in {"STANDARD", "RANKED"}:'
    capability = 'capabilities.add("summary.healing")'

    assert final_marker in WORKER
    assert capability in WORKER

    final_pos = WORKER.index(final_marker)
    capability_pos = WORKER.index(capability)

    assert capability_pos > final_pos

    # The trusted finalization block immediately before this policy must still
    # be present; the generic live mapping above intentionally has no capability.
    nearby = WORKER[max(0, final_pos - 2200):capability_pos + 400]
    assert "if finalization:" in nearby


def test_street_brawl_keeps_separate_scoreboard_healing_capability():
    assert 'evidence_mode == "STREET_BRAWL"' in WORKER
    assert 'capabilities.add("gep.scoreboard_healing")' in WORKER


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
