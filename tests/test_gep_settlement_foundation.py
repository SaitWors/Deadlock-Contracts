from app.config import Settings
from app.models import CompanionAttemptLease, CompanionMatchEvidence, Match


def _default(column):
    value = column.default
    return value.arg if value is not None else None


def test_gep_settlement_flags_fail_closed_by_default():
    settings = Settings()

    assert settings.gep_settlement_enabled is False
    assert settings.gep_settlement_allow_all is False
    assert settings.gep_settlement_allowlist == ()
    assert settings.gep_settlement_leaderboard_eligible is False
    assert settings.match_audit_enabled is False


def test_companion_attempt_lease_is_persistent_server_state():
    columns = CompanionAttemptLease.__table__.c

    assert "user_id" in columns
    assert "device_id" in columns
    assert "board_id" in columns
    assert "session_id" in columns
    assert "attempt_nonce_hash" in columns
    assert "external_match_id" in columns
    assert "status" in columns
    assert "server_first_seen_at" in columns

    # board_id must stay nullable so pre-lock/mid-match INELIGIBLE sessions
    # can be recorded and cannot later become retroactively eligible.
    assert columns.board_id.nullable is True


def test_legacy_rows_are_not_promoted_to_server_verified_by_model_defaults():
    match_columns = Match.__table__.c
    evidence_columns = CompanionMatchEvidence.__table__.c

    assert _default(match_columns.settlement_source) == "LEGACY"
    assert _default(match_columns.integrity_status) == "LEGACY_DIAGNOSTIC"
    assert _default(match_columns.audit_status) == "NOT_REQUESTED"

    assert _default(evidence_columns.evidence_schema_version) == 8
    assert _default(evidence_columns.integrity_status) == "LEGACY_DIAGNOSTIC"


def test_evidence_v9_storage_fields_exist_without_enabling_v9_trust():
    columns = CompanionMatchEvidence.__table__.c

    # Legacy `session_id` intentionally stays outside the ORM model.
    assert "session_id" not in columns
    assert "gep_session_id" in columns
    assert "attempt_nonce_hash" in columns
    assert "terminal_signal" in columns
    assert "server_first_seen_at" in columns
    assert "server_finalized_at" in columns
    assert "final_sequence" in columns
    assert "final_payload_hash" in columns
