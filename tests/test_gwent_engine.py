"""Behavioral contract tests for the independent, database-free Gwent engine."""
import json
import unittest
from copy import deepcopy


def engine():
    from app.services import gwent
    return gwent


def squad(prefix="a"):
    return [{"id": f"{prefix}{index}", "hero_key": hero, "rank": "F",
             "line": index // 2, "position": "FRONT" if index % 2 == 0 else "BACK"}
            for index, hero in enumerate(("abrams", "bebop", "dynamo", "haze", "ivy", "seven"))]


def side(state, key="A"):
    return next(value for value in state["sides"] if value["side"] == key)


def ready(state=None):
    value = state or engine().initial_state(squad(), squad("b"), seed="frozen-server-match")
    value, _ = engine().apply_action(value, "B", {"type": "READY"})
    value, _ = engine().apply_action(value, "A", {"type": "READY"})
    return value


def take_card(state, key="A", *, hero=None, effect=None):
    """Make a known card available without duplicating a card identity."""
    actor = side(state, key)
    for zone in (actor["hand"], actor["deck"]):
        card = next((value for value in zone if (hero is None or value["hero_key"] == hero)
                     and (effect is None or value["effect"] == effect)), None)
        if card:
            if zone is actor["deck"]:
                zone.remove(card)
                actor["hand"].append(card)
            return card
    raise AssertionError(f"Missing test card: {hero}/{effect}")


def on_board(state, key="A", *, hero="abrams", effect=None, row=None):
    card = take_card(state, key, hero=hero, effect=effect)
    side(state, key)["hand"].remove(card)
    side(state, key)["rows"][card["rows"][0] if row is None else row].append(card)
    return card


def play_effect(state, effect, *, key="A", **fields):
    card = take_card(state, key, effect=effect)
    state["turn_side"] = key
    return engine().apply_action(state, key, {"type": "PLAY", "card_id": card["id"], **fields})


class OpeningAndPublicStateTests(unittest.TestCase):
    def test_opening_starter_b_survives_independent_mulligans(self):
        current = engine().initial_state(squad(), squad("b"), seed="server-coin", first_side="B")
        self.assertEqual(current["round_starter"], "B")
        for key in ("A", "B"):
            current, _ = engine().apply_action(current, key, {"type": "MULLIGAN", "card_id": side(current, key)["hand"][0]["id"]})
        current = ready(current)
        self.assertEqual((current["phase"], current["turn_side"], current["round_starter"]), ("PLAY", "B", "B"))
        engine().validate_action(current, "B", {"type": "PASS"})
        with self.assertRaises(ValueError):
            engine().validate_action(current, "A", {"type": "PASS"})
        self.assertEqual(current, json.loads(json.dumps(current)))

    def test_opening_starter_rejects_invalid_sides(self):
        for key in ("C", None, True, []):
            with self.subTest(side=key), self.assertRaises(ValueError):
                engine().initial_state(squad(), squad("b"), first_side=key)

    def test_rules_and_state_are_json_native_for_identical_command_replays(self):
        rules = engine().display_rules()
        current = engine().initial_state(squad(), squad("b"), rules=rules, seed="replay")
        self.assertEqual(rules, json.loads(json.dumps(rules)))
        self.assertEqual(current, json.loads(json.dumps(current)))

    def test_deals_ten_from_a_twenty_four_card_deck(self):
        current = engine().initial_state(squad(), squad("b"), seed="server-uuid")
        self.assertEqual(engine().VERSION, "gwent-v1")
        self.assertEqual(current["game"], "GWENT")
        self.assertEqual(current["rules"]["version"], "gwent-v1")
        self.assertEqual((current["round"], current["turn"], current["phase"]), (1, 0, "MULLIGAN"))
        for actor in current["sides"]:
            self.assertEqual((len(actor["hand"]), len(actor["deck"])), (10, 14))
            self.assertEqual(actor["rows"], [[], [], []])
            self.assertEqual(actor["row_scores"], [0, 0, 0])
            cards = actor["hand"] + actor["deck"]
            self.assertEqual(len({card["id"] for card in cards}), 24)
            self.assertEqual(sum(card["hero_key"] == "abrams" for card in cards), 3)
            self.assertEqual({card["effect"] for card in cards if not card["hero_key"]},
                             {"SPY", "WEATHER", "CLEAR_WEATHER", "HORN", "SCORCH", "DECOY"})
            self.assertEqual(actor["mulligans_remaining"], 2)

    def test_same_server_seed_has_same_order_and_distinct_seed_changes_order(self):
        first = engine().initial_state(squad(), squad("b"), seed="one")
        again = engine().initial_state(squad(), squad("b"), seed="one")
        other = engine().initial_state(squad(), squad("b"), seed="two")
        self.assertEqual(first, again)
        self.assertNotEqual([card["id"] for card in side(first)["hand"]],
                            [card["id"] for card in side(other)["hand"]])

    def test_public_state_hides_every_deck_and_opponent_hand_without_mutation(self):
        current = engine().initial_state(squad(), squad("b"), seed="server-secret")
        before = deepcopy(current)
        public = engine().public_state(current, "A")
        self.assertEqual(len(side(public, "A")["hand"]), 10)
        self.assertEqual(side(public, "B")["hand"], [])
        for actor in public["sides"]:
            self.assertEqual(actor["deck"], [])
            self.assertEqual((actor["hand_count"], actor["deck_count"], actor["graveyard_count"]), (10, 14, 0))
            self.assertNotIn("mulligan_stash", actor)
        self.assertNotIn("seed", public)
        self.assertNotIn("shuffle_seed", public)
        self.assertEqual(current, before)
        public["sides"][0]["hand"].clear()
        self.assertEqual(current, before)

    def test_source_art_and_definition_metadata_survive_battle_copies(self):
        heroes = squad()
        heroes[0].update(item_id="physical-abrams", definition_id="approved-v2", definition_version=2,
                         card={"id": "archive-original", "image_url": "/api/archive/cards/original/image"})
        rules = engine().display_rules()
        rules["heroes"]["abrams"]["image_url"] = "/catalogue/abrams"
        current = engine().initial_state(heroes, squad("b"), rules=rules, seed="art")
        copies = [card for card in side(current)["hand"] + side(current)["deck"] if card["hero_key"] == "abrams"]
        self.assertEqual(side(current)["heroes"][0]["card"]["id"], "archive-original")
        for card in copies:
            self.assertEqual(card["image_url"], "/api/archive/cards/original/image")
            self.assertEqual(card["card"]["id"], "archive-original")
            self.assertEqual(card["item_id"], "physical-abrams")
            self.assertEqual((card["definition_id"], card["definition_version"]), ("approved-v2", 2))

    def test_every_catalogue_hero_has_a_playable_combat_definition(self):
        rules = engine().display_rules()
        self.assertEqual(len(rules["heroes"]), 44)
        for key in rules["heroes"]:
            heroes = squad()
            existing = next((index for index, hero in enumerate(heroes) if hero["hero_key"] == key), None)
            if existing is not None:
                heroes[0], heroes[existing] = heroes[existing], heroes[0]
            else:
                heroes[0]["hero_key"] = key
            current = engine().initial_state(heroes, squad("b"), rules=rules, seed=key)
            copies = [card for card in side(current)["hand"] + side(current)["deck"] if card["hero_key"] == key]
            self.assertEqual(len(copies), 3, key)
            preview = engine().card_preview(key, "F", rules=rules)
            self.assertIn(preview["effect"], {"DAMAGE", "HEAL", "BOOST", "BOND", "MUSTER"}, key)
            self.assertTrue(preview["rows"], key)
            self.assertTrue(set(preview["rows"]).issubset({0, 1, 2}), key)
            self.assertTrue(preview["description"], key)
            self.assertEqual(preview["power"], copies[0]["power"], key)


class RoundTests(unittest.TestCase):
    def test_round_winner_starts_next_round(self):
        for opening, winner in (("A", "A"), ("A", "B"), ("B", "A"), ("B", "B")):
            with self.subTest(opening=opening, winner=winner):
                current = ready(engine().initial_state(squad(), squad("b"), first_side=opening))
                on_board(current, winner)
                current, _ = engine().apply_action(current, opening, {"type": "PASS"})
                current, events = engine().apply_action(current, "B" if opening == "A" else "A", {"type": "PASS"})
                self.assertEqual((current["round"], current["turn_side"], current["round_starter"]), (2, winner, winner))
                self.assertEqual(next(event for event in events if event["type"] == "ROUND_START")["turn_side"], winner)

    def test_tied_round_preserves_previous_starter(self):
        for opening in ("A", "B"):
            with self.subTest(opening=opening):
                current = ready(engine().initial_state(squad(), squad("b"), first_side=opening))
                current, _ = engine().apply_action(current, opening, {"type": "PASS"})
                current, _ = engine().apply_action(current, "B" if opening == "A" else "A", {"type": "PASS"})
                self.assertEqual((current["round"], current["turn_side"], current["round_starter"]), (2, opening, opening))

    def test_passed_player_cannot_act_while_opponent_keeps_playing(self):
        current = ready()
        after, _ = engine().apply_action(current, "A", {"type": "PASS"})
        self.assertTrue(side(after, "A")["passed"])
        self.assertEqual(after["turn_side"], "B")
        card = take_card(after, "B", hero="abrams")
        after, _ = engine().apply_action(after, "B", {"type": "PLAY", "card_id": card["id"], "row": card["rows"][0]})
        self.assertEqual(after["turn_side"], "B")
        before = deepcopy(after)
        with self.assertRaises(ValueError):
            engine().apply_action(after, "A", {"type": "PASS"})
        self.assertEqual(after, before)
        after, events = engine().apply_action(after, "B", {"type": "PASS"})
        self.assertEqual(side(after, "B")["wins"], 1)
        self.assertEqual(after["round"], 2)
        self.assertTrue(any(event["type"] == "ROUND_END" for event in events))

    def test_two_tied_rounds_award_both_wins_and_finish_as_draw(self):
        current = ready()
        for expected_round in (1, 2):
            first = current["turn_side"]
            second = "B" if first == "A" else "A"
            current, _ = engine().apply_action(current, first, {"type": "PASS"})
            current, _ = engine().apply_action(current, second, {"type": "PASS"})
            self.assertEqual(current["history"][-1], {"round": expected_round, "score_a": 0, "score_b": 0, "winner_side": None})
        self.assertEqual(current["status"], "FINISHED")
        self.assertEqual(current["result"]["winner_side"], None)
        self.assertEqual([actor["wins"] for actor in current["sides"]], [2, 2])
        with self.assertRaises(ValueError):
            engine().apply_action(current, "A", {"type": "PASS"})

    def test_round_clear_preserves_unplayed_hand_and_does_not_draw(self):
        current = ready()
        before_counts = [(len(actor["hand"]), len(actor["deck"])) for actor in current["sides"]]
        card = take_card(current, hero="abrams")
        before_counts[0] = (len(side(current)["hand"]), len(side(current)["deck"]))
        current, _ = engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"], "row": card["rows"][0]})
        current, _ = engine().apply_action(current, "B", {"type": "PASS"})
        current, _ = engine().apply_action(current, "A", {"type": "PASS"})
        self.assertEqual(current["round"], 2)
        self.assertEqual((len(side(current)["hand"]), len(side(current)["deck"])),
                         (before_counts[0][0] - 1, before_counts[0][1]))
        self.assertEqual((len(side(current, "B")["hand"]), len(side(current, "B")["deck"])), before_counts[1])
        self.assertEqual(side(current)["rows"], [[], [], []])
        self.assertEqual(side(current)["graveyard"][0]["id"], card["id"])
        self.assertEqual(side(current)["mulligans_remaining"], 0)

    def test_split_rounds_finish_on_third_without_a_fourth_round(self):
        current = ready()
        for winner in ("A", "B", "A"):
            on_board(current, winner)
            first = current["turn_side"]
            current, _ = engine().apply_action(current, first, {"type": "PASS"})
            current, _ = engine().apply_action(current, "B" if first == "A" else "A", {"type": "PASS"})
        self.assertEqual((current["round"], current["status"]), (3, "FINISHED"))
        self.assertEqual(current["result"]["winner_side"], "A")
        self.assertEqual([actor["wins"] for actor in current["sides"]], [2, 1])


class MulliganAndValidationTests(unittest.TestCase):
    def test_two_replacements_conserve_cards_and_do_not_redraw_the_returned_cards(self):
        current = engine().initial_state(squad(), squad("b"), seed="mulligans")
        returned = []
        for _ in range(2):
            identity = side(current)["hand"][0]["id"]
            returned.append(identity)
            before = deepcopy(current)
            current, events = engine().apply_action(current, "A", {"type": "MULLIGAN", "card_id": identity})
            self.assertEqual(len(side(current)["hand"]), 10)
            self.assertNotIn(identity, {card["id"] for card in side(current)["hand"]})
            self.assertEqual(events, [{"type": "MULLIGAN", "side": "A"}])
            self.assertNotEqual(current, before)
            public = engine().public_state(current, "B")
            self.assertEqual(side(public)["deck_count"], 14)
            self.assertEqual(side(public)["hand"], [])
        with self.assertRaises(ValueError):
            engine().apply_action(current, "A", {"type": "MULLIGAN", "card_id": side(current)["hand"][0]["id"]})
        current = ready(current)
        self.assertEqual(len(side(current)["deck"]), 14)
        self.assertTrue(set(returned).issubset({card["id"] for card in side(current)["deck"]}))
        for actor in current["sides"]:
            self.assertEqual(len({card["id"] for card in actor["hand"] + actor["deck"]}), 24)
        with self.assertRaises(ValueError):
            engine().apply_action(current, "A", {"type": "MULLIGAN", "card_id": side(current)["hand"][0]["id"]})

    def test_ready_on_either_side_waits_for_both_players(self):
        current = engine().initial_state(squad(), squad("b"))
        current, _ = engine().apply_action(current, "B", {"type": "READY"})
        self.assertEqual(current["phase"], "MULLIGAN")
        with self.assertRaises(ValueError):
            engine().apply_action(current, "B", {"type": "READY"})
        current, _ = engine().apply_action(current, "A", {"type": "READY"})
        self.assertEqual((current["phase"], current["turn_side"], current["turn"]), ("PLAY", "A", 2))

    def test_invalid_actions_never_mutate_input(self):
        current = ready()
        card = take_card(current, hero="abrams")
        enemy_card = take_card(current, "B", hero="abrams")
        commands = [None, [], {"type": []}, {"type": "UNKNOWN"}, {"type": "PASS", "power": 99},
                    {"type": "PLAY", "card_id": enemy_card["id"], "row": 0},
                    {"type": "PLAY", "card_id": card["id"], "row": 2},
                    {"type": "PLAY", "card_id": card["id"], "row": True},
                    {"type": "PLAY", "card_id": card["id"], "row": 0, "power": 999},
                    {"type": "MULLIGAN", "card_id": card["id"]}, {"type": "READY"}]
        before = deepcopy(current)
        for command in commands:
            with self.subTest(command=command), self.assertRaises(ValueError):
                engine().apply_action(current, "A", command)
            self.assertEqual(current, before)
        for key in ("B", "NEITHER"):
            with self.assertRaises(ValueError):
                engine().apply_action(current, key, {"type": "PASS"})
            self.assertEqual(current, before)

    def test_full_row_rejects_play_without_removing_hand_card(self):
        current = ready()
        card = take_card(current, hero="abrams")
        actor = side(current)
        actor["rows"][0] = [{**deepcopy(card), "id": f"existing-{index}"} for index in range(9)]
        before = deepcopy(current)
        with self.assertRaises(ValueError):
            engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"], "row": 0})
        self.assertEqual(current, before)

    def test_squad_budget_and_different_hero_rules_are_enforced(self):
        duplicate = squad()
        duplicate[1]["hero_key"] = duplicate[0]["hero_key"]
        with self.assertRaises(ValueError):
            engine().initial_state(duplicate, squad("b"))
        expensive = squad()
        for hero in expensive[:3]:
            hero["rank"] = "SSS"
        with self.assertRaises(ValueError):
            engine().initial_state(expensive, squad("b"))


class DeployEffectTests(unittest.TestCase):
    def test_damage_deploy_reduces_enemy_effective_strength(self):
        current = ready()
        target = on_board(current, "B")
        card = take_card(current, hero="bebop")
        before = deepcopy(current)
        after, events = engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"],
                                                             "row": card["rows"][0], "target_id": target["id"]})
        self.assertEqual(side(after, "B")["score"], target["base_power"] - 2)
        self.assertTrue(any(event["type"] == "DAMAGE" and event["target_id"] == target["id"] for event in events))
        self.assertEqual(current, before)

    def test_heal_restores_lost_strength_and_boost_adds_strength(self):
        current = ready()
        target = on_board(current, hero="abrams")
        target["damage"] = 2
        healer = take_card(current, hero="ivy")
        current, _ = engine().apply_action(current, "A", {"type": "PLAY", "card_id": healer["id"],
                                                          "row": healer["rows"][0], "target_id": target["id"]})
        restored = next(card for card in side(current)["rows"][0] if card["id"] == target["id"])
        self.assertEqual(restored["damage"], 0)
        current["turn_side"] = "A"
        booster = take_card(current, hero="dynamo")
        current, _ = engine().apply_action(current, "A", {"type": "PLAY", "card_id": booster["id"],
                                                          "row": booster["rows"][0], "target_id": target["id"]})
        boosted = next(card for card in side(current)["rows"][0] if card["id"] == target["id"])
        self.assertEqual(boosted["power"], boosted["base_power"] + 2)

    def test_bad_or_protected_deploy_targets_are_rejected(self):
        current = ready()
        protected = on_board(current, "B")
        protected["protected"] = True
        ally = on_board(current)
        card = take_card(current, hero="bebop")
        before = deepcopy(current)
        for target_id in (protected["id"], ally["id"], "missing"):
            with self.assertRaises(ValueError):
                engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"], "row": 0, "target_id": target_id})
            self.assertEqual(current, before)

    def test_bond_counts_copies_on_same_row_and_updates_all_scores(self):
        current = ready()
        original = on_board(current, hero="haze")
        card = take_card(current, hero="haze")
        current, _ = engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"], "row": 1})
        cards = side(current)["rows"][1]
        self.assertEqual(len(cards), 2)
        self.assertEqual([card["power"] for card in cards], [original["base_power"] * 2] * 2)
        self.assertEqual(side(current)["score"], original["base_power"] * 4)

    def test_muster_draws_same_hero_from_hand_and_deck_without_extra_turns(self):
        heroes = squad()
        heroes[0]["hero_key"] = "wraith"
        current = ready(engine().initial_state(heroes, squad("b"), seed="muster"))
        card = take_card(current, hero="wraith")
        before_turn = current["turn"]
        current, events = engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"], "row": 0})
        self.assertEqual(sum(value["hero_key"] == "wraith" for value in side(current)["rows"][0]), 3)
        self.assertFalse(any(value["hero_key"] == "wraith" for value in side(current)["hand"] + side(current)["deck"]))
        self.assertEqual(current["turn"], before_turn + 1)
        self.assertTrue(any(event["type"] == "MUSTER" for event in events))

    def test_muster_never_exceeds_row_capacity(self):
        heroes = squad()
        heroes[0]["hero_key"] = "wraith"
        current = ready(engine().initial_state(heroes, squad("b"), seed="muster-cap"))
        card = take_card(current, hero="wraith")
        side(current)["rows"][0] = [{**deepcopy(card), "id": f"already-{index}", "hero_key": "abrams", "effect": "BOOST"}
                                   for index in range(8)]
        current, _ = engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"], "row": 0})
        self.assertEqual(len(side(current)["rows"][0]), 9)
        self.assertEqual(sum(value["hero_key"] == "wraith" for value in side(current)["hand"] + side(current)["deck"]), 2)

    def test_frozen_definitions_and_rarity_have_bounded_unit_strength(self):
        heroes = squad()
        heroes[0]["rank"] = "SSS"
        rules = engine().display_rules()
        rules["heroes"]["abrams"]["base_power"] = 8
        current = engine().initial_state(heroes, squad("b"), rules=rules,
                                        definitions_a={"bebop": {"attack": 99999, "effect": "DAMAGE", "effect_amount": 5}})
        a_cards = side(current)["hand"] + side(current)["deck"]
        self.assertEqual({card["base_power"] for card in a_cards if card["hero_key"] == "abrams"}, {11})
        self.assertTrue(all(card["protected"] for card in a_cards if card["hero_key"] == "abrams"))
        self.assertEqual({card["base_power"] for card in a_cards if card["hero_key"] == "bebop"}, {8})
        self.assertEqual({card["effect_amount"] for card in a_cards if card["hero_key"] == "bebop"}, {5})

    def test_damage_reduces_modified_strength_by_its_exact_amount(self):
        current = ready()
        target = on_board(current, "B", hero="haze")
        target["boost"] = 2
        side(current, "B")["horns"] = [1]
        card = take_card(current, hero="bebop")
        current, _ = engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"], "row": 0,
                                                          "target_id": target["id"]})
        self.assertEqual(side(current, "B")["score"], (target["base_power"] + 2) * 2 - 2)

    def test_damage_can_finish_a_unit_that_was_boosted(self):
        current = ready(engine().initial_state(squad(), squad("b"),
                                               definitions_a={"bebop": {"effect_amount": 6}}))
        target = on_board(current, "B")
        target["boost"] = 2
        card = take_card(current, hero="bebop")
        current, _ = engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"], "row": 0,
                                                          "target_id": target["id"]})
        self.assertEqual(side(current, "B")["score"], 1)
        current["turn_side"] = "A"
        card = take_card(current, hero="seven")
        current, _ = engine().apply_action(current, "A", {"type": "PLAY", "card_id": card["id"], "row": 2,
                                                          "target_id": target["id"]})
        self.assertEqual(side(current, "B")["rows"][0], [])
        self.assertIn(target["id"], {value["id"] for value in side(current, "B")["graveyard"]})

    def test_frozen_combat_base_power_cannot_exceed_bounded_strength(self):
        current = engine().initial_state(squad(), squad("b"), definitions_a={"abrams": {"base_power": 999}})
        self.assertEqual({card["base_power"] for card in side(current)["hand"] + side(current)["deck"]
                          if card["hero_key"] == "abrams"}, {8})

    def test_effect_description_matches_approved_effect_and_amount(self):
        current = engine().initial_state(squad(), squad("b"),
                                        definitions_a={"abrams": {"effect": "DAMAGE", "effect_amount": 4}})
        card = next(card for card in side(current)["hand"] + side(current)["deck"] if card["hero_key"] == "abrams")
        self.assertEqual(card["effect"], "DAMAGE")
        self.assertIn("enemy", card["description"]["en"])
        self.assertIn("4", card["description"]["en"])

    def test_card_preview_matches_the_same_approved_definition_as_battle_units(self):
        definition = {"attack": 130, "name": {"ru": "Абрамс v2", "en": "Abrams v2"}, "effect_amount": 4}
        rules = engine().display_rules()
        preview = engine().card_preview("abrams", "F", definition=definition, rules=rules)
        current = engine().initial_state(squad(), squad("b"), rules=rules, definitions_a={"abrams": definition})
        card = next(card for card in side(current)["hand"] + side(current)["deck"] if card["hero_key"] == "abrams")
        self.assertEqual(preview["power"], 8)
        for field in ("power", "base_power", "name", "rows", "effect", "effect_amount", "description", "protected"):
            self.assertEqual(preview[field], card[field], field)


class TacticTests(unittest.TestCase):
    def test_spy_gives_opponent_strength_and_draws_two_cards(self):
        current = ready()
        spy = take_card(current, effect="SPY")
        before = (len(side(current)["hand"]), len(side(current)["deck"]))
        current, events = engine().apply_action(current, "A", {"type": "PLAY", "card_id": spy["id"], "row": 2})
        self.assertEqual((len(side(current)["hand"]), len(side(current)["deck"])), (before[0] + 1, before[1] - 2))
        self.assertEqual(side(current, "B")["rows"][2][0]["id"], spy["id"])
        self.assertEqual(side(current, "B")["score"], 1)
        draw_event = next(event for event in events if event["type"] == "DRAW")
        self.assertEqual(draw_event, {"type": "DRAW", "side": "A", "count": 2})

    def test_spy_draws_only_remaining_cards_and_rejects_full_enemy_row(self):
        current = ready()
        spy = take_card(current, effect="SPY")
        side(current)["graveyard"].extend(side(current)["deck"][1:])
        side(current)["deck"] = side(current)["deck"][:1]
        current, events = engine().apply_action(current, "A", {"type": "PLAY", "card_id": spy["id"], "row": 0})
        self.assertEqual(len(side(current)["deck"]), 0)
        self.assertEqual(next(event["count"] for event in events if event["type"] == "DRAW"), 1)
        current = ready()
        spy = take_card(current, effect="SPY")
        side(current, "B")["rows"][0] = [{**deepcopy(spy), "id": f"full-{index}"} for index in range(9)]
        before = deepcopy(current)
        with self.assertRaises(ValueError):
            engine().apply_action(current, "A", {"type": "PLAY", "card_id": spy["id"], "row": 0})
        self.assertEqual(current, before)

    def test_weather_affects_both_sides_and_clear_restores_power(self):
        current = ready()
        own, enemy = on_board(current), on_board(current, "B")
        current, _ = play_effect(current, "WEATHER", row=0)
        self.assertEqual(current["weather"], [0])
        self.assertEqual([actor["score"] for actor in current["sides"]], [1, 1])
        current, _ = play_effect(current, "CLEAR_WEATHER")
        self.assertEqual(current["weather"], [])
        self.assertEqual([actor["score"] for actor in current["sides"]], [own["base_power"], enemy["base_power"]])

    def test_horn_doubles_owned_row_and_protected_units_ignore_modifiers(self):
        current = ready()
        target = on_board(current)
        immune = on_board(current, hero="dynamo")
        immune["protected"] = True
        current, _ = play_effect(current, "HORN", row=0)
        self.assertEqual(side(current)["score"], target["base_power"] * 2 + immune["base_power"])
        current, _ = play_effect(current, "WEATHER", row=0)
        self.assertEqual(side(current)["score"], 2 + immune["base_power"])

    def test_scorch_removes_tied_strongest_units_from_both_sides_but_not_protected(self):
        current = ready()
        own = on_board(current)
        enemy = on_board(current, "B")
        protected = on_board(current, "B", hero="haze")
        protected["protected"] = True
        protected["base_power"] = 99
        current, events = play_effect(current, "SCORCH")
        self.assertEqual(side(current)["rows"][0], [])
        self.assertEqual(side(current, "B")["rows"][0], [])
        self.assertEqual(side(current, "B")["rows"][1][0]["id"], protected["id"])
        self.assertIn(own["id"], {card["id"] for card in side(current)["graveyard"]})
        self.assertIn(enemy["id"], {card["id"] for card in side(current, "B")["graveyard"]})
        self.assertTrue(any(event["type"] == "SCORCH" for event in events))

    def test_decoy_returns_owned_unit_to_hand_and_resets_battle_modifiers(self):
        current = ready()
        target = on_board(current)
        target.update(boost=2, damage=1)
        decoy = take_card(current, effect="DECOY")
        current, _ = engine().apply_action(current, "A", {"type": "PLAY", "card_id": decoy["id"], "target_id": target["id"]})
        recalled = next(card for card in side(current)["hand"] if card["id"] == target["id"])
        self.assertEqual((recalled["power"], recalled["boost"], recalled["damage"]), (target["base_power"], 0, 0))
        self.assertEqual(side(current)["rows"], [[], [], []])
        self.assertIn(decoy["id"], {card["id"] for card in side(current)["graveyard"]})

    def test_decoy_rejects_enemy_or_protected_targets_and_special_rows_are_validated(self):
        current = ready()
        own = on_board(current)
        own["protected"] = True
        enemy = on_board(current, "B")
        decoy = take_card(current, effect="DECOY")
        before = deepcopy(current)
        for identity in (own["id"], enemy["id"], "missing"):
            with self.assertRaises(ValueError):
                engine().apply_action(current, "A", {"type": "PLAY", "card_id": decoy["id"], "target_id": identity})
            self.assertEqual(current, before)
        for effect in ("WEATHER", "HORN"):
            tactic = take_card(current, effect=effect)
            before = deepcopy(current)
            with self.assertRaises(ValueError):
                engine().apply_action(current, "A", {"type": "PLAY", "card_id": tactic["id"], "row": 3})
            self.assertEqual(current, before)


class PatronTests(unittest.TestCase):
    def test_hidden_king_damages_enemy_once_per_match_and_consumes_turn(self):
        current = ready(engine().initial_state(squad(), squad("b"), base_a="HIDDEN_KING"))
        target = on_board(current, "B")
        turn = current["turn"]
        current, _ = engine().apply_action(current, "A", {"type": "LEADER", "target_id": target["id"]})
        self.assertTrue(side(current)["leader_used"])
        self.assertEqual((current["turn"], current["turn_side"]), (turn + 1, "B"))
        self.assertEqual(side(current, "B")["score"], target["base_power"] - 4)
        current["turn_side"] = "A"
        with self.assertRaises(ValueError):
            engine().apply_action(current, "A", {"type": "LEADER", "target_id": target["id"]})

    def test_archmother_clears_weather_and_boosts_chosen_row(self):
        current = ready(engine().initial_state(squad(), squad("b"), base_a="ARCHMOTHER"))
        target = on_board(current)
        current["weather"] = [0, 1]
        current, _ = engine().apply_action(current, "A", {"type": "LEADER", "row": 0})
        self.assertEqual(current["weather"], [])
        self.assertEqual(side(current)["score"], target["base_power"] + 2)
        self.assertTrue(side(current)["leader_used"])

    def test_leader_rejects_missing_or_immune_targets_and_after_pass(self):
        current = ready(engine().initial_state(squad(), squad("b"), base_a="HIDDEN_KING"))
        target = on_board(current, "B")
        target["protected"] = True
        before = deepcopy(current)
        for command in ({"type": "LEADER"}, {"type": "LEADER", "target_id": target["id"]}, {"type": "LEADER", "row": 0}):
            with self.assertRaises(ValueError):
                engine().apply_action(current, "A", command)
            self.assertEqual(current, before)
        current, _ = engine().apply_action(current, "A", {"type": "PASS"})
        with self.assertRaises(ValueError):
            engine().apply_action(current, "A", {"type": "LEADER", "target_id": target["id"]})

    def test_frozen_gwent_patron_ability_is_preserved_without_mutating_rules(self):
        rules = engine().display_rules()
        rules["bases"]["HIDDEN_KING"]["ability"]["effect_amount"] = 2
        before = deepcopy(rules)
        current = ready(engine().initial_state(squad(), squad("b"), base_a="HIDDEN_KING", rules=rules))
        target = on_board(current, "B")
        current, _ = engine().apply_action(current, "A", {"type": "LEADER", "target_id": target["id"]})
        self.assertEqual(side(current, "B")["score"], target["base_power"] - 2)
        self.assertEqual(rules, before)


class BotTests(unittest.TestCase):
    def test_bot_passes_when_a_passed_opponent_is_already_beaten(self):
        current = ready()
        on_board(current, "B")
        current["turn_side"] = "B"
        side(current)["passed"] = True
        current, _ = engine().apply_action(current, "B", {"type": "PLAY", "card_id": take_card(current, "B", hero="dynamo")["id"], "row": 0})
        self.assertEqual(engine().bot_action(current), {"type": "PASS"})

    def test_bot_finishes_games_deterministically_without_mutating_decision_input(self):
        for difficulty in ("TUTORIAL", "NORMAL", "HARD"):
            current = engine().initial_state(squad(), squad("b"), base_a="HIDDEN_KING", base_b="ARCHMOTHER", seed="bot-loop")
            for _ in range(100):
                key = current["turn_side"]
                before = deepcopy(current)
                command = engine().bot_action(current, key, difficulty)
                self.assertEqual(command, engine().bot_action(current, key, difficulty))
                self.assertEqual(current, before)
                engine().validate_action(current, key, command)
                current, _ = engine().apply_action(current, key, command)
                if current["status"] == "FINISHED":
                    break
            self.assertEqual(current["status"], "FINISHED", difficulty)
            self.assertLessEqual(current["round"], 3)

    def test_bot_handles_no_hand_and_all_rows_full(self):
        current = ready()
        current["turn_side"] = "B"
        actor = side(current, "B")
        actor["graveyard"].extend(actor["hand"])
        actor["hand"] = []
        self.assertEqual(engine().bot_action(current), {"type": "PASS"})
        current = ready()
        current["turn_side"] = "B"
        actor = side(current, "B")
        actor["hand"] = [card for card in actor["hand"] if card["hero_key"]]
        fill = {"id": "full", "kind": "UNIT", "hero_key": "abrams", "effect": "BOOST",
                "base_power": 5, "power": 5, "protected": False, "boost": 0, "damage": 0}
        actor["rows"] = [[{**fill, "id": f"full-{row}-{index}"} for index in range(9)] for row in range(3)]
        self.assertEqual(engine().bot_action(current), {"type": "PASS"})

    def test_bot_decision_does_not_depend_on_hidden_enemy_card_identities(self):
        current = ready()
        current["turn_side"] = "B"
        altered = deepcopy(current)
        for card in side(altered)["hand"] + side(altered)["deck"]:
            card.update(id="unseen-change", hero_key="unseen", base_power=999, effect="unseen")
        self.assertEqual(engine().bot_action(current), engine().bot_action(altered))

    def test_accepted_actions_preserve_every_card_identity_during_complete_games(self):
        for seed in ("conservation-one", "conservation-two", "conservation-three"):
            current = engine().initial_state(squad(), squad("b"), seed=seed)
            expected = {card["id"] for actor in current["sides"] for zone in (actor["hand"], actor["deck"])
                        for card in zone}
            while current["status"] == "ACTIVE":
                key = current["turn_side"]
                command = engine().bot_action(current, key)
                old_turn = current["turn"]
                current, _ = engine().apply_action(current, key, command)
                self.assertEqual(current["turn"], old_turn + 1)
                identities = [card["id"] for actor in current["sides"]
                              for zone in (actor["hand"], actor["deck"], actor["graveyard"], actor["_mulligan_stash"], *actor["rows"])
                              for card in zone]
                self.assertEqual(len(identities), 48)
                self.assertEqual(set(identities), expected)
                for actor in current["sides"]:
                    self.assertTrue(all(len(row) <= 9 for row in actor["rows"]))
                    self.assertEqual(actor["score"], sum(actor["row_scores"]))
                    self.assertEqual(actor["score"], sum(card["power"] for row in actor["rows"] for card in row))
                self.assertLess(current["turn"], 100)


if __name__ == "__main__":
    unittest.main()
