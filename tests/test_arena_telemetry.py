from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.arena_telemetry import _cap_times


def test_empty_pilot_metrics_is_read_only_and_has_no_invented_measurements():
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import Session
    from app.db import Base
    from app.services.arena_telemetry import pilot_metrics
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    writes = []
    @event.listens_for(engine, "before_cursor_execute")
    def observe(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().split()[0].upper() in {"INSERT", "UPDATE", "DELETE"}:
            writes.append(statement)
    with Session(engine) as db:
        result = pilot_metrics(db)
    assert result["finished_battles"] == 0 and result["median_rounds"] is None
    assert result["patron_results"] == [] and result["ledger"] == []
    assert not writes
    engine.dispose()


def test_three_paid_wins_mark_daily_cap_without_a_fourth_zero_entitlement():
    at = datetime(2026, 10, 12, tzinfo=timezone.utc)
    rights = [SimpleNamespace(id=str(index), user_id="player", created_at=at+timedelta(minutes=index),
        period_day=at.date(), period_week=at.date(), amount=8, reason="AWARDED") for index in range(3)]
    caps = _cap_times(rights)
    assert caps == {("player", "DAY", at.date()): at+timedelta(minutes=2)}


def test_pilot_counts_frozen_real_squad_budget_and_patron_outcome():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.battle_models import BattleMatch
    from app.db import Base
    from app.models import utcnow
    from app.services.arena_telemetry import pilot_metrics
    from app.services.card_battle import initial_state
    heroes = [{"id": str(index), "hero_key": key, "rank": "SSS" if index < 2 else "F",
        "line": index//2, "position": "FRONT" if index%2 == 0 else "BACK"}
        for index, key in enumerate(("abrams", "bebop", "dynamo", "haze", "ivy", "seven"))]
    state = initial_state(heroes, heroes, base_a="ARCHMOTHER", base_b="ORDINARY")
    engine = create_engine("sqlite:///:memory:"); Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(BattleMatch(mode="TRAINING", status="FINISHED", state=state, snapshot={}, completed_at=utcnow(),
            outcome="WIN", result={"winner_side": "A", "reason": "BASE_DESTROYED"}))
        db.flush()
        result = pilot_metrics(db)
        assert result["squad_budgets"] == {"24": 1, "22": 1}
        assert result["patron_results"][0] == {"mode": "TRAINING", "patron": "ARCHMOTHER", "wins": 1, "losses": 0, "draws": 0}
    engine.dispose()


def test_weekly_cap_is_scoped_to_original_period_and_does_not_reset_after_correction():
    at = datetime(2026, 10, 12, tzinfo=timezone.utc)
    rights = [SimpleNamespace(id=str(index), user_id="player", created_at=at+timedelta(minutes=index),
        period_day=(at+timedelta(days=index//3)).date(), period_week=at.date(), amount=8,
        status="CORRECTED" if index == 0 else "DELIVERED", reason="AWARDED") for index in range(15)]
    caps = _cap_times(reversed(rights))
    assert caps[("player", "WEEK", at.date())] == at+timedelta(minutes=14)
    assert ("player", "DAY", (at+timedelta(days=5)).date()) not in caps
