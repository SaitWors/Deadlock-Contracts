"""Versioned, deterministic arena rules. No database, HTTP, clock or RNG."""
from copy import deepcopy
from fractions import Fraction

VERSION = "arena-v1"
RANKS = {key: {"coefficient_milli": coefficient, "cost": cost} for key, coefficient, cost in zip(
    ("F", "E", "D", "C", "B", "A", "S", "SS", "SSS"),
    (1000, 1015, 1030, 1045, 1060, 1075, 1090, 1105, 1120), (0, 1, 2, 3, 4, 5, 7, 9, 11))}


def _ability(name, ru, en, target):
    return {"name": {"ru": name, "en": name}, "description": {"ru": ru, "en": en},
            "cost": 2, "cooldown": 3, "target": target}


HEROES = {}
for _key, _name, _role, _hp, _attack, _armor, _target, _ru, _en in (
    ("abrams", "Abrams", "TANK", 650, 70, 15, "SELF", "Щит 100 себе", "Shield self for 100"),
    ("bebop", "Bebop", "FIGHTER", 560, 75, 10, "ENEMY", "110 физического урона врагу линии", "110 physical damage to a lane enemy"),
    ("dynamo", "Dynamo", "TANK", 610, 65, 12, "NONE", "Щит 70 союзникам линии", "Shield lane allies for 70"),
    ("haze", "Haze", "SHOOTER", 400, 100, 5, "FIRST", "110 физического урона первой цели", "110 physical damage to the first target"),
    ("ivy", "Ivy", "SUPPORT", 440, 65, 5, "OTHER_ALLY", "Лечение 100 другого союзника линии", "Heal another lane ally for 100"),
    ("kelvin", "Kelvin", "SUPPORT", 520, 60, 10, "ALLY", "Лечение 60 и щит 50 союзнику линии", "Heal 60 and shield 50 to a lane ally"),
    ("seven", "Seven", "MAGE", 420, 80, 5, "ALL_ENEMIES", "70 урона духом всем героям вражеской линии", "70 spirit damage to all enemy lane heroes"),
    ("infernus", "Infernus", "FIGHTER", 460, 85, 10, "FIRST", "70 духом первой цели; ожог 20 в конце двух следующих раундов", "70 spirit to the first target; burn 20 at the end of the next two rounds"),
    ("wraith", "Wraith", "ASSASSIN", 410, 110, 5, "ENEMY", "100 физического урона врагу линии", "100 physical damage to a lane enemy"),
    ("mcginnis", "McGinnis", "ENGINEER", 500, 70, 12, "SELF", "+40 обычной атаки на текущий и следующий раунд", "+40 normal attack this round and next"),
    ("lady-geist", "Lady Geist", "MAGE", 450, 90, 5, "ENEMY", "Плата 40 HP, 130 урона духом врагу; нужно HP >40", "Pay 40 HP, deal 130 spirit damage; requires HP >40"),
    ("venator", "Venator", "HUNTER", 470, 95, 8, "ENEMY", "100 физического урона, 130 если цель имеет ≤35% HP", "100 physical damage, 130 if target has ≤35% HP"),
):
    HEROES[_key] = {"key": _key, "name": _name, "role": _role, "hp": _hp, "attack": _attack,
                   "armor": _armor, "ability": _ability(_name, _ru, _en, _target)}

# Numeric effects are part of the approved definition and frozen match snapshot.
for _key, _effects in {
    "abrams": {"shield": 100}, "bebop": {"damage": 110}, "dynamo": {"shield": 70},
    "haze": {"damage": 110}, "ivy": {"heal": 100}, "kelvin": {"heal": 60, "shield": 50},
    "seven": {"damage": 70}, "infernus": {"damage": 70, "burn_damage": 20, "burn_rounds": 2},
    "wraith": {"damage": 100}, "mcginnis": {"attack_bonus": 40, "duration": 2},
    "lady-geist": {"damage": 130, "hp_cost": 40}, "venator": {"damage": 100, "execute_damage": 130, "threshold_percent": 35},
}.items():
    HEROES[_key]["ability"].update(_effects)

BASES = {
    "ORDINARY": {"key": "ORDINARY", "name": {"ru": "Обычная база", "en": "Ordinary base"}, "cost": 0,
                 "ability": {"cost": 0, "target": "NONE", "name": {"ru": "Без умения", "en": "No ability"}}},
    "HIDDEN_KING": {"key": "HIDDEN_KING", "name": {"ru": "Тайный король: Двор теней", "en": "Hidden King: Court of Shadows"}, "cost": 2,
                    "ability": {"cost": 3, "cooldown": 3, "target": "ALLY", "name": {"ru": "Сделка в тени", "en": "Shadow bargain"},
                                "description": {"ru": "Плата 60 HP союзника (HP >60), 140 урона стражу его линии или базе", "en": "Pay 60 ally HP (HP >60), deal 140 to its lane guardian or base"}}},
    "ARCHMOTHER": {"key": "ARCHMOTHER", "name": {"ru": "Архиматерь: Стеклянный собор", "en": "Archmother: Glass Cathedral"}, "cost": 2,
                   "ability": {"cost": 3, "cooldown": 3, "target": "LINE", "name": {"ru": "Материнский покров", "en": "Mother's protection"},
                               "description": {"ru": "Щит 100 союзникам линии на текущий и следующий раунд", "en": "Shield lane allies for 100 this round and next"}}},
}
BASES["ORDINARY"]["passive"] = {"ru": "Без пассивного эффекта", "en": "No passive effect"}
BASES["HIDDEN_KING"].update(passive={"ru": "Первая обычная атака по постройке: +10%, если герой имеет ≤40% HP", "en": "First normal attack on a structure: +10% if the attacker has ≤40% HP"}, passive_bonus_percent=10, passive_hp_percent=40)
BASES["HIDDEN_KING"]["ability"].update(hp_cost=60, damage=140)
BASES["ARCHMOTHER"].update(passive={"ru": "Первый щит от умения героя: +15%; при двух целях — переднему живому союзнику", "en": "First hero-ability shield: +15%; front living ally when shielding two"}, passive_bonus_percent=15)
BASES["ARCHMOTHER"]["ability"].update(shield=100, duration=2)
RULES = {"version": VERSION, "ranks": RANKS, "budget": 24, "max_rounds": 12, "heroes": HEROES, "bases": BASES,
         "shield_default_rounds": 1, "base_hp": 1000, "guardian_hp": 240, "guardian_attack": 60}


def stats(hero_key, rank, rules=None):
    rules = rules or RULES
    definition, rarity = rules["heroes"][hero_key], rules["ranks"][rank]
    return {"max_hp": (definition["hp"] * rarity["coefficient_milli"] + 500) // 1000,
            "attack": (definition["attack"] * rarity["coefficient_milli"] + 500) // 1000,
            "armor": definition["armor"], "cost": rarity["cost"]}


def validate_squad(heroes, base_key="ORDINARY", rules=None):
    rules = rules or RULES
    if len(heroes) != 6 or len({hero["hero_key"] for hero in heroes}) != 6:
        raise ValueError("Choose six different heroes")
    if len({(hero["line"], hero["position"]) for hero in heroes}) != 6 or any(
        type(hero["line"]) is not int or hero["line"] not in (0, 1, 2) or hero["position"] not in ("FRONT", "BACK") for hero in heroes):
        raise ValueError("Choose six distinct legal slots")
    if base_key not in rules["bases"] or any(hero["hero_key"] not in rules["heroes"] or hero["rank"] not in rules["ranks"] for hero in heroes):
        raise ValueError("Unknown battle definition")
    cost = rules["bases"][base_key]["cost"] + sum(rules["ranks"][hero["rank"]]["cost"] for hero in heroes)
    if cost > rules["budget"] or sum(hero["rank"] == "SSS" for hero in heroes) > 2:
        raise ValueError(f"Squad budget exceeded: {cost}/24")
    return cost


def initial_state(heroes_a, heroes_b, *, base_a="ORDINARY", base_b="ORDINARY", rules=None, definitions_a=None, definitions_b=None):
    rules = deepcopy(rules or RULES)
    sides = []
    for key, heroes, base, definitions in (("A", heroes_a, base_a, definitions_a or {}), ("B", heroes_b, base_b, definitions_b or {})):
        validate_squad(heroes, base, rules)
        units = []
        for raw in heroes:
            definition = {**rules["heroes"][raw["hero_key"]], **definitions.get(raw["hero_key"], {})}
            own_rules = {**rules, "heroes": {**rules["heroes"], raw["hero_key"]: definition}}
            value = {**deepcopy(raw), **stats(raw["hero_key"], raw["rank"], own_rules)}
            value.update(name=definition["name"], hp=value["max_hp"], shield=0,
                         shield_expires_round=0, ready_round=1, deaths=0, respawn_round=None, burns=[],
                         buff_until=0, skip_attack_round=0, control_immune_round=0,
                         image_url=rules["heroes"][raw["hero_key"]].get("image_url"),
                         ability=deepcopy(definition["ability"]))
            units.append(value)
        base_rules = {**rules["bases"][base], **definitions.get(base, {})}
        sides.append({"side": key, "energy": 3, "heroes": units,
            "guardians": [{"id": f"{key}:guard:{line}", "line": line, "hp": rules["guardian_hp"], "max_hp": rules["guardian_hp"],
                           "attack": rules["guardian_attack"], "armor": 0, "burns": []} for line in range(3)],
            "base": {"id": f"{key}:base", "key": base, "hp": rules["base_hp"], "max_hp": rules["base_hp"], "armor": 0,
                     "image_url": rules["bases"][base].get("image_url"),
                     "ready_round": 1, "burns": [], "rules": deepcopy(base_rules), "ability": deepcopy(base_rules["ability"])}})
    return {"round": 1, "status": "ACTIVE", "result": None, "rules": rules, "sides": sides}


def _side(state, key):
    return next(value for value in state["sides"] if value["side"] == key)


def _heroes(side, line=None):
    return sorted((unit for unit in side["heroes"] if unit["hp"] > 0 and (line is None or unit["line"] == line)),
                  key=lambda unit: (unit["line"], unit["position"] != "FRONT"))


def _first(side, line):
    living = _heroes(side, line)
    return living[0] if living else (side["guardians"][line] if side["guardians"][line]["hp"] > 0 else side["base"])


def _find(side, identity):
    return next((unit for unit in side["heroes"] if unit["id"] == identity), None)


def _moves(state, side_key, actions):
    side = _side(state, side_key)
    for action in actions:
        if action.get("type") != "SWAP":
            continue
        first, second = _find(side, action.get("first_id")), _find(side, action.get("second_id"))
        if not first or not second or first is second or min(first["hp"], second["hp"]) <= 0:
            raise ValueError("Swaps require two living owned heroes")
        first["line"], second["line"] = second["line"], first["line"]
        first["position"], second["position"] = second["position"], first["position"]


def validate_plan(state, side_key, actions):
    if state["status"] != "ACTIVE" or not isinstance(actions, list) or len(actions) > 2:
        raise ValueError("The round accepts at most two actions")
    if any(not isinstance(value, dict) or value.get("type") not in {"SWAP", "HERO_ABILITY", "BASE_ABILITY"} for value in actions):
        raise ValueError("Unknown action")
    if sum(value["type"] != "SWAP" for value in actions) > 1:
        raise ValueError("At most one active ability per plan")
    energy = sum({"SWAP": 1, "HERO_ABILITY": 2, "BASE_ABILITY": 3}[value["type"]] for value in actions)
    if energy > 3:
        raise ValueError("Energy budget exceeded")
    current = deepcopy(state)
    _moves(current, side_key, actions)
    side, enemy, round_no = _side(current, side_key), _side(current, "B" if side_key == "A" else "A"), current["round"]
    for value in actions:
        if value["type"] == "HERO_ABILITY":
            actor = _find(side, value.get("actor_id"))
            if not actor or actor["hp"] <= 0 or actor["ready_round"] > round_no:
                raise ValueError("Hero ability is unavailable")
            target_type = actor["ability"]["target"]
            if target_type in {"ALLY", "OTHER_ALLY", "ENEMY"}:
                target = _find(enemy if target_type == "ENEMY" else side, value.get("target_id"))
                if not target or target["hp"] <= 0 or target["line"] != actor["line"] or (target_type == "OTHER_ALLY" and target is actor):
                    raise ValueError("Ability requires a living target on the actor's line")
            if actor["hero_key"] == "lady-geist" and actor["hp"] <= actor["ability"]["hp_cost"]:
                raise ValueError("Lady Geist requires HP above 40")
        elif value["type"] == "BASE_ABILITY":
            base = side["base"]
            if base["key"] == "ORDINARY" or base["ready_round"] > round_no:
                raise ValueError("Base ability is unavailable")
            if base["key"] == "HIDDEN_KING":
                target = _find(side, value.get("target_id"))
                if not target or target["hp"] <= base["ability"]["hp_cost"]:
                    raise ValueError("Hidden King requires a living ally with HP above 60")
            elif type(value.get("line")) is not int or value["line"] not in (0, 1, 2):
                raise ValueError("Choose a legal line")
    return energy


def _damage(target, amount, kind, events, source, phase):
    if kind == "PHYSICAL":
        amount = max(1, amount * (100 - min(25, target.get("armor", 0))) // 100)
    blocked = min(target.get("shield", 0), amount)
    if "shield" in target:
        target["shield"] -= blocked
    amount -= blocked
    events.append({"type": "DAMAGE", "phase": phase, "source_id": source, "target_id": target["id"],
                   "amount": amount, "blocked": blocked, "kind": kind})
    return amount


def _deaths(state, events, phase):
    for side in state["sides"]:
        for hero in side["heroes"]:
            if hero["hp"] <= 0 and hero.get("alive_before", True):
                hero["hp"], hero["shield"], hero["buff_until"], hero["burns"] = 0, 0, 0, []
                hero["deaths"] += 1
                hero["respawn_round"] = state["round"] + 3 if hero["deaths"] == 1 else None
                events.append({"type": "DEATH", "phase": phase, "target_id": hero["id"], "respawn_round": hero["respawn_round"]})
            hero["alive_before"] = hero["hp"] > 0


def _shield(unit, amount, until, events, source):
    if amount > unit["shield"]:
        unit["shield"], unit["shield_expires_round"] = amount, until
    events.append({"type": "SHIELD", "phase": "DEFENSE", "source_id": source, "target_id": unit["id"], "amount": amount})


def resolve_round(state, plan_a, plan_b):
    if state["rules"]["version"] != VERSION:
        raise ValueError("Unsupported arena rules version")
    validate_plan(state, "A", plan_a)
    validate_plan(state, "B", plan_b)
    current, events = deepcopy(state), []
    round_no = current["round"]
    for side_key, plan in (("A", plan_a), ("B", plan_b)):
        _moves(current, side_key, plan)
        for action in plan:
            if action["type"] == "SWAP":
                events.append({"type": "SWAP", "phase": "MOVE", "source_id": action["first_id"], "target_id": action["second_id"]})
    damage, healing = [], []
    phase_hp = {unit["id"]: unit["hp"] for side in current["sides"] for unit in side["heroes"]}
    for side_key, plan in (("A", plan_a), ("B", plan_b)):
        side, enemy = _side(current, side_key), _side(current, "B" if side_key == "A" else "A")
        for hero in side["heroes"]:
            hero["alive_before"] = hero["hp"] > 0
        for action in plan:
            if action["type"] == "SWAP":
                continue
            if action["type"] == "BASE_ABILITY":
                base = side["base"]
                ability = base["ability"]
                base["ready_round"] = round_no + ability["cooldown"]
                if base["key"] == "ARCHMOTHER":
                    for target in _heroes(side, action["line"]):
                        _shield(target, ability["shield"], round_no + ability["duration"] - 1, events, base["id"])
                else:
                    target = _find(side, action["target_id"])
                    target["hp"] -= ability["hp_cost"]
                    guardian = enemy["guardians"][target["line"]]
                    damage.append((guardian if guardian["hp"] > 0 else enemy["base"], ability["damage"], "SPIRIT", base["id"]))
                continue
            actor = _find(side, action["actor_id"])
            ability = actor["ability"]
            actor["ready_round"] = round_no + ability["cooldown"]
            key, line, identity = actor["hero_key"], actor["line"], actor["id"]
            target = _find(enemy, action.get("target_id")) if actor["ability"]["target"] == "ENEMY" else _find(side, action.get("target_id"))
            if ability["target"] == "ENEMY" and target["line"] != line:
                events.append({"type": "FIZZLE", "phase": "ACTIVE", "source_id": identity,
                               "target_id": target["id"], "reason": "TARGET_MOVED"})
                continue
            if key in {"abrams", "dynamo", "kelvin"}:
                targets = [actor] if key == "abrams" else (_heroes(side, line) if key == "dynamo" else [target])
                amount = ability["shield"]
                for index, ally in enumerate(targets):
                    bonus = side["base"]["rules"].get("passive_bonus_percent", 0)
                    shield = (amount * (100 + bonus) + 50) // 100 if index == 0 and side["base"]["key"] == "ARCHMOTHER" else amount
                    _shield(ally, shield, round_no, events, identity)
                if key == "kelvin":
                    healing.append((target, ability["heal"], identity))
            elif key == "ivy":
                healing.append((target, ability["heal"], identity))
            elif key == "mcginnis":
                actor["buff_until"] = round_no + ability["duration"] - 1
            elif key in {"haze", "infernus"}:
                target = _first(enemy, line)
                damage.append((target, ability["damage"], "PHYSICAL" if key == "haze" else "SPIRIT", identity))
                if key == "infernus":
                    target.setdefault("burns", []).append({"amount": ability["burn_damage"], "start": round_no + 1, "end": round_no + ability["burn_rounds"], "source_id": identity})
            elif key == "seven":
                damage.extend((target, ability["damage"], "SPIRIT", identity) for target in _heroes(enemy, line))
            else:
                amount = ability["damage"]
                if key == "venator" and phase_hp[target["id"]] * 100 <= target["max_hp"] * ability["threshold_percent"]:
                    amount = ability["execute_damage"]
                if key == "lady-geist":
                    actor["hp"] -= ability["hp_cost"]
                damage.append((target, amount, "SPIRIT" if key == "lady-geist" else "PHYSICAL", identity))
    changes = {}
    for target, amount, kind, source in damage:
        changes[target["id"]] = changes.get(target["id"], 0) - _damage(target, amount, kind, events, source, "ACTIVE")
    for target, amount, source in healing:
        changes[target["id"]] = changes.get(target["id"], 0) + amount
        events.append({"type": "HEAL", "phase": "ACTIVE", "source_id": source, "target_id": target["id"], "amount": amount})
    all_units = [unit for side in current["sides"] for unit in [*side["heroes"], *side["guardians"], side["base"]]]
    for target in all_units:
        target["hp"] = max(0, min(target["max_hp"], target["hp"] + changes.get(target["id"], 0)))
    _deaths(current, events, "ACTIVE")
    damage = []
    for side in current["sides"]:
        enemy = _side(current, "B" if side["side"] == "A" else "A")
        king_used = False
        for actor in _heroes(side):
            if actor.get("skip_attack_round") == round_no and actor.get("control_immune_round") != round_no:
                actor["control_immune_round"] = round_no + 1
                continue
            target = _first(enemy, actor["line"])
            amount = actor["attack"] + (actor["ability"].get("attack_bonus", 0) if actor["buff_until"] >= round_no else 0)
            base_rules = side["base"]["rules"]
            if side["base"]["key"] == "HIDDEN_KING" and not king_used and target not in enemy["heroes"] and actor["hp"] * 100 <= actor["max_hp"] * base_rules["passive_hp_percent"]:
                amount, king_used = (amount * (100 + base_rules["passive_bonus_percent"]) + 50) // 100, True
            damage.append((target, amount, "PHYSICAL", actor["id"]))
        for guardian in enemy["guardians"]:
            attackers = [unit for unit in _heroes(side, guardian["line"]) if unit.get("skip_attack_round") != round_no or unit.get("control_immune_round") == round_no]
            if guardian["hp"] > 0 and attackers:
                damage.append((attackers[0], guardian["attack"], "PHYSICAL", guardian["id"]))
    changes = {}
    for target, amount, kind, source in damage:
        changes[target["id"]] = changes.get(target["id"], 0) + _damage(target, amount, kind, events, source, "NORMAL")
    for target in all_units:
        target["hp"] = max(0, target["hp"] - changes.get(target["id"], 0))
    _deaths(current, events, "NORMAL")
    for target in all_units:
        for burn in target.get("burns", []):
            if burn["start"] <= round_no <= burn["end"] and target["hp"] > 0:
                target["hp"] = max(0, target["hp"] - _damage(target, burn["amount"], "SPIRIT", events, burn["source_id"], "END"))
        target["burns"] = [burn for burn in target.get("burns", []) if burn["end"] > round_no]
        if "shield" in target and target["shield_expires_round"] <= round_no:
            target["shield"] = 0
    _deaths(current, events, "END")
    a, b = current["sides"]
    dead_bases = (a["base"]["hp"] == 0, b["base"]["hp"] == 0)
    exhausted = all(not any(hero["hp"] > 0 or hero["respawn_round"] is not None for hero in side["heroes"]) for side in current["sides"])
    if any(dead_bases) or round_no >= current["rules"]["max_rounds"] or exhausted:
        if any(dead_bases):
            winner = None if all(dead_bases) else ("B" if dead_bases[0] else "A")
            reason = "BASE_DESTROYED"
        else:
            def score(side):
                return (side["base"]["hp"], sum(unit["hp"] > 0 for unit in side["guardians"]),
                        sum((Fraction(unit["hp"], unit["max_hp"]) for unit in side["heroes"] if unit["hp"] > 0), Fraction()))
            first, second = score(a), score(b)
            winner = None if first == second else ("A" if first > second else "B")
            reason = "ROUND_LIMIT" if round_no >= current["rules"]["max_rounds"] else "NO_HEROES"
        current["status"], current["result"] = "FINISHED", {"winner_side": winner, "reason": reason}
    else:
        current["round"] += 1
        for side in current["sides"]:
            for hero in side["heroes"]:
                if hero["respawn_round"] == current["round"]:
                    hero.update(hp=hero["max_hp"], respawn_round=None, burns=[], skip_attack_round=0, control_immune_round=0, alive_before=True)
                    events.append({"type": "RESPAWN", "phase": "START", "target_id": hero["id"], "amount": hero["max_hp"]})
    return current, events


def _ability_candidates(state, side_key):
    """Choose from the round-start snapshot, before receiving the human plan."""
    side, enemy = _side(state, side_key), _side(state, "B" if side_key == "A" else "A")
    candidates = [[]]
    if side["base"]["key"] == "ARCHMOTHER":
        candidates.extend([{"type": "BASE_ABILITY", "line": line}] for line in range(3))
    if side["base"]["key"] == "HIDDEN_KING":
        candidates.extend([{"type": "BASE_ABILITY", "target_id": hero["id"]}] for hero in _heroes(side))
    for hero in _heroes(side):
        target_type = hero["ability"]["target"]
        targets = _heroes(enemy if target_type == "ENEMY" else side, hero["line"]) if target_type in {"ENEMY", "ALLY", "OTHER_ALLY"} else [None]
        for target in targets:
            action = {"type": "HERO_ABILITY", "actor_id": hero["id"]}
            if target:
                action["target_id"] = target["id"]
            candidates.append([action])
    return candidates


def bot_plan(state, side_key="B", difficulty="NORMAL"):
    if difficulty == "TUTORIAL":
        return []
    candidates = _ability_candidates(state, side_key)
    if difficulty == "HARD":
        heroes = _heroes(_side(state, side_key))
        for index, first in enumerate(heroes):
            for second in heroes[index + 1:]:
                swap = {"type": "SWAP", "first_id": first["id"], "second_id": second["id"]}
                moved = deepcopy(state)
                _moves(moved, side_key, [swap])
                candidates.extend([[swap, *ability] for ability in _ability_candidates(moved, side_key)
                                   if not ability or ability[0]["type"] == "HERO_ABILITY"])
    legal = []
    for plan in candidates:
        try:
            validate_plan(state, side_key, plan)
            legal.append(plan)
        except ValueError:
            continue
    other_key = "B" if side_key == "A" else "A"
    # Hard anticipates the normal policy using only public round-start data.
    prediction = bot_plan(state, other_key, "NORMAL") if difficulty == "HARD" else []
    def value(plan):
        resolved, _ = resolve_round(state, plan if side_key == "A" else prediction, plan if side_key == "B" else prediction)
        own, other = _side(resolved, side_key), _side(resolved, "B" if side_key == "A" else "A")
        terminal = (100000 if resolved["result"] and resolved["result"]["winner_side"] == side_key else
                    (-100000 if resolved["result"] and resolved["result"]["winner_side"] == other_key else 0))
        survival = sum(unit["deaths"] for unit in other["heroes"]) - sum(unit["deaths"] for unit in own["heroes"])
        return terminal + survival * 250 + (own["base"]["hp"] - other["base"]["hp"]) * 3 + sum(unit["hp"] for unit in own["heroes"] + own["guardians"]) - sum(unit["hp"] for unit in other["heroes"] + other["guardians"])
    return max(legal, key=value) if legal else []
