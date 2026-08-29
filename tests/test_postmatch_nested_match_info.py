from app.services.normalization import normalize_deadlock_match


def test_exact_metadata_uses_nested_match_info_without_history():
    metadata = {
        "match_info": {
            "match_id": 123,
            "start_time": 1_780_000_000,
            "duration_s": 2114,
            "match_mode": 1,
            "game_mode": 1,
            "players": [
                {
                    "account_id": 42,
                    "kills": 10,
                    "deaths": 3,
                    "assists": 18,
                    "player_match_outcome": 1,
                }
            ],
        }
    }

    match = normalize_deadlock_match(
        42,
        {"match_id": 123},
        metadata,
    )

    assert match["external_match_id"] == 123
    assert match["started_at"] is not None
    assert match["duration_s"] == 2114
    assert match["game_match_mode"] == "STANDARD"

    participant = match["participant"]

    assert participant["kills"] == 10
    assert participant["deaths"] == 3
    assert participant["assists"] == 18
    assert participant["won"] is True