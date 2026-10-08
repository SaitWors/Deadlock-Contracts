from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from importlib import import_module
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import (
    BoardOption, ContractBoard, Evaluation, Match, MatchParticipant,
    MissionDefinition, RewardLedgerEntry, SessionToken, User,
)
from app.services.auth import COOKIE_NAME, hash_token


NOW = datetime(2026, 10, 9, 18, tzinfo=timezone.utc)


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False, expire_on_commit=False) as session:
        yield session
    engine.dispose()


def player(db, account_id=123):
    user = User(account_id=account_id, display_name="Progress owner", xp=42)
    db.add(user)
    db.commit()
    return user


def progress(db, user, mode="STANDARD", intent="PRACTICE"):
    try:
        service = import_module("app.services.personal_progress")
    except ModuleNotFoundError:
        pytest.fail("The personal progress read model is not implemented")
    return service.build_personal_progress(db, user, mode, intent)


def match(db, user, index=0, *, mode="STANDARD", hero_id=1,
          provider="deadlock_api", is_final=True, scoring_status="SCORED",
          integrity_status="LEGACY_DIAGNOSTIC", settlement_source="LEGACY", **stats):
    row = Match(
        external_match_id=10_000 + index,
        provider=provider,
        started_at=NOW + timedelta(minutes=index),
        ended_at=NOW + timedelta(minutes=index + 1),
        created_at=NOW + timedelta(minutes=index),
        game_match_mode=mode,
        is_final=is_final,
        scoring_status=scoring_status,
        mode_classifier_version="progress-test-1",
        integrity_status=integrity_status,
        settlement_source=settlement_source,
    )
    db.add(row)
    db.flush()
    db.add(MatchParticipant(match_id=row.id, account_id=user.account_id, hero_id=hero_id, **stats))
    db.flush()
    return row


def board(db, user, index=0, *, mode="STANDARD", status="OFFERED"):
    row = ContractBoard(
        user_id=user.id, board_date=date(2026, 10, 9) + timedelta(days=index),
        seed=f"progress-{uuid4()}", game_match_mode=mode, status=status,
        generation=3, expires_at=NOW + timedelta(days=30),
    )
    db.add(row)
    db.flush()
    return row


def option(db, offered, *, metric="player.kills", target=8, kind="CONSISTENCY",
           status="OFFERED", selected=False, adaptive_enabled=True,
           adaptive_n=12, conditions=None, difficulty="FOCUSED", category="COMBAT"):
    mission = MissionDefinition(
        key=f"progress-{uuid4()}", title="Официальная цель", title_en="Issued goal",
        description="Набери 8 убийств", description_en="Get at least 8 kills",
        metric=metric, operator="gte", target=target, reward_xp=100,
    )
    db.add(mission)
    db.flush()
    row = BoardOption(
        board_id=offered.id, mission_definition_id=mission.id,
        rendered_title=f"Цель {kind}", rendered_description="Сохранённое условие",
        metric=metric, operator="lte" if metric == "player.deaths" else "gte",
        target=target, reward_xp=100, status=status, selected=selected,
        difficulty=difficulty, category=category, required_game_match_mode=offered.game_match_mode,
        conditions=conditions or [{"metric": metric, "operator": "lte" if metric == "player.deaths" else "gte", "target": target}],
        generator_meta={"adaptive": {
            "enabled": adaptive_enabled, "kind": kind, "sample_size": adaptive_n,
            "basis": [{"metric": metric, "n": adaptive_n, "median": 999, "target": target, "source": "median"}],
        }},
    )
    db.add(row)
    db.flush()
    return row


def evaluate(db, assignment, game, revision=1, *, status="COMPLETED", explanation="Checked result"):
    row = Evaluation(
        assignment_id=assignment.id, match_id=game.id, revision=revision,
        status=status, evaluator_version="progress-test-1", explanation=explanation,
    )
    db.add(row)
    db.flush()
    return row


def reward(db, user, assignment, delta=100, *, source_type="assignment", asset="XP"):
    db.add(RewardLedgerEntry(
        user_id=user.id, source_id=assignment.id, source_type=source_type,
        asset=asset, delta=delta, balance_after=100,
    ))
    db.flush()


def test_user_without_account_or_history_has_no_invented_progress(db):
    user = player(db, account_id=None)

    result = progress(db, user)

    assert result == {
        "version": "personal-progress-1",
        "mode": "STANDARD",
        "intent": "PRACTICE",
        "sample_size": 0,
        "minimum_sample_size": 8,
        "confidence": "COLD_START",
        "sources": [],
        "board": None,
        "goal": None,
        "alternatives": [],
        "debrief": None,
        "heroes": [],
    }


def test_only_owners_final_scored_known_mode_matches_enter_progress(db):
    owner, other = player(db), player(db, 456)
    match(db, owner, 0, kills=7)
    match(db, other, 1, kills=900)
    match(db, owner, 2, mode="RANKED", kills=901)
    match(db, owner, 3, mode="UNKNOWN", kills=902)
    match(db, owner, 4, is_final=False, kills=903)
    match(db, owner, 5, scoring_status="UNVERIFIABLE", kills=904)
    own_board = board(db, owner)
    own_goal = option(db, own_board)
    option(db, board(db, other, 1), target=999)
    db.commit()

    result = progress(db, owner)

    assert result["sample_size"] == 1
    assert result["debrief"]["match_id"] == "10000"
    assert result["heroes"] == [{
        "hero_id": 1, "matches": 1, "contracts_completed": 0,
        "records": [{"metric": "player.kills", "value": 7.0}],
        "sources": [{"kind": "INDEPENDENT_PROVIDER", "count": 1}],
    }]
    assert result["goal"]["option_id"] == own_goal.id


@pytest.mark.parametrize("mode", ["STANDARD", "RANKED", "STREET_BRAWL"])
def test_each_mode_keeps_its_own_sample_and_existing_offer(db, mode):
    owner = player(db)
    offers = {}
    for index, available_mode in enumerate(["STANDARD", "RANKED", "STREET_BRAWL"]):
        match(db, owner, index, mode=available_mode, hero_id=index + 1, kills=10 + index)
        offers[available_mode] = option(db, board(db, owner, mode=available_mode)).id
    db.commit()

    result = progress(db, owner, mode)

    assert result["mode"] == mode
    assert result["sample_size"] == 1
    assert result["goal"]["option_id"] == offers[mode]
    assert len(result["heroes"]) == 1


@pytest.mark.parametrize(("intent", "expected_kind"), [
    ("PRACTICE", "CONSISTENCY"), ("EXPERIMENT", "CHALLENGE"),
    ("RESULT", "MASTERY"), ("VARIETY", "WILDCARD"),
])
def test_intents_recommend_issued_options_with_two_distinct_alternatives(db, intent, expected_kind):
    owner = player(db)
    offered = board(db, owner)
    by_kind = {
        kind: option(db, offered, kind=kind, adaptive_enabled=kind != "WILDCARD")
        for kind in ["CONSISTENCY", "CHALLENGE", "MASTERY", "WILDCARD"]
    }
    for index in range(8):
        match(db, owner, index, kills=6)
    db.commit()

    result = progress(db, owner, intent=intent)
    goals = [result["goal"], *result["alternatives"]]

    assert result["goal"]["option_id"] == by_kind[expected_kind].id
    assert len(goals) == 3
    assert len({goal["option_id"] for goal in goals}) == 3
    assert {goal["option_id"] for goal in goals} <= {row.id for row in by_kind.values()}
    assert all(goal["conditions"] == [{"metric": "player.kills", "operator": "gte", "target": 8.0}] for goal in goals)


@pytest.mark.parametrize("sample_size", [0, 5, 7])
def test_cold_start_never_repeats_generator_claim_of_personalization(db, sample_size):
    owner = player(db)
    goal = option(db, board(db, owner), adaptive_n=12)
    for index in range(sample_size):
        match(db, owner, index, kills=6)
    db.commit()

    result = progress(db, owner)

    assert result["minimum_sample_size"] == 8
    assert result["confidence"] == "COLD_START"
    assert result["goal"]["option_id"] == goal.id
    assert result["goal"]["personalized"] is False
    assert result["goal"]["basis"] == []
    assert "generic" in result["goal"]["reason"]["en"].lower()
    assert "999" not in str(result["goal"])


def test_personalization_basis_uses_actual_available_samples_not_stale_metadata(db):
    owner = player(db)
    option(db, board(db, owner))
    for index in range(8):
        match(db, owner, index, kills=6)
    db.commit()

    result = progress(db, owner)

    assert result["confidence"] == "LOW"
    assert result["goal"]["personalized"] is True
    assert result["goal"]["basis"] == [{
        "metric": "player.kills", "n": 8, "median": 6.0,
        "target": 8.0, "source": "median",
    }]
    assert "6" in result["goal"]["reason"]["en"]
    assert "8" in result["goal"]["reason"]["en"]
    assert "999" not in str(result["goal"])


def test_eight_matches_with_missing_goal_metric_do_not_claim_personalization(db):
    owner = player(db)
    option(db, board(db, owner), metric="player.healing", target=5000)
    for index in range(8):
        match(db, owner, index, kills=6)
    db.commit()

    result = progress(db, owner)

    assert result["goal"]["personalized"] is False
    assert result["goal"]["basis"] == []
    assert all(record["metric"] != "player.healing" for record in result["heroes"][0]["records"])


def test_latest_match_is_excluded_from_its_own_prior_baseline(db):
    owner = player(db)
    for index in range(8):
        match(db, owner, index, kills=10, deaths=5)
    match(db, owner, 8, kills=100, deaths=3)
    db.commit()

    debrief = progress(db, owner)["debrief"]

    assert debrief["match_id"] == "10008"
    assert debrief["baseline_scope"] == "SAME_HERO"
    assert debrief["baseline_sample_size"] == 8
    by_metric = {item["metric"]: item for item in debrief["comparisons"]}
    assert by_metric["player.kills"] == {
        "metric": "player.kills", "current": 100.0, "median": 10.0,
        "delta": 90.0, "n": 8, "improved": True,
    }
    assert by_metric["player.deaths"]["delta"] == -2.0
    assert by_metric["player.deaths"]["improved"] is True
    assert "player.kda" not in by_metric


def test_prior_comparison_requires_eight_observations_before_claiming_improvement(db):
    owner = player(db)
    for index in range(8):
        match(db, owner, index, kills=10, healing=100 if index < 7 else None)
    match(db, owner, 8, kills=20, healing=200)
    db.commit()

    comparisons = progress(db, owner)["debrief"]["comparisons"]

    assert [item["metric"] for item in comparisons] == ["player.kills", "player.healing"]
    assert comparisons[1] == {
        "metric": "player.healing", "current": 200.0, "median": None,
        "delta": None, "n": 7, "improved": False,
    }


def test_first_final_match_shows_observed_stats_without_a_baseline_claim(db):
    owner = player(db)
    match(db, owner, kills=7)
    db.commit()

    result = progress(db, owner)

    assert result["debrief"]["baseline_sample_size"] == 0
    assert result["debrief"]["baseline_scope"] == "NONE"
    assert result["debrief"]["comparisons"] == [{
        "metric": "player.kills", "current": 7.0, "median": None,
        "delta": None, "n": 0, "improved": False,
    }]


def test_baseline_prefers_same_hero_over_other_mode_comparable_heroes(db):
    owner = player(db)
    for index in range(8):
        match(db, owner, index, hero_id=1, kills=10)
    for index in range(8, 16):
        match(db, owner, index, hero_id=2, kills=100)
    match(db, owner, 16, hero_id=1, kills=20)
    db.commit()

    debrief = progress(db, owner)["debrief"]

    assert debrief["baseline_scope"] == "SAME_HERO"
    assert debrief["baseline_sample_size"] == 8
    assert debrief["comparisons"][0]["median"] == 10.0


def test_baseline_falls_back_to_same_mode_explicitly_for_new_hero(db):
    owner = player(db)
    for index in range(8):
        match(db, owner, index, hero_id=1, kills=10)
    match(db, owner, 8, hero_id=2, kills=20)
    db.commit()

    debrief = progress(db, owner)["debrief"]

    assert debrief["baseline_scope"] == "SAME_MODE"
    assert debrief["baseline_sample_size"] == 8
    assert debrief["comparisons"][0]["median"] == 10.0


def test_baseline_never_mixes_client_attestation_with_independent_provider(db):
    owner = player(db)
    for index in range(8):
        match(db, owner, index, kills=10)
    for index in range(8, 16):
        match(db, owner, index, provider="overwolf_gep", integrity_status="CLIENT_ATTESTED_GEP", kills=900)
    match(db, owner, 16, kills=20)
    db.commit()

    result = progress(db, owner)

    assert result["debrief"]["source"] == "INDEPENDENT_PROVIDER"
    assert result["debrief"]["baseline_sample_size"] == 8
    assert result["debrief"]["comparisons"][0]["median"] == 10.0
    assert {item["kind"]: item["count"] for item in result["sources"]} == {
        "INDEPENDENT_PROVIDER": 9, "CLIENT_ATTESTED_GEP": 8,
    }


def test_demo_unknown_and_mixed_legacy_providers_are_not_independent_sources(db):
    owner = player(db)
    match(db, owner, 0, provider="mock", integrity_status="SERVER_VERIFIED", kills=1)
    match(db, owner, 1, provider="unknown", settlement_source="UNKNOWN", kills=2)
    match(db, owner, 2, provider="deadlock_api+overwolf_gep", kills=3)
    match(db, owner, 3, provider="overwolf_gep", integrity_status="CLIENT_ATTESTED_GEP", kills=4)
    db.commit()

    result = progress(db, owner)

    assert {item["kind"]: item["count"] for item in result["sources"]} == {
        "DEMO": 1, "UNKNOWN": 1, "LEGACY": 1, "CLIENT_ATTESTED_GEP": 1,
    }
    assert result["debrief"]["source"] == "CLIENT_ATTESTED_GEP"


def test_explicit_client_integrity_is_not_upgraded_by_a_provider_label(db):
    owner = player(db)
    match(db, owner, provider="deadlock_api", integrity_status="CLIENT_ATTESTED_GEP", kills=4)
    db.commit()

    result = progress(db, owner)

    assert result["sources"] == [{"kind": "CLIENT_ATTESTED_GEP", "count": 1}]
    assert result["debrief"]["source"] == "CLIENT_ATTESTED_GEP"


@pytest.mark.parametrize(("provider", "settlement_source", "expected"), [
    ("unrecognized_vendor", "UNKNOWN", "UNKNOWN"),
    ("deadlock_labs", "LEGACY", "LEGACY"),
    ("deadlock_api+unrecognized_vendor", "LEGACY", "LEGACY"),
    ("deadlock_api+unknown", "UNKNOWN", "LEGACY"),
])
def test_unrecognized_or_mixed_provider_labels_never_claim_independent_verification(db, provider, settlement_source, expected):
    owner = player(db)
    match(db, owner, provider=provider, settlement_source=settlement_source, integrity_status="UNKNOWN", kills=4)
    db.commit()

    result = progress(db, owner)

    assert result["sources"] == [{"kind": expected, "count": 1}]
    assert result["debrief"]["source"] == expected


def test_generic_practice_prefers_support_when_issued_difficulty_is_equal(db):
    owner = player(db)
    offered = board(db, owner)
    option(db, offered, target=5, kind="COLD_START", adaptive_enabled=False, difficulty="LIGHT")
    support = option(db, offered, metric="player.assists", kind="COLD_START", adaptive_enabled=False, difficulty="LIGHT", category="SUPPORT")
    db.commit()

    result = progress(db, owner)

    assert result["goal"]["option_id"] == support.id
    assert result["goal"]["personalized"] is False


def test_generic_variety_chooses_an_alternate_issued_category(db):
    owner = player(db)
    offered = board(db, owner)
    combat = option(db, offered, target=5, kind="COLD_START", adaptive_enabled=False, difficulty="LIGHT")
    support = option(db, offered, metric="player.assists", kind="COLD_START", adaptive_enabled=False, difficulty="HARD", category="SUPPORT")
    db.commit()

    assert progress(db, owner)["goal"]["option_id"] == combat.id
    result = progress(db, owner, intent="VARIETY")

    assert result["goal"]["option_id"] == support.id
    assert result["goal"]["personalized"] is False


def test_recommendations_order_mixed_loaded_and_new_datetime_values(db):
    owner = player(db)
    offered = board(db, owner)
    first = option(db, offered, adaptive_enabled=False)
    second = option(db, offered, adaptive_enabled=False)
    first.created_at = NOW
    second.created_at = NOW.replace(tzinfo=None) + timedelta(minutes=1)
    db.commit()

    result = progress(db, owner)

    assert result["goal"]["option_id"] == first.id
    assert result["alternatives"][0]["option_id"] == second.id


@pytest.mark.parametrize(("intent", "expected"), [
    ("PRACTICE", "easy"), ("EXPERIMENT", "stretch"),
    ("RESULT", "win"), ("VARIETY", "wildcard"),
])
def test_generic_offers_still_reflect_intent_without_claiming_personalization(db, intent, expected):
    owner = player(db)
    offered = board(db, owner)
    choices = {
        "easy": option(db, offered, target=5, kind="COLD_START", adaptive_enabled=False, difficulty="LIGHT"),
        "stretch": option(db, offered, kind="COLD_START", adaptive_enabled=False, difficulty="HARD", conditions=[
            {"metric": "player.kills", "operator": "gte", "target": 8},
            {"metric": "player.assists", "operator": "gte", "target": 10},
        ]),
        "win": option(db, offered, metric="match.win", target=1, kind="COLD_START", adaptive_enabled=False, difficulty="LIGHT"),
        "wildcard": option(db, offered, metric="player.healing", target=2500, kind="COLD_START", adaptive_enabled=False),
    }
    choices["wildcard"].generator_meta = {**choices["wildcard"].generator_meta, "slot": 4}
    db.commit()

    result = progress(db, owner, intent=intent)

    assert result["goal"]["option_id"] == choices[expected].id
    assert result["goal"]["personalized"] is False
    assert result["goal"]["basis"] == []


def test_recent_dossier_omits_older_records_and_unknown_metrics(db):
    owner = player(db)
    for index in range(25):
        match(db, owner, index, kills=999 if index == 0 else index)
    db.commit()

    result = progress(db, owner)

    assert result["sample_size"] == 20
    assert result["confidence"] == "HIGH"
    assert result["heroes"][0]["matches"] == 20
    assert result["heroes"][0]["records"] == [{"metric": "player.kills", "value": 24.0}]
    assert result["debrief"]["baseline_sample_size"] == 20


def test_hero_without_observed_metrics_has_empty_records(db):
    owner = player(db)
    match(db, owner)
    db.commit()

    result = progress(db, owner)

    assert result["heroes"][0]["records"] == []
    assert result["debrief"]["comparisons"] == []


def test_debrief_uses_latest_owned_revision_per_assignment_and_match(db):
    owner, other = player(db), player(db, 456)
    older = match(db, owner, 0, kills=10)
    latest = match(db, owner, 1, kills=20)
    own_board = board(db, owner, status="SETTLED")
    corrected = option(db, own_board, status="FAILED", selected=True)
    evaluate(db, corrected, latest, 1)
    evaluate(db, corrected, latest, 2, status="FAILED", explanation="Corrected verdict")
    completed = option(db, own_board, status="COMPLETED", selected=True)
    final = evaluate(db, completed, latest, 1)
    completed.final_evaluation_id = final.id
    evaluate(db, completed, older, 3, status="FAILED", explanation="Different match")
    foreign = option(db, board(db, other, 2, status="SETTLED"), status="COMPLETED", selected=True)
    evaluate(db, foreign, latest, 1, explanation="Private other account")
    reward(db, owner, completed)
    reward(db, owner, completed, 700, source_type="ADMIN_ADJUSTMENT")
    reward(db, owner, corrected, 50, source_type="AUTO_REVIEW", asset="TOKENS")
    reward(db, other, corrected, 600, source_type="MANUAL_EVIDENCE")
    db.commit()

    result = progress(db, owner)
    contracts = {item["assignment_id"]: item for item in result["debrief"]["contracts"]}

    assert set(contracts) == {corrected.id, completed.id}
    assert contracts[corrected.id]["status"] == "FAILED"
    assert contracts[corrected.id]["explanation"] == "Corrected verdict"
    assert contracts[corrected.id]["reward_granted_xp"] == 0
    assert contracts[completed.id]["status"] == "COMPLETED"
    assert contracts[completed.id]["reward_granted_xp"] == 100
    assert result["debrief"]["xp_granted"] == 100
    assert result["heroes"][0]["contracts_completed"] == 1


def test_older_assignment_award_is_not_repeated_on_latest_attempt(db):
    owner = player(db)
    older = match(db, owner, 0, kills=10)
    latest = match(db, owner, 1, kills=20)
    assignment = option(db, board(db, owner, status="SETTLED"), status="COMPLETED", selected=True)
    final = evaluate(db, assignment, older, 1)
    assignment.final_evaluation_id = final.id
    evaluate(db, assignment, latest, 2)
    reward(db, owner, assignment)
    db.commit()

    result = progress(db, owner)

    assert result["debrief"]["contracts"][0]["reward_granted_xp"] == 0
    assert result["debrief"]["xp_granted"] == 0
    assert result["heroes"][0]["contracts_completed"] == 1


def test_locked_selected_goal_stays_authoritative_over_newer_offer_and_intent(db):
    owner = player(db)
    locked_board = board(db, owner, status="LOCKED")
    selected = option(db, locked_board, selected=True, status="LOCKED", target=11)
    option(db, locked_board, kind="WILDCARD")
    option(db, board(db, owner, 1), target=999)
    db.commit()

    for intent in ["PRACTICE", "EXPERIMENT", "RESULT", "VARIETY"]:
        result = progress(db, owner, intent=intent)
        assert result["board"] == {"id": locked_board.id, "status": "LOCKED", "generation": 3}
        assert result["goal"]["option_id"] == selected.id
        assert result["goal"]["conditions"] == [{"metric": "player.kills", "operator": "gte", "target": 11.0}]
        assert result["alternatives"] == []


@pytest.mark.parametrize("active_status", ["LOCKED", "VERIFYING", "REVIEW_REQUIRED"])
def test_signed_board_prioritizes_remaining_active_goal_over_completed_selection(db, active_status):
    owner = player(db)
    signed_board = board(db, owner, status=active_status)
    completed = option(db, signed_board, selected=True, status="COMPLETED")
    active = option(db, signed_board, selected=True, status=active_status, target=11)
    completed.created_at = NOW
    active.created_at = NOW + timedelta(seconds=1)
    db.commit()

    result = progress(db, owner)

    assert result["goal"]["option_id"] == active.id
    assert result["goal"]["status"] == active_status
    assert result["goal"]["conditions"] == [{"metric": "player.kills", "operator": "gte", "target": 11.0}]
    assert result["alternatives"] == []


def test_repeated_projection_does_not_write_economy_goals_or_board_state(db):
    owner = player(db)
    offered = board(db, owner)
    issued = option(db, offered)
    match(db, owner)
    db.commit()
    statements = []

    def record_statement(_, __, statement, ___, ____, _____):
        statements.append(statement.lstrip().split(None, 1)[0].upper())

    event.listen(db.bind, "before_cursor_execute", record_statement)
    try:
        first = progress(db, owner)
        second = progress(db, owner)
    finally:
        event.remove(db.bind, "before_cursor_execute", record_statement)

    assert first == second
    assert not {"INSERT", "UPDATE", "DELETE"}.intersection(statements)
    assert owner.xp == 42
    assert issued.selected is False
    assert offered.generation == 3
    assert list(db.scalars(select(RewardLedgerEntry))) == []
    assert list(db.scalars(select(BoardOption.id))) == [issued.id]


@pytest.mark.parametrize(("mode", "intent"), [("UNKNOWN", "PRACTICE"), ("STANDARD", "UNKNOWN")])
def test_service_rejects_unsupported_mode_and_intent(db, mode, intent):
    owner = player(db)

    with pytest.raises(ValueError):
        progress(db, owner, mode, intent)


def test_router_requires_real_cookie_auth_and_returns_private_no_store(db):
    try:
        api = import_module("app.personal_progress")
    except ModuleNotFoundError:
        pytest.fail("The authenticated personal progress router is not implemented")
    owner = player(db)
    offered = board(db, owner)
    issued = option(db, offered)
    token = uuid4().hex
    db.add(SessionToken(token_hash=hash_token(token), user_id=owner.id,
                        expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    db.commit()
    test_app = FastAPI()
    test_app.include_router(api.router)

    def database():
        yield db

    test_app.dependency_overrides[get_db] = database
    with TestClient(test_app) as client:
        assert client.get("/api/personal-progress").status_code == 401
        client.cookies.set(COOKIE_NAME, token)
        response = client.get("/api/personal-progress?mode=STANDARD&intent=PRACTICE")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
        assert response.json()["goal"]["option_id"] == issued.id
        assert client.get("/api/personal-progress?mode=UNKNOWN").status_code == 422
        assert client.get("/api/personal-progress?intent=UNKNOWN").status_code == 422
