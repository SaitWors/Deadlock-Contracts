from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import ArchiveCard, ArchiveItem, ArchiveOperation, User, utcnow
from app.services.providers import DeadlockApiProvider, ProviderError, ProviderRateLimited
from test_archive import action, create, decide
from test_bureau_operations import elevate
from test_player_community import community  # real auth and isolated DB


NOW = datetime(2026, 11, 28, 12, tzinfo=timezone.utc)


def stats(hero_id, matches_played, last_played=100):
    return {"account_id": 123, "hero_id": hero_id, "matches_played": matches_played, "last_played": last_played}


def test_selects_most_played_known_hero_with_recent_then_id_tiebreak():
    from app.services.foundation_banner import most_played_hero

    assert most_played_hero([stats(13, 6), stats(6, 4, 200)]) == 13
    assert most_played_hero([stats(6, 3, 100), stats(13, 3, 200)]) == 13
    assert most_played_hero([stats(13, 3, 200), stats(6, 3, 200)]) == 6
    assert most_played_hero([stats(13, 4), stats(123456, 99)]) is None
    assert most_played_hero([stats(13, 8), stats(123456, 99)]) is None


def test_hero_refresh_widens_real_insufficient_samples_and_distinguishes_empty():
    from app.services.foundation_banner import favorite_from_provider

    provider = Mock()
    provider.hero_stats.side_effect = [[stats(13, 4)], [stats(6, 6), stats(13, 4)]]
    assert favorite_from_provider(provider, 123, NOW) == 6
    assert [call.args[1] for call in provider.hero_stats.call_args_list] == [
        int((NOW - timedelta(days=30)).timestamp()),
        int((NOW - timedelta(days=90)).timestamp()),
    ]
    provider.reset_mock(side_effect=True)
    provider.hero_stats.side_effect = [[], [], []]
    assert favorite_from_provider(provider, 123, NOW) is None
    assert provider.hero_stats.call_args_list[-1].args == (123, None)


@pytest.mark.parametrize("status", [429, 503, 504])
def test_provider_respects_load_shedding_and_uses_documented_scope(status):
    def respond(request):
        assert request.url.path == "/v1/players/hero-stats"
        assert dict(request.url.params) == {
            "account_ids": "123", "game_mode": "normal", "match_mode": "ranked,unranked",
            "min_unix_timestamp": "100",
        }
        return httpx.Response(status, headers={"Retry-After": "5400"}, text="retry later")

    provider = DeadlockApiProvider()
    provider.client.close()
    with httpx.Client(base_url="https://provider.example", transport=httpx.MockTransport(respond)) as client:
        provider.client = client
        with pytest.raises(ProviderRateLimited) as failure:
            provider.hero_stats(123, 100)
    assert failure.value.retry_after == 5400


@pytest.mark.parametrize("response", [{}, [{"hero_id": 6}], [stats(6, True)],
                                      [stats(6, 3), stats(6, 6)], [{**stats(6, 7), "account_id": 456}]])
def test_provider_rejects_malformed_or_wrong_account_hero_stats(response):
    provider = DeadlockApiProvider()
    provider.client.close()
    with httpx.Client(base_url="https://provider.example",
                      transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response))) as client:
        provider.client = client
        with pytest.raises(ProviderError):
            provider.hero_stats(123, None)


def test_provider_timeout_uses_existing_transport_error_handling():
    def timeout(request):
        raise httpx.ReadTimeout("simulated timeout", request=request)

    provider = DeadlockApiProvider()
    provider.client.close()
    with httpx.Client(base_url="https://provider.example", transport=httpx.MockTransport(timeout)) as client:
        provider.client = client
        with pytest.raises(ProviderError):
            provider.hero_stats(123, None)


def test_daily_art_rotation_handles_duplicate_illustration_and_utc_rollover():
    from app.services.foundation_banner import rotated_card

    cards = [SimpleNamespace(id="one", image_digest="same"), SimpleNamespace(id="two", image_digest="same"),
             SimpleNamespace(id="three", image_digest="another")]
    today = date(2026, 11, 28)
    current = rotated_card(cards, "player", today)
    assert rotated_card(cards, "player", today).id == current.id
    assert rotated_card(cards, "player", today + timedelta(days=1)).image_digest != current.image_digest
    assert rotated_card([], "player", today) is None


def test_pick_modes_visibility_consent_and_removal_are_account_scoped(community):
    factory, player = community
    account, client = player()
    other_account, other = player()
    with factory() as db:
        eligible, plain, draft = [ArchiveCard(
            hero="abrams", rank="F", title="Artwork", artist="Artist", rights_confirmed=True,
            banner_artwork=allowed, status=status, image_digest=str(index) * 64, image_data=b"data",
        ) for index, (allowed, status) in enumerate(((True, "PUBLISHED"), (False, "PUBLISHED"), (True, "DRAFT")))]
        db.add_all([eligible, plain, draft])
        operation = ArchiveOperation(user_id=account, kind="TEST", request_key="banner-collection", signature="fixture")
        db.add(operation)
        db.flush()
        db.add(ArchiveItem(user_id=account, card_id=eligible.id, operation_id=operation.id))
        db.commit()
        eligible_id, plain_id, draft_id = eligible.id, plain.id, draft.id

    def choose(mode, card_id=None, browser=client):
        return browser.put("/api/foundation/banner/preferences", json=dict(mode=mode, card_id=card_id))

    assert choose("selected_card", plain_id).status_code == 422
    assert choose("selected_card", draft_id).status_code == 422
    assert choose("selected_card", eligible_id).status_code == 200
    active = client.get("/api/foundation/banner").json()
    assert active["account_key"] == account and active["card"]["id"] == eligible_id
    assert client.get(active["card"]["image_url"]).status_code == 200
    assert choose("collection").status_code == 200
    assert client.get("/api/foundation/banner").json()["card"]["id"] == eligible_id
    assert choose("collection", browser=other).status_code == 200
    assert other.get("/api/foundation/banner").json() == {
        "account_key": other_account, "mode": "collection", "card": None, "refreshing": False,
    }
    assert choose("random_hero").status_code == 200
    assert client.get("/api/foundation/banner").json()["card"]["id"] == eligible_id
    with factory() as db:
        db.get(ArchiveCard, eligible_id).status = "ARCHIVED"
        db.commit()
    assert client.get("/api/foundation/banner").json()["card"] is None
    assert client.get(active["card"]["image_url"]).status_code == 404
    assert choose("off").status_code == 200
    assert client.get("/api/foundation/banner").json()["mode"] == "off"


def test_cache_claim_is_single_flight_persistent_and_account_identity_scoped(community):
    from app.foundation_banner_models import FoundationBanner
    from app.services.foundation_banner import claim_refresh, save_refresh

    factory, player = community
    user_id, _ = player()
    with factory() as db:
        db.get(User, user_id).account_id = 123
        db.commit()
        account_id = db.scalar(select(User.account_id).where(User.id == user_id))
        assert claim_refresh(db, user_id, account_id, NOW)
    with factory() as db:
        assert not claim_refresh(db, user_id, account_id, NOW)
        save_refresh(db, user_id, account_id, NOW, hero_id=6)
        assert not claim_refresh(db, user_id, account_id, NOW + timedelta(hours=23))
        assert claim_refresh(db, user_id, account_id, NOW + timedelta(hours=25))
        save_refresh(db, user_id, account_id, NOW + timedelta(hours=25), retry_after=7200)
        row = db.get(FoundationBanner, user_id)
        assert row.hero_id == 6
        assert not claim_refresh(db, user_id, account_id, NOW + timedelta(hours=26))
        assert claim_refresh(db, user_id, account_id, NOW + timedelta(hours=28))


def test_negative_provider_cache_and_global_retry_after(community):
    from app.foundation_banner_models import FoundationBanner
    from app.services.foundation_banner import claim_refresh, save_refresh

    factory, player = community
    user_id, _ = player()
    other_id, _ = player()
    with factory() as db:
        db.get(User, user_id).account_id = 123
        db.get(User, other_id).account_id = 234
        db.commit()
        assert claim_refresh(db, user_id, 123, NOW)
        save_refresh(db, user_id, 123, NOW)
        assert db.get(FoundationBanner, user_id).hero_id is None
        assert not claim_refresh(db, user_id, 123, NOW + timedelta(hours=23))
        assert claim_refresh(db, user_id, 123, NOW + timedelta(days=1))
        save_refresh(db, user_id, 123, NOW + timedelta(days=1), retry_after=7200)
        assert not claim_refresh(db, other_id, 234, NOW + timedelta(hours=25))
        assert claim_refresh(db, other_id, 234, NOW + timedelta(hours=27))


def test_simultaneous_db_sessions_claim_one_refresh(tmp_path):
    from app.services.foundation_banner import claim_refresh

    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'banner.db').as_posix()}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(account_id=123)
        db.add(user)
        db.flush()
        user_id = user.id
        db.commit()
    gate = Barrier(2)

    def request_refresh(_):
        with Session(engine) as db:
            gate.wait(timeout=5)
            return claim_refresh(db, user_id, 123, NOW)

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(request_refresh, range(2))) == [False, True]
    engine.dispose()


def test_linked_account_change_discards_hero_and_daily_pick(community, monkeypatch):
    from app.foundation_banner_models import FoundationBanner
    from app.services import foundation_banner as service

    factory, player = community
    user_id, client = player()
    now = utcnow()
    with factory() as db:
        db.get(User, user_id).account_id = 123
        card = ArchiveCard(hero="haze", rank="F", title="Haze", artist="Artist",
                           banner_artwork=True, rights_confirmed=True, status="PUBLISHED",
                           image_digest="one", image_data=b"art")
        db.add(card)
        db.flush()
        db.add(FoundationBanner(user_id=user_id, stat_account_id=123, hero_id=13,
                                hero_observed_at=now, next_refresh_at=now + timedelta(hours=12)))
        db.commit()
        card_id = card.id
    assert client.get("/api/foundation/banner").json()["card"]["id"] == card_id
    monkeypatch.setattr(service.DeadlockApiProvider, "hero_stats", lambda *_: [])
    with factory() as db:
        db.get(User, user_id).account_id = 456
        db.commit()
    assert client.get("/api/foundation/banner").json()["card"] is None
    with factory() as db:
        row = db.get(FoundationBanner, user_id)
        assert row.stat_account_id == 456 and row.hero_id is None


def test_published_art_requires_explicit_author_consent_and_can_be_revoked(community):
    factory, player = community
    _, author = player()
    _, stranger = player()
    admin_id, admin = player()
    elevate(factory, admin_id, admin, role="ADMIN")
    draft = create(author)
    pending = action(author, draft, "submit").json()["card"]
    published = decide(admin, pending, "PUBLISH").json()["card"]
    path = f"/api/archive/cards/{published['id']}/banner-permission"
    payload = {"revision": published["revision"], "enabled": True}
    assert author.get("/api/foundation/banner/options").json()["items"] == []
    assert stranger.put(path, json=payload).status_code == 404
    updated = author.put(path, json=payload).json()["card"]
    illustration = stranger.get("/api/foundation/banner/options").json()["items"][0]
    assert stranger.get(illustration["image_url"]).status_code == 200
    assert author.put(path, json={"revision": updated["revision"], "enabled": False}).status_code == 200
    assert stranger.get(illustration["image_url"]).status_code == 404
