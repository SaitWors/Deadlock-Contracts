from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from relay.scheduler import Candidate, QuotaLedger, order_candidates


NOW = datetime(2026, 11, 27, 9, tzinfo=timezone.utc)
ACCOUNT = 76561198000000000
FIRST = UUID(int=1)
SECOND = UUID(int=2)


def initialize(path, *, history=(), metadata=()):
    return QuotaLedger.initialize(
        path, account_id=ACCOUNT, now=NOW, history_spent_at=history, metadata_spent_at=metadata,
    )


def reserve(ledger, cycle, kind, target=42, *, urgency=NOW, now=NOW, confirmed=(FIRST,)):
    return ledger.try_reserve(
        cycle, Candidate(kind, target, FIRST, urgency), confirmed_connections=confirmed, now=now,
    )


def test_pilot_queue_prioritizes_oldest_waiting_contracts_and_deduplicates_targets():
    oldest = NOW - timedelta(minutes=30)
    candidates = [
        Candidate("metadata", 10, FIRST, None),
        Candidate("metadata", 10, SECOND, NOW),
        Candidate("history", 20, FIRST, oldest),
        Candidate("metadata", 30, FIRST, oldest),
        Candidate("metadata", 40, UUID(int=3), oldest),
        Candidate("metadata", 50, None, oldest),
        Candidate("history", 60, SECOND, None),
    ]

    ordered = order_candidates(candidates, confirmed_connections=(FIRST, SECOND))

    assert [candidate.target_id for candidate in ordered] == [30, 20, 10, 60]
    assert ordered[2].connection_id == SECOND


@pytest.mark.parametrize(("kind", "hard_limit", "reserved"), [("history", 20, 4), ("metadata", 40, 8)])
def test_shared_rolling_limit_keeps_reserved_slots_for_waiting_contracts(tmp_path, kind, hard_limit, reserved):
    spent = (NOW - timedelta(hours=4),) * (hard_limit - reserved)
    path = tmp_path / "quota.db"
    ledger = initialize(path, **{kind: spent})
    cycle = ledger.begin_cycle(now=NOW)

    assert not reserve(ledger, cycle, kind, urgency=None)
    assert all(reserve(ledger, cycle, kind, target) for target in range(1, reserved + 1))
    reopened = QuotaLedger(path, account_id=ACCOUNT)
    assert not reserve(reopened, cycle, kind, 100)

    first_expiry = NOW + timedelta(hours=20)
    cycle = reopened.begin_cycle(now=first_expiry)
    assert reserve(reopened, cycle, kind, 101, now=first_expiry)


@pytest.mark.parametrize(("kind", "per_cycle"), [("history", 1), ("metadata", 2)])
def test_background_spend_is_paced_without_delaying_waiting_contracts(tmp_path, kind, per_cycle):
    ledger = initialize(tmp_path / "quota.db")
    cycle = ledger.begin_cycle(now=NOW)

    assert all(reserve(ledger, cycle, kind, target, urgency=None) for target in range(1, per_cycle + 1))
    assert not reserve(ledger, cycle, kind, 41, urgency=None)
    assert reserve(ledger, cycle, kind, 42)


def test_history_waits_when_no_usable_metadata_quota_remains(tmp_path):
    ledger = initialize(tmp_path / "quota.db", metadata=(NOW,) * 32)
    cycle = ledger.begin_cycle(now=NOW)

    assert not reserve(ledger, cycle, "history", urgency=None)
    assert reserve(ledger, cycle, "history")
    ledger.record_rate_limit("metadata", now=NOW)
    assert not reserve(ledger, cycle, "history", 43)


def test_one_cycle_per_hour_and_stale_plan_cannot_spend_after_restart(tmp_path):
    path = tmp_path / "quota.db"
    ledger = initialize(path)
    first_cycle = ledger.begin_cycle(now=NOW)
    restarted = QuotaLedger(path, account_id=ACCOUNT)

    assert first_cycle is not None
    assert restarted.begin_cycle(now=NOW + timedelta(minutes=59)) is None
    next_hour = NOW + timedelta(hours=1)
    assert not reserve(restarted, first_cycle, "metadata", now=next_hour)
    second_cycle = restarted.begin_cycle(now=next_hour)
    assert second_cycle is not None
    assert reserve(restarted, second_cycle, "metadata", now=next_hour)


def test_rechecks_consent_and_rejects_duplicate_attempts_in_one_cycle(tmp_path):
    ledger = initialize(tmp_path / "quota.db")
    cycle = ledger.begin_cycle(now=NOW)

    assert not reserve(ledger, cycle, "metadata", confirmed=(SECOND,))
    assert reserve(ledger, cycle, "metadata")
    assert not reserve(ledger, cycle, "metadata")


def test_concurrent_attempts_cannot_both_consume_the_last_slot(tmp_path):
    path = tmp_path / "quota.db"
    ledger = initialize(path, metadata=(NOW,) * 39)
    cycle = ledger.begin_cycle(now=NOW)

    def attempt(target):
        return reserve(QuotaLedger(path, account_id=ACCOUNT), cycle, "metadata", target)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(attempt, (41, 42)))

    assert results.count(True) == 1


def test_rate_limit_keeps_kind_blocked_for_a_full_window_across_restart(tmp_path):
    path = tmp_path / "quota.db"
    ledger = initialize(path)
    cycle = ledger.begin_cycle(now=NOW)
    ledger.record_rate_limit("history", now=NOW)

    reopened = QuotaLedger(path, account_id=ACCOUNT)
    assert not reserve(reopened, cycle, "history")
    assert reserve(reopened, cycle, "metadata")
    before_expiry = NOW + timedelta(hours=23, minutes=59)
    cycle = reopened.begin_cycle(now=before_expiry)
    assert not reserve(reopened, cycle, "history", now=before_expiry)
    expiry = NOW + timedelta(hours=24)
    assert reserve(reopened, cycle, "history", now=expiry)


def test_missing_mismatched_or_backward_state_never_starts_a_clean_quota(tmp_path):
    path = tmp_path / "quota.db"
    with pytest.raises(RuntimeError, match="quota ledger"):
        QuotaLedger(path, account_id=ACCOUNT).begin_cycle(now=NOW)
    assert not path.exists()
    ledger = initialize(path)
    with pytest.raises(FileExistsError):
        initialize(path)
    with pytest.raises(RuntimeError, match="quota ledger"):
        QuotaLedger(path, account_id=ACCOUNT + 1).begin_cycle(now=NOW)
    assert ledger.begin_cycle(now=NOW) is not None
    with pytest.raises(RuntimeError, match="Clock"):
        ledger.begin_cycle(now=NOW - timedelta(seconds=1))


def test_corrupt_state_is_neither_transparently_reset_nor_replaced(tmp_path):
    path = tmp_path / "quota.db"
    original = b"unreadable ledger"
    path.write_bytes(original)

    with pytest.raises(RuntimeError, match="quota ledger"):
        QuotaLedger(path, account_id=ACCOUNT).begin_cycle(now=NOW)
    assert path.read_bytes() == original


def test_abandoned_charge_counts_through_the_rolling_window(tmp_path):
    path = tmp_path / "quota.db"
    ledger = initialize(path, metadata=(NOW,) * 39)
    cycle = ledger.begin_cycle(now=NOW)
    assert reserve(ledger, cycle, "metadata")

    restarted = QuotaLedger(path, account_id=ACCOUNT)
    until = NOW + timedelta(hours=24)
    before = until - timedelta(seconds=1)
    cycle = restarted.begin_cycle(now=before)
    assert not reserve(restarted, cycle, "metadata", now=before, target=43)
    assert reserve(restarted, cycle, "metadata", now=until, target=43)
