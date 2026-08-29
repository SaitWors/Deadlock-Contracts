from app.services.providers import DeadlockApiProvider, HistoryResult


def test_exact_match_uses_history_when_metadata_is_missing():
    provider = object.__new__(DeadlockApiProvider)

    provider.metadata = (
        lambda match_id, disable_steam=False: None
    )

    provider.history = (
        lambda account_id, force_refetch=False: HistoryResult(
            matches=[
                {
                    "account_id": 42,
                    "match_id": 102442126,
                    "start_time": 1788026400,
                    "match_mode": 1,
                    "game_mode": 4,
                    "match_duration_s": 778,
                    "player_kills": 4,
                    "player_deaths": 3,
                    "player_assists": 8,
                    "net_worth": 34000,
                    "player_match_outcome": 1,
                }
            ],
            called_steam=False,
            status_code=200,
            retry_after=None,
        )
    )

    match = provider.fetch_match_by_id(
        42,
        102442126,
        disable_steam=True,
        consult_history=True,
    )

    assert match is not None
    assert match["external_match_id"] == 102442126
    assert match["started_at"] is not None
    assert match["duration_s"] == 778
    assert match["game_match_mode"] == "STREET_BRAWL"

    participant = match["participant"]

    assert participant["kills"] == 4
    assert participant["deaths"] == 3
    assert participant["assists"] == 8
    assert participant["won"] is True
