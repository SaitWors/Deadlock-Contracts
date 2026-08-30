from app.worker import _provisional_provider_retry_delay


def test_provisional_provider_retry_schedule_is_fast_then_bounded() -> None:
    assert [
        _provisional_provider_retry_delay(attempt)
        for attempt in range(1, 10)
    ] == [10, 20, 40, 60, 120, 300, 600, 600, 600]


def test_provider_retry_after_overrides_fast_poll_without_exceeding_one_hour() -> None:
    assert _provisional_provider_retry_delay(1, 75) == 75
    assert _provisional_provider_retry_delay(4, 5) == 60
    assert _provisional_provider_retry_delay(2, 99999) == 3600
