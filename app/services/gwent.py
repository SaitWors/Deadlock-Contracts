"""Pure, versioned Gwent-style combat. The archive catalogue supplies data only."""
import hashlib
import random
from copy import deepcopy

from .card_battle import BASES as ARCHIVE_BASES
from .card_battle import HEROES as ARCHIVE_HEROES
from .card_battle import RANKS as ARCHIVE_RANKS

VERSION = "gwent-v1"
ROWS = (0, 1, 2)
EFFECTS = {
    "abrams": "BOOST", "bebop": "DAMAGE", "dynamo": "BOOST", "haze": "BOND",
    "ivy": "HEAL", "kelvin": "BOOST", "seven": "DAMAGE", "infernus": "DAMAGE",
    "wraith": "MUSTER", "mcginnis": "MUSTER", "lady-geist": "DAMAGE", "venator": "BOND",
}
ROLE_ROWS = {"TANK": [0], "FIGHTER": [0], "SHOOTER": [1], "HUNTER": [1],
             "SUPPORT": [2], "MAGE": [2], "ASSASSIN": [0, 1], "ENGINEER": [1, 2]}
DESCRIPTIONS = {
    "DAMAGE": {"ru": "При выходе уменьшает силу незащищённого врага на 2.",
               "en": "Deploy: reduce an unprotected enemy's strength by 2."},
    "HEAL": {"ru": "При выходе восстанавливает до 3 потерянной силы союзника.",
             "en": "Deploy: restore up to 3 lost strength to an ally."},
    "BOOST": {"ru": "При выходе усиливает другого незащищённого союзника на 2.",
              "en": "Deploy: boost another unprotected ally by 2."},
    "BOND": {"ru": "Сила умножается на число карт этого героя в том же ряду.",
             "en": "Multiply strength by the number of this hero's cards in the same row."},
    "MUSTER": {"ru": "При выходе призывает копии героя из руки и колоды в тот же ряд.",
               "en": "Deploy: summon copies of this hero from your hand and deck to this row."},
}
TACTICS = (
    {"key": "spy", "kind": "UNIT", "effect": "SPY", "base_power": 1,
     "name": {"ru": "Осведомитель", "en": "Informant"},
     "description": {"ru": "Выходит в ряд противника. Возьмите две карты.",
                     "en": "Deploy to an enemy row. Draw two cards."}},
    {"key": "weather", "effect": "WEATHER", "name": {"ru": "Ночной туман", "en": "Night Fog"},
     "description": {"ru": "Уменьшает базовую силу в выбранном ряду обеих сторон до 1.",
                     "en": "Reduce unprotected base strength in the chosen row on both sides to 1."}},
    {"key": "clear", "effect": "CLEAR_WEATHER", "name": {"ru": "Ясное небо", "en": "Clear Skies"},
     "description": {"ru": "Снимает все погодные эффекты.", "en": "Remove all weather effects."}},
    {"key": "horn", "effect": "HORN", "name": {"ru": "Сигнал к атаке", "en": "Rallying Call"},
     "description": {"ru": "Удваивает силу незащищённых союзников в выбранном ряду.",
                     "en": "Double unprotected allied strength in the chosen row."}},
    {"key": "scorch", "effect": "SCORCH", "name": {"ru": "Пепельная вспышка", "en": "Ashfall"},
     "description": {"ru": "Уничтожает все самые сильные незащищённые отряды обеих сторон.",
                     "en": "Destroy every strongest unprotected unit on both sides."}},
    {"key": "decoy", "effect": "DECOY", "name": {"ru": "Приманка", "en": "Decoy"},
     "description": {"ru": "Возвращает незащищённый отряд из своего ряда в руку.",
                     "en": "Return an unprotected unit from your row to your hand."}},
)


def _hero_rule(key, source):
    value = deepcopy(source)
    role = value.get("role", "FIGHTER")
    fallback = "HEAL" if role == "SUPPORT" else "MUSTER" if role == "ENGINEER" else "BOND" if role == "SHOOTER" else "DAMAGE" if role in {"MAGE", "ASSASSIN", "HUNTER"} else "BOOST"
    effect = value.get("effect", EFFECTS.get(key, fallback))
    amount = value.get("effect_amount", 3 if effect == "HEAL" else 2)
    description = value.get("description")
    if description is None or description in DESCRIPTIONS.values():
        description = deepcopy(DESCRIPTIONS.get(effect, {}))
        if effect in {"DAMAGE", "BOOST", "HEAL"}:
            default_amount = "3" if effect == "HEAL" else "2"
            description = {language: text.replace(default_amount, str(amount)) for language, text in description.items()}
    value.update(key=key, base_power=min(8, max(3, value.get("base_power", (value.get("attack", 75) + 7) // 15))),
                 rows=deepcopy(value.get("rows", ROLE_ROWS.get(role, [0, 1, 2]))),
                 effect=effect, effect_amount=amount, description=deepcopy(description))
    return value


def display_rules():
    """Return detached combat and preparation definitions for UI/service freezing."""
    ranks = deepcopy(ARCHIVE_RANKS)
    for key, bonus in zip(ranks, (0, 0, 1, 1, 1, 2, 2, 3, 3)):
        ranks[key]["power_bonus"] = bonus
    bases = deepcopy(ARCHIVE_BASES)
    for key, base in bases.items():
        if key == "HIDDEN_KING":
            base["ability"] = {"name": {"ru": "Сделка в тени", "en": "Shadow Bargain"},
                "description": {"ru": "Один раз за матч: уменьшите силу незащищённого врага на 4.",
                                "en": "Once per match: reduce an unprotected enemy's strength by 4."},
                "effect": "DAMAGE", "effect_amount": 4, "target": "ENEMY"}
        elif key == "ARCHMOTHER":
            base["ability"] = {"name": {"ru": "Материнский покров", "en": "Mother's Protection"},
                "description": {"ru": "Один раз за матч: снимите погоду и усильте союзников выбранного ряда на 2.",
                                "en": "Once per match: clear weather and boost unprotected allies in one row by 2."},
                "effect": "BOOST", "effect_amount": 2, "target": "ROW"}
        else:
            base["ability"] = {"name": {"ru": "Без умения", "en": "No ability"},
                               "description": {"ru": "Без умения патрона.", "en": "No patron ability."},
                               "effect": "NONE", "effect_amount": 0, "target": "NONE"}
    return {"version": VERSION, "game": "GWENT", "budget": 24, "max_sss": 2,
            "max_rounds": 3, "rounds_to_win": 2, "deck_size": 24, "opening_hand": 10,
            "mulligans": 2, "row_capacity": 9,
            "rows": [{"id": index, "name": {"ru": ru, "en": en}} for index, ru, en in
                     ((0, "Улица", "Street"), (1, "Крыши", "Rooftops"), (2, "Ритуал", "Ritual"))],
            "ranks": ranks, "heroes": {key: _hero_rule(key, value) for key, value in ARCHIVE_HEROES.items()},
            "bases": bases, "tactics": deepcopy(list(TACTICS))}


def _freeze_rules(rules):
    frozen = display_rules()
    for group in ("heroes", "bases"):
        for key, definition in (rules or {}).get(group, {}).items():
            if key in frozen[group]:
                old = frozen[group][key]
                base_ability = deepcopy(old.get("ability", {}))
                old.update(deepcopy(definition))
                if group == "heroes":
                    if "attack" in definition and "base_power" not in definition:
                        old.pop("base_power", None)
                    converted = _hero_rule(key, old)
                    converted["effect_amount"] = definition.get("effect_amount", converted["effect_amount"])
                    frozen[group][key] = converted
                else:
                    # Existing archive patron abilities describe legacy HP combat.
                    old["ability"] = _patron_ability(definition.get("ability", {}), base_ability)
    return frozen


def _patron_ability(supplied, default):
    if supplied.get("effect") != default["effect"] or type(supplied.get("effect_amount")) is not int or supplied["effect_amount"] < 0:
        return deepcopy(default)
    ability = {**deepcopy(default), **deepcopy(supplied)}
    if ability.get("description") == default.get("description") and ability["effect_amount"] != default["effect_amount"]:
        ability["description"] = {language: text.replace(str(default["effect_amount"]), str(ability["effect_amount"]))
                                  for language, text in default["description"].items()}
    return ability


def _validate_squad(heroes, base, rules):
    if not isinstance(heroes, list) or len(heroes) != 6 or len({hero.get("hero_key") for hero in heroes}) != 6:
        raise ValueError("Choose six different heroes")
    if base not in rules["bases"] or any(hero.get("hero_key") not in rules["heroes"] or hero.get("rank") not in rules["ranks"] for hero in heroes):
        raise ValueError("Unknown battle definition")
    cost = rules["bases"][base]["cost"] + sum(rules["ranks"][hero["rank"]]["cost"] for hero in heroes)
    if cost > 24 or sum(hero["rank"] == "SSS" for hero in heroes) > 2:
        raise ValueError("Squad budget exceeded: choose at most two SSS within 24 points")


def _resolved_hero(hero_key, definition, rules):
    override = deepcopy(definition or {})
    source = {**deepcopy(rules["heroes"][hero_key]), **override}
    if "attack" in override and "base_power" not in override:
        source.pop("base_power", None)
    if ("effect" in override or "effect_amount" in override) and "description" not in override:
        source.pop("description", None)
    return _hero_rule(hero_key, source)


def _preview_fields(hero_key, rank, definition, rules):
    strength = definition["base_power"] + rules["ranks"][rank]["power_bonus"]
    return {"hero_key": hero_key, "rank": rank, "power": strength, "base_power": strength,
            "name": deepcopy(definition["name"]), "rows": deepcopy(definition["rows"]),
            "effect": definition["effect"], "effect_amount": definition["effect_amount"],
            "description": deepcopy(definition["description"]), "protected": rank == "SSS"}


def card_preview(hero_key, rank, *, definition=None, rules=None):
    """Resolve collection strength and effects through the same approved rules as a match."""
    frozen = _freeze_rules(rules)
    if hero_key not in frozen["heroes"] or rank not in frozen["ranks"]:
        raise ValueError("Unknown battle definition")
    resolved = _resolved_hero(hero_key, definition, frozen)
    return _preview_fields(hero_key, rank, resolved, frozen)


def _resolved_patron(base_key, definition, frozen):
    override = definition or {}
    resolved = deepcopy(frozen["bases"][base_key])
    resolved.update({field: deepcopy(value) for field, value in override.items() if field != "ability"})
    resolved["ability"] = _patron_ability(override.get("ability", {}), resolved["ability"])
    return resolved


def patron_preview(base_key, *, definition=None, rules=None):
    """Resolve an approved patron exactly as its frozen combat instance."""
    frozen = _freeze_rules(rules)
    if base_key not in frozen["bases"]:
        raise ValueError("Unknown patron")
    return _resolved_patron(base_key, definition, frozen)


def _unit_card(raw, definition, key, index, copy_no, rules):
    card = {**deepcopy(raw), **_preview_fields(raw["hero_key"], raw["rank"], definition, rules),
            "id": f"{key}:unit:{index}:{copy_no}", "source_id": raw.get("id"),
            "kind": "UNIT", "boost": 0, "damage": 0}
    image = (raw.get("card") or {}).get("image_url") or raw.get("image_url") or definition.get("image_url")
    if image:
        card["image_url"] = image
    return card


def initial_state(heroes_a, heroes_b, *, base_a="ORDINARY", base_b="ORDINARY", rules=None,
                  definitions_a=None, definitions_b=None, seed="", first_side="A"):
    """Build two 24-card decks from six frozen physical source heroes each."""
    if not isinstance(first_side, str) or first_side not in {"A", "B"}:
        raise ValueError("Choose A or B as the opening starter")
    frozen, sides = _freeze_rules(rules), []
    for key, heroes, base_key, definitions in (("A", heroes_a, base_a, definitions_a or {}),
                                               ("B", heroes_b, base_b, definitions_b or {})):
        _validate_squad(heroes, base_key, frozen)
        cards, sources = [], []
        for index, raw in enumerate(heroes):
            hero_key = raw["hero_key"]
            definition = _resolved_hero(hero_key, definitions.get(hero_key), frozen)
            source = deepcopy(raw)
            source["name"] = deepcopy(definition["name"])
            image = (raw.get("card") or {}).get("image_url") or raw.get("image_url") or definition.get("image_url")
            if image:
                source["image_url"] = image
            sources.append(source)
            cards.extend(_unit_card(raw, definition, key, index, copy_no, frozen) for copy_no in range(3))
        for tactic in frozen["tactics"]:
            power = tactic.get("base_power", 0)
            cards.append({**deepcopy(tactic), "id": f"{key}:tactic:{tactic['key']}", "kind": tactic.get("kind", "SPECIAL"),
                          "hero_key": None, "rank": "TACTIC", "power": power, "base_power": power,
                          "rows": list(ROWS), "effect_amount": 2 if tactic["effect"] == "SPY" else 0,
                          "protected": False, "boost": 0, "damage": 0})
        digest = hashlib.sha256(f"{VERSION}:{seed}:{key}".encode()).digest()
        random.Random(int.from_bytes(digest, "big")).shuffle(cards)
        base_rule = _resolved_patron(base_key, definitions.get(base_key), frozen)
        base = {"id": f"{key}:base", "key": base_key, "name": deepcopy(base_rule["name"]),
                "rules": base_rule, "ability": deepcopy(base_rule["ability"])}
        if base_rule.get("image_url"):
            base["image_url"] = base_rule["image_url"]
        sides.append({"side": key, "heroes": sources, "base": base, "hand": cards[:10], "deck": cards[10:],
                      "rows": [[], [], []], "graveyard": [], "passed": False, "wins": 0, "score": 0,
                      "row_scores": [0, 0, 0], "leader_used": False, "mulligans_remaining": 2,
                      "mulligan_done": False, "horns": [], "_mulligan_stash": []})
    return {"game": "GWENT", "rules": frozen, "round": 1, "turn": 0, "phase": "MULLIGAN",
            "turn_side": first_side, "round_starter": first_side, "weather": [], "history": [],
            "status": "ACTIVE", "result": None, "sides": sides}


def _side(state, key):
    if not isinstance(key, str) or key not in {"A", "B"}:
        raise ValueError("Unknown side")
    return next(value for value in state["sides"] if value["side"] == key)


def _enemy_key(key):
    return "B" if key == "A" else "A"


def _hand_card(side, identity):
    return next((card for card in side["hand"] if card["id"] == identity), None)


def _row(action):
    row = action.get("row")
    if type(row) is not int or row not in ROWS:
        raise ValueError("Choose a legal row")
    return row


def _board_units(actor):
    return [card for row in actor["rows"] for card in row if card["kind"] == "UNIT"]


def _target(actor, identity):
    return next((card for card in _board_units(actor) if card["id"] == identity and not card["protected"]), None)


def _validate_target(actor, identity, *, damaged=False):
    card = _target(actor, identity)
    if card is None or (damaged and card.get("damage", 0) <= 0):
        raise ValueError("Choose a legal unprotected target")
    return card


def validate_action(state, side_key, action):
    """Validate without mutation. Clients never provide combat stats or results."""
    if state.get("game") != "GWENT" or state.get("rules", {}).get("version") != VERSION:
        raise ValueError("Unsupported Gwent rules version")
    if state.get("status") != "ACTIVE":
        raise ValueError("Match is finished")
    actor = _side(state, side_key)
    allowed = {"PLAY": {"type", "card_id", "row", "target_id"}, "PASS": {"type"},
               "LEADER": {"type", "row", "target_id"}, "MULLIGAN": {"type", "card_id"}, "READY": {"type"}}
    if not isinstance(action, dict) or not isinstance(action.get("type"), str) or action["type"] not in allowed or set(action) - allowed[action["type"]]:
        raise ValueError("Unknown action or action field")
    kind = action["type"]
    if state["phase"] == "MULLIGAN":
        if kind not in {"MULLIGAN", "READY"} or actor["mulligan_done"]:
            raise ValueError("Complete your opening mulligan first")
        if kind == "MULLIGAN" and (actor["mulligans_remaining"] <= 0 or not _hand_card(actor, action.get("card_id")) or not actor["deck"]):
            raise ValueError("Mulligan requires an owned card and a remaining replacement")
        return
    if state["phase"] != "PLAY" or kind in {"MULLIGAN", "READY"}:
        raise ValueError("Action is unavailable in this phase")
    if actor["passed"] or state["turn_side"] != side_key:
        raise ValueError("Wait for your turn; passing is final for this round")
    if kind == "PASS":
        return
    if kind == "LEADER":
        if actor["leader_used"] or actor["base"]["key"] == "ORDINARY":
            raise ValueError("Leader ability is unavailable")
        if actor["base"]["key"] == "HIDDEN_KING":
            if action.get("row") is not None:
                raise ValueError("This leader requires a target, not a row")
            _validate_target(_side(state, _enemy_key(side_key)), action.get("target_id"))
        else:
            row = _row(action)
            if action.get("target_id") is not None or not actor["rows"][row]:
                raise ValueError("Choose an occupied allied row")
        return
    card = _hand_card(actor, action.get("card_id"))
    if card is None:
        raise ValueError("Choose a card from your own hand")
    effect = card["effect"]
    if card["kind"] == "UNIT":
        row = _row(action)
        receiver = _side(state, _enemy_key(side_key)) if effect == "SPY" else actor
        if row not in card["rows"] or len(receiver["rows"][row]) >= state["rules"]["row_capacity"]:
            raise ValueError("Illegal or full row")
        if action.get("target_id") is not None:
            if effect not in {"DAMAGE", "HEAL", "BOOST"}:
                raise ValueError("This deployment does not accept a target")
            target_side = _side(state, _enemy_key(side_key)) if effect == "DAMAGE" else actor
            _validate_target(target_side, action["target_id"], damaged=effect == "HEAL")
    elif effect in {"WEATHER", "HORN"}:
        row = _row(action)
        if action.get("target_id") is not None or (effect == "HORN" and row in actor["horns"]):
            raise ValueError("Choose an available row without a unit target")
    elif effect == "DECOY":
        if action.get("row") is not None:
            raise ValueError("Decoy requires a unit target, not a row")
        _validate_target(actor, action.get("target_id"))
    elif effect in {"SCORCH", "CLEAR_WEATHER"}:
        if action.get("row") is not None or action.get("target_id") is not None:
            raise ValueError("This tactic does not accept a row or target")
    else:
        raise ValueError("Unknown combat effect")
    return


def _score(state):
    for actor in state["sides"]:
        for row in ROWS:
            for card in actor["rows"][row]:
                if card["protected"]:
                    card["power"] = card["base_power"]
                    continue
                strength = card["base_power"]
                if row in state["weather"]:
                    strength = min(1, strength)
                if card["effect"] == "BOND":
                    strength *= sum(other["hero_key"] == card["hero_key"] for other in actor["rows"][row])
                strength += card.get("boost", 0)
                if row in actor["horns"]:
                    strength *= 2
                card["power"] = max(0, strength - card.get("damage", 0))
            actor["row_scores"][row] = sum(card["power"] for card in actor["rows"][row])
        actor["score"] = sum(actor["row_scores"])


def _remove_unit(state, card):
    for actor in state["sides"]:
        for row in actor["rows"]:
            if card in row:
                row.remove(card)
                return actor
    raise ValueError("Unit is not on the battlefield")


def _damage(state, card, amount, events, source_id):
    actual = min(amount, card["power"])
    card["damage"] = card.get("damage", 0) + actual
    card["power"] -= actual
    events.append({"type": "DAMAGE", "source_id": source_id, "target_id": card["id"], "amount": actual})
    if card["power"] <= 0:
        _remove_unit(state, card)["graveyard"].append(card)
        events.append({"type": "DESTROY", "target_id": card["id"]})


def _deploy_target(state, side_key, card, target_id):
    effect = card["effect"]
    if effect not in {"DAMAGE", "HEAL", "BOOST"}:
        return None
    actor = _side(state, _enemy_key(side_key) if effect == "DAMAGE" else side_key)
    if target_id is not None:
        return _target(actor, target_id)
    candidates = [value for value in _board_units(actor) if not value["protected"] and value["id"] != card["id"]]
    if effect == "HEAL":
        candidates = [value for value in candidates if value.get("damage", 0) > 0]
        return max(candidates, key=lambda value: (value.get("damage", 0), value["id"]), default=None)
    return max(candidates, key=lambda value: (value["power"], value["id"]), default=None)


def _deploy(state, side_key, card, row, target_id, events):
    actor, effect = _side(state, side_key), card["effect"]
    target = _deploy_target(state, side_key, card, target_id)
    if target is not None:
        amount = card["effect_amount"]
        if effect == "DAMAGE":
            _damage(state, target, amount, events, card["id"])
        elif effect == "HEAL":
            actual = min(amount, target.get("damage", 0))
            target["damage"] -= actual
            events.append({"type": "HEAL", "source_id": card["id"], "target_id": target["id"], "amount": actual})
        else:
            target["boost"] = target.get("boost", 0) + amount
            events.append({"type": "BOOST", "source_id": card["id"], "target_id": target["id"], "amount": amount})
    if effect == "MUSTER":
        summoned = []
        for zone in (actor["hand"], actor["deck"]):
            for other in list(zone):
                if len(actor["rows"][row]) >= state["rules"]["row_capacity"]:
                    break
                if other["kind"] == "UNIT" and other["hero_key"] == card["hero_key"] and row in other["rows"]:
                    zone.remove(other)
                    actor["rows"][row].append(other)
                    summoned.append(other["id"])
        if summoned:
            events.append({"type": "MUSTER", "source_id": card["id"], "card_ids": summoned, "row": row})


def _play(state, side_key, action, events):
    actor = _side(state, side_key)
    card = _hand_card(actor, action["card_id"])
    actor["hand"].remove(card)
    effect = card["effect"]
    events.append({"type": "PLAY", "side": side_key, "card_id": card["id"],
                   **{field: action[field] for field in ("row", "target_id") if action.get(field) is not None}})
    if card["kind"] == "UNIT":
        receiver = _side(state, _enemy_key(side_key)) if effect == "SPY" else actor
        receiver["rows"][action["row"]].append(card)
        if effect == "SPY":
            count = min(card["effect_amount"], len(actor["deck"]))
            actor["hand"].extend(actor["deck"][:count])
            del actor["deck"][:count]
            events.append({"type": "DRAW", "side": side_key, "count": count})
        else:
            _deploy(state, side_key, card, action["row"], action.get("target_id"), events)
        return
    actor["graveyard"].append(card)
    if effect == "WEATHER":
        state["weather"] = sorted(set(state["weather"]) | {action["row"]})
        events.append({"type": "WEATHER", "row": action["row"]})
    elif effect == "CLEAR_WEATHER":
        state["weather"] = []
        events.append({"type": "CLEAR_WEATHER"})
    elif effect == "HORN":
        actor["horns"].append(action["row"])
        events.append({"type": "HORN", "side": side_key, "row": action["row"]})
    elif effect == "DECOY":
        target = _target(actor, action["target_id"])
        _remove_unit(state, target)
        target.update(power=target["base_power"], boost=0, damage=0)
        actor["hand"].append(target)
        events.append({"type": "DECOY", "target_id": target["id"]})
    elif effect == "SCORCH":
        candidates = [value for participant in state["sides"] for value in _board_units(participant) if not value["protected"]]
        strongest = max((value["power"] for value in candidates), default=0)
        targets = [value for value in candidates if value["power"] == strongest and strongest > 0]
        for target in targets:
            _remove_unit(state, target)["graveyard"].append(target)
        events.append({"type": "SCORCH", "target_ids": [value["id"] for value in targets]})


def _leader(state, side_key, action, events):
    actor = _side(state, side_key)
    actor["leader_used"] = True
    ability = actor["base"]["ability"]
    events.append({"type": "LEADER", "side": side_key, "source_id": actor["base"]["id"]})
    if actor["base"]["key"] == "HIDDEN_KING":
        target = _target(_side(state, _enemy_key(side_key)), action["target_id"])
        _damage(state, target, ability["effect_amount"], events, actor["base"]["id"])
    else:
        state["weather"] = []
        events.append({"type": "CLEAR_WEATHER"})
        for card in actor["rows"][action["row"]]:
            if not card["protected"]:
                card["boost"] = card.get("boost", 0) + ability["effect_amount"]
                events.append({"type": "BOOST", "source_id": actor["base"]["id"], "target_id": card["id"], "amount": ability["effect_amount"]})


def _finish_round(state, events):
    first, second = _side(state, "A"), _side(state, "B")
    winner = "A" if first["score"] > second["score"] else "B" if second["score"] > first["score"] else None
    entry = {"round": state["round"], "score_a": first["score"], "score_b": second["score"], "winner_side": winner}
    state["history"].append(entry)
    events.append({"type": "ROUND_END", **entry})
    for actor in state["sides"]:
        if winner is None or actor["side"] == winner:
            actor["wins"] += 1
    if max(first["wins"], second["wins"]) >= 2 or state["round"] >= 3:
        state["status"] = "FINISHED"
        state["result"] = {"winner_side": "A" if first["wins"] > second["wins"] else "B" if second["wins"] > first["wins"] else None,
                           "reason": "ROUND_WINS"}
        events.append({"type": "MATCH_END", **state["result"]})
        return
    state["round"] += 1
    state["round_starter"] = winner or state.get("round_starter", "A")
    state["turn_side"] = state["round_starter"]
    state["weather"] = []
    for actor in state["sides"]:
        actor["graveyard"].extend(card for row in actor["rows"] for card in row)
        actor["rows"], actor["horns"] = [[], [], []], []
        actor["passed"] = False
        actor["score"], actor["row_scores"] = 0, [0, 0, 0]
    events.append({"type": "ROUND_START", "round": state["round"], "turn_side": state["turn_side"]})


def apply_action(state, side_key, action):
    """Return a new state and public events; neither valid nor invalid commands mutate input."""
    validate_action(state, side_key, action)
    current, events = deepcopy(state), []
    actor, kind = _side(current, side_key), action["type"]
    current["turn"] += 1
    if kind == "READY":
        actor["mulligan_done"] = True
        actor["mulligans_remaining"] = 0
        actor["deck"].extend(actor["_mulligan_stash"])
        actor["_mulligan_stash"] = []
        events.append({"type": "READY", "side": side_key})
        if all(value["mulligan_done"] for value in current["sides"]):
            current["phase"], current["turn_side"] = "PLAY", current.get("round_starter", "A")
            events.append({"type": "ROUND_START", "round": 1, "turn_side": current["turn_side"]})
        else:
            current["turn_side"] = next(value["side"] for value in current["sides"] if not value["mulligan_done"])
        return current, events
    if kind == "MULLIGAN":
        card = _hand_card(actor, action["card_id"])
        index = actor["hand"].index(card)
        actor["_mulligan_stash"].append(card)
        actor["hand"][index] = actor["deck"].pop(0)
        actor["mulligans_remaining"] -= 1
        events.append({"type": "MULLIGAN", "side": side_key})
        return current, events
    if kind == "PLAY":
        _score(current)
        _play(current, side_key, action, events)
    elif kind == "LEADER":
        _score(current)
        _leader(current, side_key, action, events)
    elif kind == "PASS":
        actor["passed"] = True
        events.append({"type": "PASS", "side": side_key})
    _score(current)
    if all(value["passed"] for value in current["sides"]):
        _finish_round(current, events)
    else:
        other = _side(current, _enemy_key(side_key))
        current["turn_side"] = side_key if other["passed"] else other["side"]
    return current, events


def public_state(state, viewer_side):
    """Detach public state while hiding deck order and the opponent's private cards."""
    _side(state, viewer_side)
    public = deepcopy(state)
    for actor in public["sides"]:
        actor["hand_count"] = len(actor["hand"])
        actor["deck_count"] = len(actor["deck"]) + len(actor.get("_mulligan_stash", []))
        actor["graveyard_count"] = len(actor["graveyard"])
        actor["deck"] = []
        actor.pop("_mulligan_stash", None)
        if actor["side"] != viewer_side:
            actor["hand"] = []
    for field in ("seed", "shuffle_seed", "bot_plan"):
        public.pop(field, None)
    return public


def _bot_candidates(state, side_key):
    actor = _side(state, side_key)
    for card in actor["hand"]:
        action = {"type": "PLAY", "card_id": card["id"]}
        if card["kind"] == "UNIT" or card["effect"] in {"WEATHER", "HORN"}:
            for row in card["rows"]:
                yield {**action, "row": row}
        elif card["effect"] == "DECOY":
            for target in _board_units(actor):
                if not target["protected"]:
                    yield {**action, "target_id": target["id"]}
        else:
            yield action
    if not actor["leader_used"] and actor["base"]["key"] != "ORDINARY":
        if actor["base"]["key"] == "HIDDEN_KING":
            for target in _board_units(_side(state, _enemy_key(side_key))):
                if not target["protected"]:
                    yield {"type": "LEADER", "target_id": target["id"]}
        else:
            for row in ROWS:
                if actor["rows"][row]:
                    yield {"type": "LEADER", "row": row}


def bot_action(state, side_key="B", difficulty="NORMAL"):
    """Choose one deterministic legal move, conserving cards after a round is secured.

    Decisions use visible board strength and hand counts, never enemy card identities.
    Every playable action consumes a finite card or a once-per-match leader ability.
    """
    actor = _side(state, side_key)
    if state.get("status") != "ACTIVE":
        raise ValueError("Match is finished")
    if state["phase"] == "MULLIGAN":
        action = {"type": "READY"}
        validate_action(state, side_key, action)
        return action
    validate_action(state, side_key, {"type": "PASS"})
    assessment = deepcopy(state)
    _score(assessment)
    actor = _side(assessment, side_key)
    enemy = _side(assessment, _enemy_key(side_key))
    if enemy["passed"] and (actor["score"] > enemy["score"] or
                            (actor["score"] == enemy["score"] and actor["wins"] > enemy["wins"])):
        return {"type": "PASS"}
    concede_gap = 12 if difficulty == "TUTORIAL" else 18 if difficulty == "NORMAL" else 22
    can_concede = state["round"] < 3 and (enemy["wins"] == 0 or actor["wins"] > enemy["wins"])
    if not enemy["passed"] and can_concede and enemy["score"] - actor["score"] >= concede_gap and len(_board_units(enemy)) >= 3:
        return {"type": "PASS"}
    choices = []
    for action in _bot_candidates(assessment, side_key):
        try:
            after, events = apply_action(assessment, side_key, action)
        except ValueError:
            continue
        after_actor, after_enemy = _side(after, side_key), _side(after, _enemy_key(side_key))
        gain = after_actor["score"] - actor["score"] - after_enemy["score"] + enemy["score"]
        draws = sum(event.get("count", 0) for event in events if event["type"] == "DRAW")
        recalled = next((event["target_id"] for event in events if event["type"] == "DECOY"), None)
        recall_value = 0
        if recalled:
            card = next(value for value in after_actor["hand"] if value["id"] == recalled)
            recall_value = 8 if card["effect"] == "SPY" else card["base_power"] * 0.3
        cards_used = max(0, len(actor["hand"]) - len(after_actor["hand"]))
        utility = gain + draws * 5 + recall_value - cards_used * 0.2
        identity = (action["type"], action.get("card_id", ""), action.get("row", -1), action.get("target_id", ""))
        choices.append((utility, gain, cards_used, identity, action, after_actor["score"] - after_enemy["score"]))
    if not choices:
        return {"type": "PASS"}
    if enemy["passed"]:
        winning = [choice for choice in choices if choice[-1] > 0]
        if winning:
            # Spend the least cards and the least excess strength needed to win.
            return min(winning, key=lambda value: (value[2], value[-1], value[3]))[4]
    best = max(choices, key=lambda value: (value[0], value[1], -value[2], value[3]))
    if best[0] <= 0:
        return {"type": "PASS"}
    return best[4]
