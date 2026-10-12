from copy import deepcopy

import pytest


def engine():
    from app.services import card_battle
    return card_battle


def squad(prefix="a"):
    return [{"id": f"{prefix}{i}", "hero_key": hero, "rank": "F", "line": i // 2,
             "position": "FRONT" if i % 2 == 0 else "BACK"}
            for i, hero in enumerate(("abrams", "bebop", "dynamo", "haze", "ivy", "seven"))]


def state():
    return engine().initial_state(squad(), squad("b"))


def test_rank_scaling_and_exact_budget():
    e = engine()
    assert e.stats("haze", "A")["attack"] == 108
    assert e.stats("haze", "SSS")["max_hp"] == 448
    values = squad()
    for i, rank in enumerate(("SSS", "SS", "B", "F", "F", "F")):
        values[i]["rank"] = rank
    assert e.validate_squad(values, "ORDINARY") == 24
    with pytest.raises(ValueError, match="budget"):
        e.validate_squad(values, "HIDDEN_KING")
    values[1]["hero_key"] = "abrams"
    with pytest.raises(ValueError, match="different"):
        e.validate_squad(values, "ORDINARY")


def test_normal_attacks_are_simultaneous_and_input_is_immutable():
    e = engine()
    current = state()
    a, b = current["sides"]
    a["heroes"][0]["hp"] = b["heroes"][0]["hp"] = 1
    before = deepcopy(current)
    after, events = e.resolve_round(current, [], [])
    assert current == before
    assert after["sides"][0]["heroes"][0]["hp"] == 0
    assert after["sides"][1]["heroes"][0]["hp"] == 0
    assert sum(event["type"] == "DAMAGE" for event in events) >= 12


def test_guardian_retaliates_when_destroyed_but_damage_does_not_overflow():
    e = engine()
    current = state()
    b = current["sides"][1]
    for hero in b["heroes"][:2]:
        hero.update(hp=0, deaths=2, respawn_round=None)
    b["guardians"][0]["hp"] = 1
    after, _ = e.resolve_round(current, [], [])
    assert after["sides"][1]["base"]["hp"] == 1000
    assert after["sides"][1]["guardians"][0]["hp"] == 0
    assert after["sides"][0]["heroes"][0]["hp"] == 599


def test_death_skips_two_rounds_then_respawns_and_cooldown_keeps_running():
    e = engine()
    current = state()
    current["sides"][0]["heroes"][0]["hp"] = 1
    current, _ = e.resolve_round(current, [], [])
    hero = current["sides"][0]["heroes"][0]
    assert hero["respawn_round"] == 4 and current["round"] == 2
    current, _ = e.resolve_round(current, [], [])
    assert current["sides"][0]["heroes"][0]["hp"] == 0
    current, _ = e.resolve_round(current, [], [])
    assert current["round"] == 4
    assert current["sides"][0]["heroes"][0]["hp"] == 650


def test_plan_enforces_energy_one_ability_and_live_reserved_slots():
    e = engine()
    current = state()
    with pytest.raises(ValueError, match="active"):
        e.validate_plan(current, "A", [{"type": "HERO_ABILITY", "actor_id": "a0"},
                                       {"type": "HERO_ABILITY", "actor_id": "a2"}])
    current["sides"][0]["heroes"][0]["hp"] = 0
    with pytest.raises(ValueError, match="living"):
        e.validate_plan(current, "A", [{"type": "SWAP", "first_id": "a0", "second_id": "a1"}])


def test_swaps_are_applied_before_ability_target_validation():
    e = engine()
    current = state()
    actions = [{"type": "HERO_ABILITY", "actor_id": "a1", "target_id": "b2"},
               {"type": "SWAP", "first_id": "a1", "second_id": "a2"}]
    e.validate_plan(current, "A", actions)
    after, _ = e.resolve_round(current, actions, [])
    assert after["sides"][0]["heroes"][1]["line"] == 1


def test_round_twelve_tie_uses_exact_health_fractions():
    e = engine()
    current = state()
    current["round"] = 12
    after, _ = e.resolve_round(current, [], [])
    assert after["status"] == "FINISHED"
    assert after["result"]["winner_side"] is None


def test_all_hero_abilities_and_both_patrons_produce_legal_plans():
    e = engine()
    for key in e.HEROES:
        values = squad()
        existing = next((i for i, value in enumerate(values) if value["hero_key"] == key), None)
        if existing is None:
            values[0]["hero_key"] = key
        current = e.initial_state(values, squad("b"), base_a="ARCHMOTHER")
        plan = e.bot_plan(current, "A", "HARD")
        e.validate_plan(current, "A", plan)
        after, _ = e.resolve_round(current, plan, [])
        assert after["round"] == 2
    current = e.initial_state(squad(), squad("b"), base_a="HIDDEN_KING")
    after, _ = e.resolve_round(current, [{"type": "BASE_ABILITY", "target_id": "a0"}], [])
    assert after["sides"][1]["guardians"][0]["hp"] == 100


def test_sealed_target_fizzles_when_opponent_moves_it_out_of_lane():
    current = state()
    after, events = engine().resolve_round(current,
        [{"type": "HERO_ABILITY", "actor_id": "a1", "target_id": "b1"}],
        [{"type": "SWAP", "first_id": "b1", "second_id": "b2"}])
    assert any(value["type"] == "FIZZLE" and value["reason"] == "TARGET_MOVED" for value in events)
    assert not any(value.get("phase") == "ACTIVE" and value.get("source_id") == "a1" for value in events if value["type"] == "DAMAGE")
    assert after["sides"][0]["heroes"][1]["ready_round"] == 4


@pytest.mark.parametrize("key", list(("abrams", "bebop", "dynamo", "haze", "ivy", "kelvin", "seven", "infernus", "wraith", "mcginnis", "lady-geist", "venator")))
def test_every_ability_exact_parameters_and_cooldown(key):
    values = squad()
    found = next((i for i, hero in enumerate(values) if hero["hero_key"] == key), None)
    if found is not None:
        values[0]["hero_key"], values[found]["hero_key"] = values[found]["hero_key"], values[0]["hero_key"]
    else: values[0]["hero_key"] = key
    current = engine().initial_state(values, squad("b"))
    actor, ally = current["sides"][0]["heroes"][:2]
    actor["hp"] -= 100; ally["hp"] -= 150
    action = {"type": "HERO_ABILITY", "actor_id": "a0"}
    target = actor["ability"]["target"]
    if target == "ENEMY": action["target_id"] = "b1"
    elif target in {"ALLY", "OTHER_ALLY"}: action["target_id"] = "a1"
    assert engine().validate_plan(current, "A", [action]) == 2
    after, events = engine().resolve_round(current, [action], [])
    actual = [event for event in events if event.get("source_id") == "a0"]
    assert after["sides"][0]["heroes"][0]["ready_round"] == 4
    expected_damage = {"bebop": [99], "haze": [93], "seven": [70, 70], "infernus": [70], "wraith": [90], "lady-geist": [130], "venator": [90]}
    if key in expected_damage:
        assert [event["amount"] for event in actual if event["type"] == "DAMAGE" and event["phase"] == "ACTIVE"] == expected_damage[key]
    expected_shields = {"abrams": [100], "dynamo": [70, 70], "kelvin": [50]}
    if key in expected_shields: assert [event["amount"] for event in actual if event["type"] == "SHIELD"] == expected_shields[key]
    if key in {"ivy", "kelvin"}: assert [event["amount"] for event in actual if event["type"] == "HEAL"] == [100 if key == "ivy" else 60]
    if key == "mcginnis":
        assert after["sides"][0]["heroes"][0]["buff_until"] == 2
        assert [event["amount"] for event in actual if event["type"] == "DAMAGE"] == [93]
    if key == "lady-geist": assert after["sides"][0]["heroes"][0]["hp"] < actor["hp"] - 40


def test_ability_numeric_parameters_are_frozen_in_state_rules():
    current = state()
    current["sides"][0]["heroes"][1]["ability"]["damage"] = 200
    _, events = engine().resolve_round(current, [{"type": "HERO_ABILITY", "actor_id": "a1", "target_id": "b1"}], [])
    assert next(value["amount"] for value in events if value.get("phase") == "ACTIVE") == 180


def test_infernus_burn_occurs_only_at_end_of_two_next_rounds():
    values = squad(); values[0]["hero_key"] = "infernus"
    current = engine().initial_state(values, squad("b"))
    current, events = engine().resolve_round(current, [{"type": "HERO_ABILITY", "actor_id": "a0"}], [])
    assert not [value for value in events if value.get("phase") == "END"]
    for _ in range(2):
        current, events = engine().resolve_round(current, [], [])
        assert [value["amount"] for value in events if value.get("phase") == "END" and value["type"] == "DAMAGE"] == [20]
    current, events = engine().resolve_round(current, [], [])
    assert not [value for value in events if value.get("phase") == "END"]


def test_base_passive_and_duration_and_second_death():
    current = engine().initial_state(squad(), squad("b"), base_a="ARCHMOTHER")
    _, events = engine().resolve_round(current, [{"type": "HERO_ABILITY", "actor_id": "a2"}], [])
    assert [value["amount"] for value in events if value["type"] == "SHIELD"] == [81, 70]
    after, events = engine().resolve_round(current, [{"type": "BASE_ABILITY", "line": 0}], [])
    assert [value["amount"] for value in events if value["type"] == "SHIELD"] == [100, 100]
    assert after["sides"][0]["heroes"][1]["shield"] == 100
    after, _ = engine().resolve_round(after, [], [])
    assert after["sides"][0]["heroes"][1]["shield"] == 0
    current = state(); current["sides"][0]["heroes"][0].update(hp=1, deaths=1)
    after, _ = engine().resolve_round(current, [], [])
    assert after["sides"][0]["heroes"][0]["deaths"] == 2
    assert after["sides"][0]["heroes"][0]["respawn_round"] is None


def test_both_bases_destroyed_simultaneously_is_draw_and_control_cannot_repeat():
    current = state()
    for index, side in enumerate(current["sides"]):
        side["base"]["hp"] = 1
        for guardian in side["guardians"]: guardian["hp"] = 0
        for hero in side["heroes"][:2]: hero.update(hp=0, deaths=2, respawn_round=None)
        for hero in side["heroes"][2:]: hero["line"] = index
    after, _ = engine().resolve_round(current, [], [])
    assert after["result"] == {"winner_side": None, "reason": "BASE_DESTROYED"}
    current = state(); current["sides"][0]["heroes"][1]["skip_attack_round"] = 1
    current, events = engine().resolve_round(current, [], [])
    assert not [value for value in events if value.get("phase") == "NORMAL" and value.get("source_id") == "a1"]
    current["sides"][0]["heroes"][1]["skip_attack_round"] = 2
    _, events = engine().resolve_round(current, [], [])
    assert [value for value in events if value.get("phase") == "NORMAL" and value.get("source_id") == "a1"]


def test_mirror_heroes_and_bases_keep_separate_approved_versions():
    e = engine()
    abrams = deepcopy(e.HEROES["abrams"]); abrams.update(hp=900, attack=200); abrams["ability"]["shield"] = 150
    mother = deepcopy(e.BASES["ARCHMOTHER"]); mother["passive_bonus_percent"] = 20; mother["ability"]["shield"] = 180
    current = e.initial_state(squad(), squad("b"), base_a="ARCHMOTHER", base_b="ARCHMOTHER",
                              definitions_a={"abrams": abrams, "ARCHMOTHER": mother})
    first, second = current["sides"]
    assert first["heroes"][0]["max_hp"] == 900 and second["heroes"][0]["max_hp"] == 650
    _, events = e.resolve_round(current, [{"type": "HERO_ABILITY", "actor_id": "a0"}], [{"type": "HERO_ABILITY", "actor_id": "b0"}])
    assert [(event["source_id"], event["amount"]) for event in events if event["type"] == "SHIELD"] == [("a0", 180), ("b0", 115)]
    _, events = e.resolve_round(current, [{"type": "BASE_ABILITY", "line": 0}], [{"type": "BASE_ABILITY", "line": 0}])
    assert [event["amount"] for event in events if event["type"] == "SHIELD"] == [180, 180, 100, 100]


def test_hard_bot_searches_positions_and_plans_are_deterministic():
    current = state()
    for side in current["sides"]:
        for hero in side["heroes"]: hero["ready_round"] = 99
    current["sides"][0]["heroes"][0]["hp"] = 1
    before = deepcopy(current)
    plan = engine().bot_plan(current, "A", "HARD")
    assert any(value["type"] == "SWAP" for value in plan)
    assert plan == engine().bot_plan(current, "A", "HARD") and current == before


def test_hidden_king_passive_first_structure_attack_only_and_no_shield_stacking():
    current = engine().initial_state(squad(), squad("b"), base_a="HIDDEN_KING")
    for hero in current["sides"][1]["heroes"][:2]: hero.update(hp=0, deaths=2, respawn_round=None)
    for hero in current["sides"][0]["heroes"][:2]: hero["hp"] = hero["max_hp"] * 40 // 100
    _, events = engine().resolve_round(current, [], [])
    normal = [value for value in events if value.get("phase") == "NORMAL" and value.get("target_id") == "B:guard:0"]
    assert [value["amount"] for value in normal] == [77, 75]
    current = state(); current["sides"][0]["heroes"][0].update(shield=150, shield_expires_round=2)
    after, events = engine().resolve_round(current, [{"type": "HERO_ABILITY", "actor_id": "a0"}], [])
    damage = sum(value["blocked"] for value in events if value["type"] == "DAMAGE" and value["target_id"] == "a0")
    assert damage == 150 and after["sides"][0]["heroes"][0]["shield"] == 0


def test_side_permutation_and_replay_across_full_matches():
    e = engine()
    for offset in range(3):
        first, second = squad(), squad("b")
        keys = list(e.HEROES)
        for index, hero in enumerate(second): hero["hero_key"] = keys[offset + index]
        current = e.initial_state(first, second, base_a="HIDDEN_KING", base_b="ARCHMOTHER")
        swapped = e.initial_state(second, first, base_a="ARCHMOTHER", base_b="HIDDEN_KING")
        while current["status"] == "ACTIVE":
            a, b = e.bot_plan(current, "A"), e.bot_plan(current, "B")
            again, events = e.resolve_round(current, a, b)
            assert e.resolve_round(current, a, b) == (again, events)
            swapped, _ = e.resolve_round(swapped, b, a)
            for original, mirror in zip(again["sides"], reversed(swapped["sides"])):
                assert [hero["hp"] for hero in original["heroes"]] == [hero["hp"] for hero in mirror["heroes"]]
                assert original["base"]["hp"] == mirror["base"]["hp"]
            current = again
        winner = current["result"]["winner_side"]
        assert swapped["result"]["winner_side"] == ({"A": "B", "B": "A"}.get(winner))
