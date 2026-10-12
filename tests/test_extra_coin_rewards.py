from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import ArchiveCipher, ArchiveLedger, OutboxEvent, User


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'extra.db'}")
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as session:
        yield session
    engine.dispose()


def services():
    from app.services import coin_rewards, extra_coin_rewards
    return coin_rewards, extra_coin_rewards


def cipher(db, user, at):
    row = ArchiveCipher(user_id=user.id, week=at.date()-timedelta(days=at.weekday()), slot=1,
                        solution=[0, 1, 2, 3], guesses=[[0, 1, 2, 3]], status="SOLVED", completed_at=at)
    db.add(row)
    db.flush()
    return row


def delivered(db):
    coins, _ = services()
    for event in list(db.scalars(select(OutboxEvent).where(OutboxEvent.event_type == "coin.reward"))):
        coins.deliver_entitlement(db, event.payload["entitlement_id"])
    db.flush()


def test_cipher_activity_is_once_per_original_utc_day_and_read_is_inert(db):
    coins, extra = services()
    user = User(); db.add(user); db.flush()
    at = datetime(2026, 10, 12, 23, 59, tzinfo=timezone.utc)
    source = cipher(db, user, at)
    extra.record_cipher(db, source)
    extra.record_cipher(db, source)
    before = db.scalar(select(func.count()).select_from(OutboxEvent))
    extra.status(db, user.id, now=at + timedelta(days=1))
    assert db.scalar(select(func.count()).select_from(OutboxEvent)) == before == 1
    delivered(db); delivered(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 10
    receipts = coins.status(db, user.id)["receipts"]
    assert receipts[0]["period_day"] == "2026-10-12"


def test_two_cipher_sources_same_day_do_not_repeat_daily_benefit(db):
    _, extra = services()
    user = User(); db.add(user); db.flush()
    at = datetime(2026, 10, 12, 15, tzinfo=timezone.utc)
    first = cipher(db, user, at)
    second = ArchiveCipher(user_id=user.id, week=first.week, slot=2, solution=[0, 1, 2, 3],
                           guesses=[[0, 1, 2, 3]], status="ASSISTED", completed_at=at)
    db.add(second); db.flush()
    extra.record_cipher(db, first); extra.record_cipher(db, second)
    delivered(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 10


def test_invalid_cipher_cannot_mint_daily_award_and_delivery_rechecks_result(db):
    coins, extra = services()
    user = User(); db.add(user); db.flush()
    source = cipher(db, user, datetime(2026, 10, 12, tzinfo=timezone.utc))
    source.status = "OPEN"; db.flush()
    assert extra.record_cipher(db, source) is None
    source.status = "SOLVED"; db.flush()
    extra.record_cipher(db, source)
    source.status = "OPEN"; db.flush()
    delivered(db)
    assert not db.scalar(select(func.count()).select_from(ArchiveLedger))
    assert coins.status(db, user.id)["receipts"][0]["status"] == "INVALIDATED"


def test_generic_quota_persists_zero_and_never_reissues_after_reset(db):
    _, extra = services()
    user = User(); db.add(user); db.flush()
    at = datetime(2026, 10, 12, tzinfo=timezone.utc)
    source = cipher(db, user, at)
    fact = extra.record_fact(db, user.id, "CIPHER", source.id, at)
    rows = [extra.reserve(db, user.id, "pve", str(uuid4()), 8, at,
                         [fact.id], quota_source="PVE", daily_limit=24, weekly_limit=120)
            for _ in range(4)]
    assert [row.amount for row in rows] == [8, 8, 8, 0]
    replay = extra.reserve(db, user.id, "pve", rows[-1].source_id, 8, at+timedelta(days=1),
                           [fact.id], quota_source="PVE", daily_limit=24, weekly_limit=120)
    assert replay.id == rows[-1].id and replay.amount == 0 and replay.period_day == at.date()


def test_confirmed_contracts_unlock_weekly_and_milestone_once_even_after_coin_cap(db):
    from test_coin_rewards import setup
    from app.coin_models import CoinEntitlement
    coins, extra = services()
    user = None
    options = []
    for count in (3, 3, 3, 1):
        user, _, batch, _ = setup(db, user=user, count=count)
        options.extend(batch)
    for option in options:
        coins.settle_assignment(db, option.id)
        extra.record_assignment(db, option.id)
    assert extra.confirmed_contract_count(db, user.id) == 10
    for option in options:
        extra.record_assignment(db, option.id)
    assert len(list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.source_type == "daily")))) == 1
    weekly = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.source_type == "weekly")))
    milestones = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.source_type == "milestone")))
    assert [row.amount for row in weekly] == [60]
    assert [row.amount for row in milestones] == [50]
    delivered(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.reason == "CONTRACT_MILESTONE")) == 50


def test_correction_reverses_linked_activity_rewards_without_returning_quota(db):
    from test_coin_rewards import setup
    from app.coin_models import CoinEntitlement
    coins, extra = services()
    user, _, options, _ = setup(db)
    receipt = coins.settle_assignment(db, options[0].id)
    extra.record_assignment(db, options[0].id)
    delivered(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 20
    coins.correct_entitlement(db, receipt["id"], request_key=str(uuid4()), actor_user_id=user.id,
                              reason="Independent result revoked")
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 0
    daily = db.scalar(select(CoinEntitlement).where(CoinEntitlement.source_type == "daily"))
    assert daily.status == "CORRECTED"
    assert extra.status(db, user.id, now=options[0].settled_at)["source_quotas"]["DAILY"]["daily"]["used"] == 10


def test_mock_and_client_only_contracts_never_advance_milestones(db):
    from test_coin_rewards import setup
    coins, extra = services()
    user, _, options, _ = setup(db, provider="mock")
    coins.settle_assignment(db, options[0].id)
    extra.record_assignment(db, options[0].id)
    assert extra.confirmed_contract_count(db, user.id) == 0
    assert extra.status(db, user.id)["progress"]["weekly_contracts"] == 0


def test_correction_cascades_over_daily_weekly_and_milestone_without_double_reversal(db):
    from app.coin_models import CoinEntitlement
    from test_coin_rewards import setup
    coins, extra = services()
    user, options = None, []
    for count in (3, 3, 3, 1):
        user, _, batch, _ = setup(db, user=user, count=count)
        options.extend(batch)
    for option in options:
        coins.settle_assignment(db, option.id); extra.record_assignment(db, option.id)
    delivered(db)
    original = db.scalar(select(CoinEntitlement).where(CoinEntitlement.source_type == "assignment", CoinEntitlement.source_id == options[0].id))
    key = str(uuid4())
    first = coins.correct_entitlement(db, original.id, request_key=key, actor_user_id=user.id, reason="Independent source revoked")
    assert coins.correct_entitlement(db, original.id, request_key=key, actor_user_id=user.id, reason="Independent source revoked") == first
    dependent = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.source_type.in_(["daily", "weekly", "milestone"]))))
    assert all(row.status == "CORRECTED" for row in dependent)
    assert extra.confirmed_contract_count(db, user.id) == 9


def battle(db, user, at, *, slot=1, mode="ASSIGNED", scope="REAL", outcome="WIN"):
    from app.battle_models import BattleAssignment, BattleMatch
    assignment = None
    if mode in {"ASSIGNED", "HARD", "WEEKLY"}:
        assignment = BattleAssignment(user_id=user.id, period_day=at.date(), slot=slot,
            mode="ASSIGNED" if mode == "WEEKLY" else mode, scope=scope, opponent={}, status="COMPLETED", completed_at=at)
        db.add(assignment); db.flush()
    match = BattleMatch(user_id=user.id, mode=mode, scope=scope, state={}, snapshot={}, status="FINISHED",
        outcome=outcome, reward_eligible=bool(assignment), assignment_id=assignment.id if assignment else None,
        result={"winner_side": "A" if outcome == "WIN" else "B", "reason": "BASE_DESTROYED"}, completed_at=at)
    db.add(match); db.flush()
    if assignment:
        assignment.winning_match_id = match.id
    db.flush()
    return match


def test_pve_weekly_cap_and_daily_slots_are_independent_and_replay_safe(db):
    _, extra = services()
    user = User(); db.add(user); db.flush()
    start = datetime(2026, 10, 12, 15, tzinfo=timezone.utc)
    receipts = []
    for index in range(16):
        match = battle(db, user, start+timedelta(days=index//3), slot=index%3+1,
                       mode="ASSIGNED" if index%2 else "HARD")
        receipt = extra.settle_battle(db, match)
        assert receipt == extra.settle_battle(db, match)
        receipts.append(receipt)
    assert [row["amount"] for row in receipts] == [8]*15+[0]
    assert receipts[-1]["reason"] == "WEEKLY_LIMIT"
    assert extra.status(db, user.id, now=start)["progress"]["eligible_pve_wins"] == 16
    delivered(db); delivered(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.reason == "PVE_WIN")) == 120
    assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.reason == "WEEKLY_COMMISSION")) == 60


@pytest.mark.parametrize("mode,scope", [("TRAINING", "REAL"), ("FRIENDLY", "REAL"), ("ASSIGNED", "SANDBOX")])
def test_unrewarded_modes_and_sandbox_never_advance_pve_progress(db, mode, scope):
    _, extra = services()
    user = User(); db.add(user); db.flush()
    match = battle(db, user, datetime(2026, 10, 12, tzinfo=timezone.utc), mode=mode, scope=scope)
    assert extra.settle_battle(db, match) is None
    assert extra.status(db, user.id)["progress"]["eligible_pve_wins"] == 0
    assert not db.scalar(select(func.count()).select_from(OutboxEvent))


def test_tutorial_route_needs_learning_then_normal_completion_and_pays_once(db):
    _, extra = services()
    user = User(); db.add(user); db.flush()
    start = datetime(2026, 10, 12, tzinfo=timezone.utc)
    early = battle(db, user, start, mode="TRAINING")
    assert extra.settle_battle(db, early) is None
    tutorial = battle(db, user, start+timedelta(minutes=10), mode="TUTORIAL")
    assert extra.settle_battle(db, tutorial) is None
    normal = battle(db, user, start+timedelta(minutes=20), mode="TRAINING")
    receipt = extra.settle_battle(db, normal)
    assert receipt["amount"] == 60
    assert extra.settle_battle(db, normal)["id"] == receipt["id"]
    delivered(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta))) == 60


def test_invalid_fourth_assignment_and_midnight_carry_cannot_bypass_daily_right(db):
    _, extra = services()
    user = User(); db.add(user); db.flush()
    at = datetime(2026, 10, 12, 23, 59, tzinfo=timezone.utc)
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError), db.begin_nested():
        battle(db, user, at, slot=4)
    late = battle(db, user, at, slot=1)
    late.completed_at = at+timedelta(minutes=2); db.flush()
    assert extra.settle_battle(db, late) is None
    assert extra.status(db, user.id)["progress"]["eligible_pve_wins"] == 0


def test_weekly_loan_win_uses_existing_pve_budget(db):
    _, extra = services()
    user = User(); db.add(user); db.flush()
    at = datetime(2026, 10, 12, 15, tzinfo=timezone.utc)
    match = battle(db, user, at, mode="WEEKLY")
    receipt = extra.settle_battle(db, match)
    assert receipt["amount"] == 8
    assert extra.status(db, user.id, now=at)["source_quotas"]["PVE"]["daily"]["used"] == 8
    assert extra.eligible_pve_win_count(db, user.id) == 1


def test_losing_retry_never_displays_winning_match_receipt(db):
    from app.battle_models import BattleMatch
    _, extra = services()
    user = User(); db.add(user); db.flush()
    at = datetime(2026, 10, 12, 15, tzinfo=timezone.utc)
    winning = battle(db, user, at)
    losing = BattleMatch(user_id=user.id, mode="ASSIGNED", state={}, snapshot={}, status="FINISHED",
        assignment_id=winning.assignment_id, reward_eligible=True, outcome="LOSS", completed_at=at-timedelta(minutes=5),
        result={"winner_side": "B", "reason": "BASE_DESTROYED"})
    db.add(losing); db.flush()
    receipt = extra.settle_battle(db, winning)
    assert extra.battle_receipt(db, winning.id, user.id) == receipt
    assert extra.battle_receipt(db, losing.id, user.id) is None


def test_bureau_requires_personal_verified_contribution_and_is_once_per_week(db):
    from app.coin_models import CoinEntitlement
    from app.models import BureauContribution, BureauOperation, BureauOperationParticipant
    from test_coin_rewards import setup
    coins, extra = services()
    user, _, options, _ = setup(db)
    coins.settle_assignment(db, options[0].id)
    at = options[0].settled_at
    for index in range(2):
        operation = BureauOperation(template="quarter_defence", target=20, min_contributors=3,
            status="COMPLETED", started_at=at-timedelta(days=1), ends_at=at+timedelta(days=1), completed_at=at)
        db.add(operation); db.flush()
        participant = BureauOperationParticipant(operation_id=operation.id, user_id=user.id)
        db.add(participant); db.flush()
        extra.record_bureau(db, operation)
        assert len(list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.source_type == "bureau")))) == index
        db.add(BureauContribution(operation_id=operation.id, participant_id=participant.id,
            source_key=str(uuid4()), source_option_id=options[0].id, credited=True, played_at=at))
        db.flush()
        extra.record_bureau(db, operation); extra.record_bureau(db, operation)
    rights = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.source_type == "bureau")))
    assert len(rights) == 1 and rights[0].amount == 40
    delivered(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.reason == "BUREAU_OPERATION")) == 40


def test_corrected_bureau_operation_reverses_every_participant_reward_once(db):
    from app.coin_models import CoinEntitlement
    from app.models import BureauContribution, BureauOperation, BureauOperationParticipant
    from test_coin_rewards import setup
    coins, extra = services()
    at = datetime(2026, 10, 12, 15, tzinfo=timezone.utc)
    operation = BureauOperation(template="quarter_defence", target=20, min_contributors=3,
        status="COMPLETED", started_at=at-timedelta(days=1), ends_at=at+timedelta(days=1), completed_at=at)
    db.add(operation); db.flush()
    for _ in range(2):
        user, _, options, _ = setup(db)
        coins.settle_assignment(db, options[0].id)
        participant = BureauOperationParticipant(operation_id=operation.id, user_id=user.id)
        db.add(participant); db.flush()
        db.add(BureauContribution(operation_id=operation.id, participant_id=participant.id,
            source_key=str(uuid4()), source_option_id=options[0].id, credited=True, played_at=at))
    db.flush()
    extra.record_bureau(db, operation); delivered(db)
    assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.reason == "BUREAU_OPERATION")) == 80
    operation.status = "CORRECTED"; db.flush()
    extra.record_bureau(db, operation); extra.record_bureau(db, operation)
    rows = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.source_type == "bureau")))
    assert len(rows) == 2 and all(row.status == "CORRECTED" for row in rows)
    assert db.scalar(select(func.sum(ArchiveLedger.delta)).where(ArchiveLedger.reason == "COIN_CORRECTION")) == -80
