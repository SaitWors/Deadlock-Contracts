from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Match, MatchParticipant
from app.services.evaluator import _has_trusted_finality
from app.worker import store_normalized_match


def test_independent_refresh_replaces_all_legacy_gep_facts() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        legacy = Match(
            external_match_id=700_000_001,
            provider="gep_fallback+gep",
            provider_payload_hash="client-hash",
            duration_s=4_000,
            game_match_mode="STREET_BRAWL",
            provider_mode_raw="client-mode",
            mode_classifier_version="client-v1",
            mode_confidence="HIGH",
            scoring_status="SCORED",
            game_version="client-build",
            is_final=True,
            capabilities=["summary.kills", "summary.result"],
            raw_summary={"client_scoreboard": {"kills": 999}},
        )
        db.add(legacy)
        db.flush()
        db.add(
            MatchParticipant(
                match_id=legacy.id,
                account_id=42,
                won=True,
                kills=999,
                assists=999,
                net_worth=99_999_999,
            )
        )
        db.commit()

        repaired = store_normalized_match(
            db,
            {
                "external_match_id": 700_000_001,
                "provider": "deadlock_api",
                "provider_payload_hash": "provider-hash",
                "duration_s": 1_800,
                "game_match_mode": "STANDARD",
                "provider_mode_raw": "Normal",
                "mode_classifier_version": "provider-v2",
                "mode_confidence": "HIGH",
                "scoring_status": "SCORED",
                "is_final": True,
                "capabilities": ["summary.duration"],
                "participant": {"account_id": 42, "hero_id": 7},
            },
        )

        participant = db.scalar(
            select(MatchParticipant).where(MatchParticipant.match_id == repaired.id)
        )
        assert participant is not None
        assert repaired.provider == "deadlock_api"
        assert repaired.provider_payload_hash == "provider-hash"
        assert repaired.duration_s == 1_800
        assert repaired.game_match_mode == "STANDARD"
        assert repaired.capabilities == ["summary.duration"]
        assert repaired.raw_summary["source_repair"]["discarded_provider"] == "gep_fallback+gep"
        assert participant.hero_id == 7
        assert participant.won is None
        assert participant.kills is None
        assert participant.assists is None
        assert participant.net_worth is None
        assert _has_trusted_finality(repaired) is True


def test_client_update_cannot_enrich_independent_match() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        original = store_normalized_match(
            db,
            {
                "external_match_id": 700_000_002,
                "provider": "deadlock_api",
                "duration_s": 1_900,
                "game_match_mode": "STANDARD",
                "mode_classifier_version": "provider-v2",
                "mode_confidence": "HIGH",
                "scoring_status": "SCORED",
                "is_final": True,
                "capabilities": ["summary.kills"],
                "participant": {"account_id": 42, "kills": 4},
            },
        )

        unchanged = store_normalized_match(
            db,
            {
                "external_match_id": 700_000_002,
                "provider": "gep_fallback",
                "duration_s": 9_999,
                "game_match_mode": "STREET_BRAWL",
                "mode_classifier_version": "client-v1",
                "mode_confidence": "HIGH",
                "scoring_status": "SCORED",
                "is_final": True,
                "capabilities": ["summary.result", "summary.assists"],
                "raw_summary": {"forged": True},
                "participant": {"account_id": 42, "won": True, "kills": 999},
            },
        )

        participant = db.scalar(
            select(MatchParticipant).where(MatchParticipant.match_id == original.id)
        )
        assert participant is not None
        assert unchanged.provider == "deadlock_api"
        assert unchanged.duration_s == 1_900
        assert unchanged.game_match_mode == "STANDARD"
        assert unchanged.capabilities == ["summary.kills"]
        assert participant.won is None
        assert participant.kills == 4
        assert unchanged.raw_summary["ignored_client_update"]["scoring_contribution"] is False
        assert "forged" in unchanged.raw_summary["ignored_client_update"]["keys"]


def test_plain_gep_provider_is_not_trusted_finality() -> None:
    match = SimpleNamespace(
        provider="gep",
        is_final=True,
        duration_s=2_000,
        raw_summary={},
    )
    assert _has_trusted_finality(match) is False


def test_unknown_provider_duration_is_not_trusted_finality() -> None:
    match = SimpleNamespace(
        provider="unknown",
        is_final=True,
        duration_s=2_000,
        raw_summary={},
    )
    assert _has_trusted_finality(match) is False


def test_new_match_without_explicit_finality_fails_closed() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        match = store_normalized_match(
            db,
            {
                "external_match_id": 700_000_003,
                "provider": "deadlock_api",
                "game_match_mode": "STANDARD",
                "mode_classifier_version": "provider-v2",
                "mode_confidence": "HIGH",
                "capabilities": ["summary.kills"],
                "participant": {"account_id": 42, "kills": 4},
            },
        )
        assert match.is_final is False
        assert match.scoring_status == "UNVERIFIABLE"
        assert _has_trusted_finality(match) is False
