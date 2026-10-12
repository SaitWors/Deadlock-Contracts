from uuid import uuid4
from copy import deepcopy
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from arena_fixtures import original_card_id as card_id, seed_original_catalogue


@pytest.fixture()
def db():
    from app.db import Base
    import app.battle_models  # noqa: F401
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as session:
        yield session
    engine.dispose()


def service():
    from app.services import battle_service
    return battle_service


def player(db):
    from app.models import User
    user = User(account_id=uuid4().int % 10**9)
    db.add(user)
    db.flush()
    return user


def seed(db):
    from app.services.battle_catalog import seed_battle_catalogue
    seed_battle_catalogue(db)
    seed_original_catalogue(db)


def test_catalogue_seed_is_insert_only_and_starter_is_independent_of_old_pack(db):
    from app.models import ArchiveCard, ArchiveItem, ArchiveOperation
    seed(db)
    seed(db)
    assert len(list(db.scalars(select(ArchiveCard)))) == 110
    user = player(db)
    key = str(uuid4())
    first = service().claim_starter(db, user.id, key, "REAL")
    assert first == service().claim_starter(db, user.id, key, "REAL")
    assert len(first["squad"]["slots"]) == 6
    assert {value["card"]["hero"] for value in first["receipt"]["items"]} == {"abrams", "bebop", "dynamo", "haze", "ivy", "seven"}
    assert len(list(db.scalars(select(ArchiveItem)))) == 6
    assert db.scalar(select(ArchiveOperation.benefit_key)) == "battle_starter_v1"
    changed = db.scalar(select(ArchiveCard))
    changed.status = "ARCHIVED"
    db.flush()
    seed(db)
    assert changed.status == "ARCHIVED"


def test_new_match_reserves_exact_items_and_retry_keeps_snapshot(db):
    seed(db)
    user = player(db)
    service().claim_starter(db, user.id, str(uuid4()), "REAL")
    key = str(uuid4())
    body = {"request_key": key, "mode": "TRAINING", "scope": "REAL", "squad_revision": 1, "base_item_id": None}
    result = service().start_match(db, user.id, body)
    assert result == service().start_match(db, user.id, body)
    assert result["match"]["state"]["sides"][0]["base"]["key"] == "ORDINARY"
    item_id = result["match"]["state"]["sides"][0]["heroes"][0]["item_id"]
    assert service().is_item_reserved(db, item_id)
    from app.battle_models import BattleMatch
    frozen = db.get(BattleMatch, result["match"]["id"]).snapshot["A"]
    assert frozen["definition_versions"]["abrams"]["version"] == 1
    assert frozen["definition_versions"]["abrams"]["id"]
    with pytest.raises(Exception) as failure:
        service().start_match(db, user.id, {**body, "request_key": str(uuid4())})
    assert failure.value.status_code == 409


def test_plan_replay_stale_revision_foreign_owner_and_surrender(db):
    seed(db)
    user, other = player(db), player(db)
    service().claim_starter(db, user.id, str(uuid4()), "REAL")
    match = service().start_match(db, user.id, {"request_key": str(uuid4()), "mode": "TRAINING", "scope": "REAL", "squad_revision": 1, "base_item_id": None})["match"]
    key = str(uuid4())
    first = service().submit_plan(db, user.id, match["id"], key, match["revision"], [])
    assert first["match"]["round"] == 2
    assert first == service().submit_plan(db, user.id, match["id"], key, match["revision"], [])
    with pytest.raises(Exception) as failure:
        service().submit_plan(db, user.id, match["id"], str(uuid4()), 1, [])
    assert failure.value.status_code == 409
    with pytest.raises(Exception) as failure:
        service().get_match(db, other.id, match["id"])
    assert failure.value.status_code == 404
    done = service().surrender(db, user.id, match["id"], str(uuid4()), first["match"]["revision"])
    assert done["match"]["result"]["reason"] == "SURRENDER"
    assert not service().is_item_reserved(db, match["state"]["sides"][0]["heroes"][0]["item_id"])


def test_friendly_pvp_conceals_unsubmitted_plan_and_bases_until_both_confirm(db):
    seed(db)
    first, second = player(db), player(db)
    for user in (first, second):
        service().claim_starter(db, user.id, str(uuid4()), "REAL")
    room = service().create_room(db, first.id, str(uuid4()), "REAL")["room"]
    service().join_room(db, second.id, room["code"], str(uuid4()))
    pending = service().confirm_room(db, first.id, room["code"], str(uuid4()), 1, None)
    assert pending["room"]["match_id"] is None
    started = service().confirm_room(db, second.id, room["code"], str(uuid4()), 1, None)
    match_id = started["room"]["match_id"]
    match = service().get_match(db, first.id, match_id)["match"]
    accepted = service().submit_plan(db, first.id, match_id, str(uuid4()), match["revision"], [])
    assert accepted["match"]["round"] == 1 and accepted["match"]["submitted"]
    view = service().get_match(db, second.id, match_id)["match"]
    assert view["opponent_submitted"] and not view["submitted"]
    assert "pending_plans" not in view
    resolved = service().submit_plan(db, second.id, match_id, str(uuid4()), view["revision"], [])
    assert resolved["match"]["round"] == 2


def start(db, user, mode="TRAINING", scope="REAL", **extra):
    return service().start_match(db, user.id, {"request_key": str(uuid4()), "mode": mode, "scope": scope,
        "squad_revision": 1, "base_item_id": None, **extra})["match"]


def win(db, user, match):
    from app.battle_models import BattleMatch
    row = db.get(BattleMatch, match["id"])
    value = deepcopy(row.state)
    for hero in value["sides"][1]["heroes"]: hero.update(hp=0, deaths=2, respawn_round=None)
    for guardian in value["sides"][1]["guardians"]: guardian["hp"] = 0
    value["sides"][1]["base"]["hp"] = 1
    row.state = value; row.bot_plan = []; db.flush()
    return service().submit_plan(db, user.id, match["id"], str(uuid4()), row.revision, [])["match"]


def test_assigned_opponent_persists_across_loss_and_normal_hard_share_three_win_slots(db):
    from app.battle_models import BattleAssignment
    from app.services.extra_coin_rewards import eligible_pve_win_count
    seed(db); user = player(db); service().claim_starter(db, user.id, str(uuid4()), "REAL")
    match = start(db, user, "ASSIGNED")
    first = db.scalar(select(BattleAssignment))
    saved = deepcopy(first.opponent)
    service().surrender(db, user.id, match["id"], str(uuid4()), match["revision"])
    retry = start(db, user, "HARD")
    assert retry["mode"] == "ASSIGNED"
    assert db.scalar(select(BattleAssignment)).opponent == saved
    assert win(db, user, retry)["result"]["winner_side"] == "A"
    for _ in range(2): win(db, user, start(db, user, "HARD"))
    assert len(list(db.scalars(select(BattleAssignment)))) == 3
    assert eligible_pve_win_count(db, user.id) == 3
    with pytest.raises(Exception) as failure: start(db, user, "ASSIGNED")
    assert failure.value.status_code == 409


def test_trial_lends_only_chosen_base_and_access_requires_matching_real_win(db, monkeypatch):
    from app.models import ArchiveCard, ArchiveItem, utcnow
    from app.services import extra_coin_rewards
    seed(db); user = player(db); user.created_at = utcnow() - timedelta(days=8)
    db.flush()
    monkeypatch.setattr(extra_coin_rewards, "confirmed_contract_count", lambda db, uid: 20)
    service().claim_starter(db, user.id, str(uuid4()), "REAL")
    trial = start(db, user, "TRIAL", patron_key="HIDDEN_KING")
    assert trial["state"]["sides"][0]["base"]["key"] == "HIDDEN_KING"
    assert len(list(db.scalars(select(ArchiveItem)))) == 6
    win(db, user, trial)
    king = db.get(ArchiveCard, card_id("HIDDEN_KING", "EX"))
    mother = db.get(ArchiveCard, card_id("ARCHMOTHER", "EX"))
    assert service().ex_access(db, user.id, king)["eligible"]
    assert service().ex_access(db, user.id, mother)["reasons"] == ["PATRON_TRIAL"]
    unapproved = ArchiveCard(hero="HIDDEN_KING", rank="EX", title="User image", status="PUBLISHED")
    db.add(unapproved); db.flush()
    assert service().ex_access(db, user.id, unapproved, "SANDBOX")["reasons"] == ["BATTLE_APPROVAL"]


def test_sandbox_mixed_squad_never_grants_real_trial_or_pve_progress(db):
    from app.battle_models import BattleSquad
    from app.services.extra_coin_rewards import eligible_pve_win_count
    seed(db); user = player(db)
    real = service().claim_starter(db, user.id, str(uuid4()), "REAL")["squad"]
    sandbox = service().claim_starter(db, user.id, str(uuid4()), "SANDBOX")["squad"]
    slots = deepcopy(real["slots"]); slots[0]["item_id"] = sandbox["slots"][0]["item_id"]
    changed = service().save_squad(db, user.id, 1, "SANDBOX", None, slots)["squad"]
    match = start(db, user, "ASSIGNED", "SANDBOX", squad_revision=changed["revision"])
    result = win(db, user, match)
    assert result["reward"] is None and eligible_pve_win_count(db, user.id) == 0
    with pytest.raises(Exception) as failure: service().save_squad(db, user.id, 1, "REAL", None, slots)
    assert failure.value.status_code == 409


def test_weekly_loan_does_not_create_items_and_saved_squad_recycle_invalidates(db):
    from app.models import ArchiveItem
    from app.battle_models import BattleSquad
    seed(db); user = player(db); first = service().claim_starter(db, user.id, str(uuid4()), "REAL")
    match = start(db, user, "WEEKLY")
    assert len(list(db.scalars(select(ArchiveItem)))) == 6
    assert {hero["rank"] for hero in match["state"]["sides"][0]["heroes"]} == {"SSS", "S", "C", "D", "E", "F"}
    assert not any(service().is_item_reserved(db, value["item_id"]) for value in first["squad"]["slots"])
    from app.battle_models import BattleMatch, BattleAssignment
    row = db.get(BattleMatch, match["id"])
    assert row.reward_eligible and row.assignment_id
    assert db.get(BattleAssignment, row.assignment_id).opponent["encounter_mode"] == "WEEKLY"
    item_id = first["squad"]["slots"][0]["item_id"]
    service().invalidate_item_squads(db, user.id, item_id)
    squad = db.scalar(select(BattleSquad))
    assert squad.revision == 2 and len(squad.slots) == 5


def test_public_showcase_respects_profile_switch_and_hides_instance_ids(db):
    from app.models import PublicProfile
    from app.services import battle_social
    seed(db); user = player(db); first = service().claim_starter(db, user.id, str(uuid4()), "REAL")
    db.add(PublicProfile(user_id=user.id, slug="public-player", is_public=True)); db.commit()
    battle_social.save_showcase(db, user.id, 0, True, None, first["squad"]["slots"])
    view = battle_social.public_showcase(db, "public-player")["showcase"]
    assert len(view["heroes"]) == 6
    assert not any("item_id" in hero or "id" in hero for hero in view["heroes"])
    profile = db.scalar(select(PublicProfile)); profile.show_showcase = False; db.commit()
    with pytest.raises(Exception) as failure: battle_social.public_showcase(db, "public-player")
    assert failure.value.status_code == 404
    assert battle_social.public_copy_snapshot(db, user.id) is None


def test_ranked_matches_real_players_only_and_updates_rating_once(db):
    from app.models import utcnow
    from app.battle_models import BattleRating
    from app.services import battle_social
    seed(db); owner, first, second = player(db), player(db), player(db)
    for user in (first, second): service().claim_starter(db, user.id, str(uuid4()), "REAL")
    battle_social.set_season(db, owner.id, str(uuid4()), "First season", utcnow() - timedelta(hours=1), utcnow() + timedelta(days=7), True)
    waiting = battle_social.join_queue(db, first.id, str(uuid4()), 1, None)
    assert waiting == {"queued": True, "match": None}
    match = battle_social.join_queue(db, second.id, str(uuid4()), 1, None)["match"]
    assert match["mode"] == "RANKED" and match["player_side"] == "B"
    key = str(uuid4())
    result = service().surrender(db, first.id, match["id"], key, match["revision"])
    assert service().surrender(db, first.id, match["id"], key, match["revision"]) == result
    ratings = {value.user_id: value for value in db.scalars(select(BattleRating))}
    assert ratings[first.id].rating == 988 and ratings[second.id].rating == 1012
    assert ratings[first.id].games == ratings[second.id].games == 1
    assert result["match"]["reward"] is None


def test_suspended_opponent_cannot_block_surrender_or_expiry_release(db):
    from app.models import utcnow
    from app.battle_models import BattleMatch
    seed(db); first, second = player(db), player(db)
    for user in (first, second): service().claim_starter(db, user.id, str(uuid4()), "REAL")
    room = service().create_room(db, first.id, str(uuid4()))["room"]
    service().join_room(db, second.id, room["code"], str(uuid4()))
    service().confirm_room(db, first.id, room["code"], str(uuid4()), 1, None)
    started = service().confirm_room(db, second.id, room["code"], str(uuid4()), 1, None)
    match_id = started["room"]["match_id"]
    second.status = "SUSPENDED"; db.commit()
    assert service().surrender(db, first.id, match_id, str(uuid4()), 1)["match"]["status"] == "FINISHED"
    second.status = "ACTIVE"; db.commit()
    match = start(db, first)
    row = db.get(BattleMatch, match["id"]); row.updated_at = utcnow() - timedelta(hours=25); db.commit()
    assert service().cleanup_expired(db, first.id) == {"expired": 1}
    assert row.result["reason"] == "EXPIRED"
    assert not service().is_item_reserved(db, match["state"]["sides"][0]["heroes"][0]["item_id"])


def test_bootstrap_is_read_only_and_request_recovery_private(db):
    from app.battle_models import BattleAssignment, BattleCommand
    seed(db); user, other = player(db), player(db)
    key = str(uuid4()); receipt = service().claim_starter(db, user.id, key, "REAL")
    before = len(list(db.scalars(select(BattleCommand))))
    view = service().bootstrap(db, user.id)
    assert view["account_key"] == user.id and len(view["inventory"]) == 6
    assert isinstance(view["rules"]["heroes"], dict)
    assert len(list(db.scalars(select(BattleCommand)))) == before
    assert list(db.scalars(select(BattleAssignment))) == []
    assert service().request_result(db, user.id, key) == {"result": receipt}
    assert service().request_result(db, other.id, key) == {"result": None}


def test_first_room_seal_does_not_silently_upgrade_to_different_definition(db):
    from app.battle_models import BattleArtwork, BattleDefinitionVersion, BattleMatch
    from app.services import card_battle
    seed(db); first, second = player(db), player(db)
    for user in (first, second): service().claim_starter(db, user.id, str(uuid4()), "REAL")
    room = service().create_room(db, first.id, str(uuid4()))["room"]
    service().join_room(db, second.id, room["code"], str(uuid4()))
    service().confirm_room(db, first.id, room["code"], str(uuid4()), 1, None)
    rules = deepcopy(card_battle.HEROES["abrams"]); rules["hp"] = 700
    definition = BattleDefinitionVersion(key="abrams", category="HERO", version=2, approved=True, rules=rules)
    db.add(definition); db.flush()
    db.get(BattleArtwork, card_id("abrams", "F")).definition_id = definition.id; db.commit()
    with pytest.raises(Exception) as failure: service().confirm_room(db, second.id, room["code"], str(uuid4()), 1, None)
    assert failure.value.status_code == 409
    assert list(db.scalars(select(BattleMatch))) == []


def test_ranked_queue_does_not_weaken_rating_or_budget_constraints(db):
    from app.models import ArchiveItem, utcnow
    from app.battle_models import BattleRating, BattleSeason
    from app.services import battle_social
    seed(db); owner, first, second = player(db), player(db), player(db)
    for user in (first, second): service().claim_starter(db, user.id, str(uuid4()), "REAL")
    season = battle_social.set_season(db, owner.id, str(uuid4()), "Fixed matching", utcnow() - timedelta(hours=1), utcnow() + timedelta(days=7), True)["season"]
    db.add(BattleRating(season_id=season["id"], user_id=second.id, rating=1400)); db.commit()
    assert battle_social.join_queue(db, first.id, str(uuid4()), 1, None)["queued"]
    assert battle_social.join_queue(db, second.id, str(uuid4()), 1, None)["queued"]
    battle_social.cancel_queue(db, second.id)
    db.get(BattleRating, (season["id"], second.id)).rating = 1000
    item = db.scalar(select(ArchiveItem).where(ArchiveItem.user_id == second.id, ArchiveItem.card_id == card_id("abrams", "F")))
    item.card_id = card_id("abrams", "SSS"); db.commit()
    assert battle_social.join_queue(db, second.id, str(uuid4()), 1, None)["queued"]


def test_ranked_queue_filters_suspended_candidates_and_experience_bucket(db):
    from app.models import utcnow
    from app.battle_models import BattleMatch
    from app.services import battle_social
    seed(db); owner, first, second, third = player(db), player(db), player(db), player(db)
    for user in (first, second, third): service().claim_starter(db, user.id, str(uuid4()), "REAL")
    battle_social.set_season(db, owner.id, str(uuid4()), "Experience", utcnow() - timedelta(hours=1), utcnow() + timedelta(days=7), True)
    for _ in range(10):
        db.add(BattleMatch(user_id=first.id, mode="TRAINING", scope="REAL", status="FINISHED", state={}, snapshot={},
                           result={"winner_side": None, "reason": "ROUND_LIMIT"}, outcome="DRAW", finished_at=utcnow()))
    db.commit()
    assert battle_social.join_queue(db, first.id, str(uuid4()), 1, None)["queued"]
    assert battle_social.join_queue(db, second.id, str(uuid4()), 1, None)["queued"]
    second.status = "SUSPENDED"; db.commit()
    assert battle_social.join_queue(db, third.id, str(uuid4()), 1, None)["queued"]


def test_owned_definition_preview_matches_actual_versioned_match_stats(db):
    from app.battle_models import BattleArtwork, BattleDefinitionVersion
    from app.services import card_battle
    seed(db); user = player(db)
    service().claim_starter(db, user.id, str(uuid4()), "REAL")
    rules = deepcopy(card_battle.HEROES["abrams"])
    rules.update(hp=700, attack=80); rules["ability"]["shield"] = 150
    rules["ability"]["description"] = {"ru": "Щит 150 себе", "en": "Shield self for 150"}
    definition = BattleDefinitionVersion(key="abrams", category="HERO", version=2, approved=True, rules=rules)
    db.add(definition); db.flush()
    db.get(BattleArtwork, card_id("abrams", "F")).definition_id = definition.id; db.commit()
    preview = next(value for value in service().bootstrap(db, user.id)["inventory"] if value["hero_key"] == "abrams")
    match = start(db, user)
    actual = match["state"]["sides"][0]["heroes"][0]
    assert preview["stats"]["max_hp"] == actual["max_hp"] == 700
    assert preview["stats"]["attack"] == actual["attack"] == 80
    assert preview["definition"]["id"] == definition.id and preview["definition"]["version"] == 2
    assert preview["definition"]["rules"]["ability"] == actual["ability"]
