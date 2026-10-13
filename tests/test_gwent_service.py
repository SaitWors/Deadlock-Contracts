"""The Gwent loop passes through the real arena locking/receipt boundary."""
# Pytest discovers the imported fixture; test parameters intentionally shadow it.
# ruff: noqa: F811
from copy import deepcopy
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from test_card_battle_service import db, player, seed  # noqa: F401

from app.battle_models import BattleAction, BattleMatch
from app.card_battle import Plan
from app.services import battle_service as arena
from app.services import gwent


def setup_match(db, mode="TRAINING"):
    seed(db)
    user = player(db)
    arena.claim_starter(db, user.id, str(uuid4()))
    match = arena.start_match(db, user.id, {"request_key": str(uuid4()), "mode": mode,
        "scope": "REAL", "squad_revision": 1, "base_item_id": None})["match"]
    return user, match


def own(match):
    return next(side for side in match["state"]["sides"] if side["side"] == match["player_side"])


def command(db, user, match, action, key=None):
    return arena.submit_plan(db, user.id, match["id"], key or str(uuid4()),
                             match["revision"], [action])["match"]


def unit_action(match):
    card = next(card for card in own(match)["hand"] if card["kind"] == "UNIT")
    return {"type": "PLAY", "card_id": card["id"], "row": card["rows"][0]}


def test_new_match_deals_ten_original_cards_and_hides_all_decks_and_enemy_hand(db):
    user, match = setup_match(db)
    assert match["state"].get("game") == "GWENT"
    assert match["state"]["rules"]["version"] == "gwent-v1"
    first, second = match["state"]["sides"]
    assert len(first["hand"]) == 10 and second["hand"] == []
    assert second["hand_count"] == 10
    assert first["deck"] == second["deck"] == []
    assert first["deck_count"] == second["deck_count"] == 14
    assert "seed" not in match["state"] and "bot_plan" not in match
    source_ids = {hero["card"]["id"] for hero in first["heroes"]}
    for card in first["hand"]:
        if card.get("hero_key") in gwent.display_rules()["heroes"]:
            assert card["card"]["id"] in source_ids
            assert f"/matches/{match['id']}/cards/" in card["image_url"]
            assert arena.match_card(db, user.id, match["id"], card["card"]["id"]).image_data


def test_http_schema_accepts_choices_and_rejects_forged_stats_and_old_actions():
    body = {"request_key": str(uuid4()), "expected_revision": 1,
            "actions": [{"type": "PLAY", "card_id": "card:1", "row": 0}]}
    assert Plan.model_validate(body).actions[0].type == "PLAY"
    for extra in ({"power": 999}, {"row": True}, {"winner_side": "A"}):
        with pytest.raises(ValidationError):
            Plan.model_validate({**body, "actions": [{**body["actions"][0], **extra}]})


def test_two_human_commands_can_be_played_in_same_round_and_replay_is_exact(db):
    user, match = setup_match(db)
    match = command(db, user, match, {"type": "READY"})
    assert match["state"]["phase"] == "PLAY"
    key = str(uuid4())
    action = unit_action(match)
    before = deepcopy(match)
    first = command(db, user, match, action, key)
    assert first["round"] == before["round"] == 1
    assert first["revision"] == before["revision"] + 1
    assert first["state"]["turn_side"] == "A"
    assert command(db, user, before, action, key) == first
    second = command(db, user, first, unit_action(first))
    assert second["round"] == 1 and second["revision"] == first["revision"] + 1
    assert second["state"]["turn"] > first["state"]["turn"]
    with pytest.raises(Exception) as error:
        command(db, user, before, action)
    assert error.value.status_code == 409


def test_pvp_readiness_turn_order_and_hidden_hand_survive_polling(db):
    seed(db)
    first, second = player(db), player(db)
    for user in (first, second):
        arena.claim_starter(db, user.id, str(uuid4()))
    room = arena.create_room(db, first.id, str(uuid4()), "REAL")["room"]
    arena.join_room(db, second.id, room["code"], str(uuid4()))
    arena.confirm_room(db, first.id, room["code"], str(uuid4()), 1, None)
    reply = arena.confirm_room(db, second.id, room["code"], str(uuid4()), 1, None)
    match_id = reply["room"]["match_id"]
    view = arena.get_match(db, first.id, match_id)["match"]
    first_ready = command(db, first, view, {"type": "READY"})
    assert first_ready["state"]["phase"] == "MULLIGAN"
    second_view = arena.get_match(db, second.id, match_id)["match"]
    both = command(db, second, second_view, {"type": "READY"})
    assert both["state"]["phase"] == "PLAY"
    assert own(both)["hand_count"] == 10
    hidden = next(side for side in both["state"]["sides"] if side["side"] != "B")
    assert hidden["hand"] == [] and hidden["deck"] == []
    waiting_user = second if both["state"]["turn_side"] == "A" else first
    waiting = arena.get_match(db, waiting_user.id, match_id)["match"]
    with pytest.raises(Exception) as error:
        command(db, waiting_user, waiting, unit_action(waiting))
    assert error.value.status_code == 422


def test_turn_journal_supports_more_than_twelve_actions_without_advancing_round(db):
    user, match = setup_match(db)
    row = db.get(BattleMatch, match["id"])
    state = deepcopy(row.state)
    state["turn"] = 20
    row.state = state
    db.flush()
    match = command(db, user, match, {"type": "READY"})
    assert match["round"] == 1
    assert db.scalar(select(func.max(BattleAction.round)).where(BattleAction.match_id == match["id"])) == 21


def test_participants_keep_original_art_after_archiving_and_other_users_are_denied(db):
    from app.models import ArchiveCard
    user, match = setup_match(db)
    card_id = own(match)["heroes"][0]["card"]["id"]
    card = db.get(ArchiveCard, card_id)
    image = card.image_data
    card.status = "ARCHIVED"
    db.flush()
    assert arena.match_card(db, user.id, match["id"], card_id).image_data == image
    stranger = player(db)
    with pytest.raises(Exception) as error:
        arena.match_card(db, stranger.id, match["id"], card_id)
    assert error.value.status_code == 404
    card.status = "REMOVED"
    db.flush()
    with pytest.raises(Exception) as error:
        arena.match_card(db, user.id, match["id"], card_id)
    assert error.value.status_code == 404


def test_legacy_match_remains_playable_after_new_rules_release(db):
    from app.services import card_battle as legacy
    user, match = setup_match(db)
    row = db.get(BattleMatch, match["id"])
    state = legacy.initial_state(row.snapshot["A"]["heroes"], row.snapshot["B"]["heroes"])
    row.state = state
    row.bot_plan = legacy.bot_plan(state)
    db.flush()
    view = arena.get_match(db, user.id, match["id"])["match"]
    continued = arena.submit_plan(db, user.id, match["id"], str(uuid4()), view["revision"], [])["match"]
    assert continued["state"]["rules"]["version"] == "arena-v1"
    assert continued["round"] == 2


def test_selected_patron_preview_uses_the_same_approved_version_as_combat(db):
    from app.battle_models import BattleArtwork, BattleDefinitionVersion
    from app.models import ArchiveCard, ArchiveItem
    user, first_match = setup_match(db)
    arena.surrender(db, user.id, first_match["id"], str(uuid4()), first_match["revision"])
    sources = own(first_match)["heroes"]
    operation_id = db.scalar(select(ArchiveItem.operation_id).where(ArchiveItem.id == sources[0]["item_id"]))
    card = db.scalar(select(ArchiveCard).where(ArchiveCard.hero == "HIDDEN_KING", ArchiveCard.rank == "EX"))
    rules = deepcopy(gwent.display_rules()["bases"]["HIDDEN_KING"])
    rules["name"] = {"ru": "Король второго издания", "en": "Published king v2"}
    rules["ability"]["effect_amount"] = 7
    definition = BattleDefinitionVersion(key="HIDDEN_KING", category="BASE", version=2, approved=True, rules=rules)
    db.add(definition); db.flush()
    db.get(BattleArtwork, card.id).definition_id = definition.id
    item = ArchiveItem(user_id=user.id, card_id=card.id, operation_id=operation_id, scope="REAL", state="OWNED", cost_basis=1800)
    db.add(item); db.flush()
    preview = next(value for value in arena.bootstrap(db, user.id)["inventory"] if value["item_id"] == item.id)
    assert preview["definition"]["combat_rules"]["ability"]["effect_amount"] == 7
    assert "7" in preview["definition"]["combat_rules"]["ability"]["description"]["ru"]
    slots = [{"item_id": source["item_id"], "line": source["line"], "position": source["position"]} for source in sources]
    arena.save_squad(db, user.id, 1, "REAL", item.id, slots)
    match = arena.start_match(db, user.id, {"request_key": str(uuid4()), "mode": "TRAINING", "scope": "REAL",
        "squad_revision": 2, "base_item_id": item.id})["match"]
    actual = own(match)["base"]
    assert actual["ability"] == preview["definition"]["combat_rules"]["ability"]
    assert actual["name"] == preview["definition"]["combat_rules"]["name"]


def test_old_empty_art_starter_is_repaired_once_without_rewriting_its_receipt(db):
    from app.battle_models import BattleSquad
    from app.models import ArchiveCard, ArchiveItem, ArchiveOperation
    from app.services.archive import card_payload
    seed(db)
    user = player(db)
    old = ArchiveOperation(user_id=user.id, request_key=str(uuid4()), signature="old-starter",
        kind="BATTLE_STARTER", scope="REAL", benefit_key="battle_starter_v1")
    db.add(old); db.flush()
    slots = []
    old_items = []
    for index, key in enumerate(arena.STARTER):
        card = ArchiveCard(hero=key, rank="F", title=f"Old empty {key}", status="ARCHIVED", image_data=b"", image_digest="old-empty")
        db.add(card); db.flush()
        item = ArchiveItem(user_id=user.id, card_id=card.id, operation_id=old.id, scope="REAL", state="OWNED", cost_basis=0)
        db.add(item); db.flush()
        slots.append({"item_id": item.id, "line": index // 2, "position": "FRONT" if index % 2 == 0 else "BACK"})
        old_items.append({"id": item.id, "card": card_payload(card)})
    old.result = {"id": old.id, "kind": "BATTLE_STARTER", "scope": "REAL", "delta": 0, "items": old_items}
    db.add(BattleSquad(user_id=user.id, scope="REAL", revision=1, slots=slots)); db.commit()
    receipt_before = deepcopy(old.result)
    preview = arena.bootstrap(db, user.id)
    assert preview["starter"]["available"] and preview["starter"]["repair"]
    key = str(uuid4())
    repaired = arena.claim_starter(db, user.id, key)
    assert repaired["receipt"]["repair"]
    assert repaired["squad"]["revision"] == 2
    assert {item["card"]["id"] for item in repaired["receipt"]["items"]} == {card["id"] for card in preview["starter"]["cards"]}
    assert all(item["card"]["image_url"] for item in repaired["receipt"]["items"])
    assert db.get(ArchiveOperation, old.id).result == receipt_before
    assert db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user.id)) == 12
    assert arena.claim_starter(db, user.id, key) == repaired
    with pytest.raises(Exception) as error:
        arena.claim_starter(db, user.id, str(uuid4()))
    assert error.value.status_code == 409
