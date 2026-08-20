from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, replace
from typing import Any, Iterable

GENERATOR_VERSION = "contracts-3.0.0-alpha.1"

DIFFICULTIES = ("LIGHT", "FOCUSED", "HARD", "EXTREME")
DIFFICULTY_INDEX = {name: index for index, name in enumerate(DIFFICULTIES)}
RARITY_WEIGHT = {"COMMON": 100.0, "UNCOMMON": 34.0, "RARE": 9.0, "EPIC": 1.4}
RARITY_CHANCE = {"COMMON": 62.0, "UNCOMMON": 34.0, "RARE": 14.0, "EPIC": 4.0}
DIFFICULTY_BASE_XP = {"LIGHT": 70, "FOCUSED": 105, "HARD": 155, "EXTREME": 230}
RARITY_MULTIPLIER = {"COMMON": 1.0, "UNCOMMON": 1.15, "RARE": 1.35, "EPIC": 1.7}
MODE_MULTIPLIER = {"STANDARD": 1.0, "RANKED": 1.20, "STREET_BRAWL": 0.78}
COMPOSITE_MULTIPLIER = {1: 1.0, 2: 1.34, 3: 1.72}

# Targets are deliberately bounded to values already close to the hand-authored v2 catalogue.
# v2 remains the safety/reference catalogue; v2.0 generates variations around these bands.
TARGET_RULES: dict[str, dict[str, tuple[tuple[float, float, float], ...]]] = {
    "STANDARD": {
        "player.kills": ((5, 7, 1), (8, 10, 1), (11, 13, 1), (14, 17, 1)),
        "player.assists": ((8, 11, 1), (12, 15, 1), (16, 20, 1), (21, 26, 1)),
        "player.deaths": ((7, 8, 1), (5, 6, 1), (4, 5, 1), (2, 3, 1)),
        "player.kda": ((1.8, 2.4, .2), (2.5, 3.0, .1), (3.1, 3.9, .1), (4.0, 5.2, .2)),
        "player.net_worth.final": ((24000, 29000, 1000), (30000, 35000, 1000), (36000, 42000, 1000), (43000, 52000, 1000)),
        "player.hero_damage": ((20000, 27000, 1000), (28000, 34000, 1000), (35000, 43000, 1000), (44000, 56000, 1000)),
        "player.healing": ((2500, 4500, 500), (5000, 7000, 500), (7500, 10000, 500), (10500, 14000, 500)),
        "match.duration_s": ((1320, 1680, 120), (1800, 2040, 120), (2160, 2400, 120), (2520, 2880, 120)),
        "match.win": ((1, 1, 1),) * 4,
    },
    "RANKED": {
        "player.kills": ((6, 7, 1), (8, 10, 1), (11, 13, 1), (14, 17, 1)),
        "player.assists": ((10, 13, 1), (14, 17, 1), (18, 22, 1), (23, 28, 1)),
        "player.deaths": ((7, 8, 1), (5, 6, 1), (4, 5, 1), (2, 3, 1)),
        "player.kda": ((2.0, 2.6, .2), (2.7, 3.2, .1), (3.3, 4.1, .1), (4.2, 5.4, .2)),
        "player.net_worth.final": ((26000, 31000, 1000), (32000, 37000, 1000), (38000, 45000, 1000), (46000, 56000, 1000)),
        "player.hero_damage": ((23000, 30000, 1000), (31000, 37000, 1000), (38000, 47000, 1000), (48000, 60000, 1000)),
        "player.healing": ((3000, 5000, 500), (5500, 7500, 500), (8000, 10500, 500), (11000, 15000, 500)),
        "match.win": ((1, 1, 1),) * 4,
    },
    "STREET_BRAWL": {
        "player.kills": ((4, 5, 1), (6, 8, 1), (9, 10, 1), (11, 13, 1)),
        "player.assists": ((6, 8, 1), (9, 11, 1), (12, 14, 1), (15, 18, 1)),
        "player.deaths": ((6, 7, 1), (5, 6, 1), (3, 4, 1), (2, 3, 1)),
        "player.kda": ((1.7, 2.2, .1), (2.3, 2.8, .1), (2.9, 3.6, .1), (3.7, 4.6, .1)),
        "player.hero_damage": ((10000, 14000, 1000), (15000, 18000, 1000), (19000, 23000, 1000), (24000, 30000, 1000)),
        "player.scoreboard_healing": ((1500, 2500, 500), (3000, 4000, 500), (4500, 6000, 500), (6500, 8500, 500)),
        "match.win": ((1, 1, 1),) * 4,
    },
}

COMPATIBLE: dict[str, tuple[str, ...]] = {
    "player.kills": ("player.deaths", "player.assists", "player.kda", "player.hero_damage", "player.net_worth.final", "match.win"),
    "player.assists": ("player.deaths", "player.kda", "player.healing", "player.scoreboard_healing", "player.hero_damage", "match.win"),
    "player.deaths": ("player.kills", "player.assists", "player.kda", "player.healing", "player.scoreboard_healing", "match.win"),
    "player.kda": ("player.kills", "player.assists", "player.deaths", "match.win"),
    "player.net_worth.final": ("player.kills", "player.hero_damage", "match.win", "match.duration_s"),
    "player.hero_damage": ("player.kills", "player.assists", "player.net_worth.final", "match.win"),
    "player.healing": ("player.assists", "player.deaths", "match.win"),
    "player.scoreboard_healing": ("player.assists", "player.deaths", "match.win"),
    "match.duration_s": ("match.win", "player.net_worth.final", "player.kills", "player.assists"),
    "match.win": ("player.kills", "player.assists", "player.deaths", "player.kda", "player.net_worth.final", "player.hero_damage", "player.healing", "player.scoreboard_healing"),
}

TITLE_POOLS = {
    "COMBAT": ("Красная папка", "Контрольный выстрел", "Семь печатей", "Аргумент без возражений", "Последний довод", "Жёсткий протокол", "Оперативная отметка", "Дело особой важности"),
    "SUPPORT": ("Сеть контактов", "Коллективное решение", "Связной", "Протокол поддержки", "Согласованные показания", "Общий интерес", "Надёжный партнёр", "Полевой нотариус"),
    "SURVIVAL": ("Чистое досье", "Холодная голова", "Без права на ошибку", "Не оставлять следов", "Безупречное алиби", "Тихий свидетель", "Под контролем", "Без лишнего шума"),
    "ECONOMY": ("Капитал дела", "Рейтинговый капитал", "Фонд операции", "Материальный интерес", "Скрытый резерв", "Баланс доказательств", "Полный расчёт", "Цена вопроса"),
}

COMPOSITE_SUFFIX = (" / двойное условие", " / связанное дело", " / особый протокол", " / составное дело")

@dataclass(frozen=True)
class GeneratedCondition:
    metric: str
    operator: str
    target: float
    capabilities: tuple[str, ...]

    def payload(self) -> dict[str, Any]:
        return {"metric": self.metric, "operator": self.operator, "target": self.target, "capabilities": list(self.capabilities)}


@dataclass(frozen=True)
class GeneratedContract:
    mission_definition_id: str
    base_key: str
    title: str
    description: str
    metric: str
    operator: str
    target: float
    reward_xp: int
    difficulty: str
    rarity: str
    drop_chance_pct: float
    category: str
    required_capabilities: tuple[str, ...]
    game_match_mode: str
    conditions: tuple[GeneratedCondition, ...]
    fingerprint: str
    generator_meta: dict[str, Any]


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _capabilities(item: Any) -> tuple[str, ...]:
    return tuple(str(x) for x in (_value(item, "required_capabilities", []) or []))


def _round_target(value: float) -> float:
    return float(int(value)) if float(value).is_integer() else round(value, 2)


def _pick_target(rng: random.Random, mode: str, metric: str, difficulty: str) -> float:
    rule = TARGET_RULES[mode][metric][DIFFICULTY_INDEX[difficulty]]
    lo, hi, step = rule
    count = int(round((hi - lo) / step))
    value = lo + rng.randint(0, max(0, count)) * step
    return _round_target(min(hi, value))


def _snap_to_rule(value: float, rule: tuple[float, float, float]) -> float:
    lo, hi, step = rule
    bounded = min(hi, max(lo, float(value)))
    if step <= 0:
        return _round_target(bounded)
    snapped = lo + round((bounded - lo) / step) * step
    return _round_target(min(hi, max(lo, snapped)))


def _adaptive_kind_for_slot(
    slot: int,
    conditions: list[GeneratedCondition],
    weakest_metric: str | None,
) -> str:
    if slot == 4:
        return "WILDCARD"
    if weakest_metric and any(item.metric == weakest_metric for item in conditions):
        return "BREAK_THE_HABIT"
    if len(conditions) > 1:
        return "MASTERY"
    return "CONSISTENCY" if slot in {0, 3} else "CHALLENGE"


def _weakest_metric(profile: dict[str, Any] | None, mode: str) -> str | None:
    metrics = (profile or {}).get("metrics") if isinstance(profile, dict) else None
    if not isinstance(metrics, dict):
        return None
    candidates = (
        "player.kills", "player.assists", "player.deaths",
        "player.net_worth.final", "player.hero_damage", "player.object_damage",
        "player.healing", "player.scoreboard_healing",
    )
    scored: list[tuple[float, str]] = []
    for metric in candidates:
        row = metrics.get(metric)
        rules = TARGET_RULES.get(mode, {}).get(metric)
        if not isinstance(row, dict) or not rules or int(row.get("n") or 0) < 5:
            continue
        med = float(row.get("median") or 0.0)
        lo, hi, _ = rules[DIFFICULTY_INDEX["FOCUSED"]]
        midpoint = max(0.01, (lo + hi) / 2.0)
        if metric == "player.deaths":
            score = midpoint / max(1.0, med)
        else:
            score = med / midpoint
        scored.append((score, metric))
    return min(scored)[1] if scored else None


def _personalize_conditions(
    conditions: list[GeneratedCondition],
    *,
    mode: str,
    difficulty: str,
    kind: str,
    profile: dict[str, Any] | None,
) -> tuple[list[GeneratedCondition], list[dict[str, Any]]]:
    metrics = (profile or {}).get("metrics") if isinstance(profile, dict) else None
    if kind == "WILDCARD" or not isinstance(metrics, dict):
        return conditions, []
    basis: list[dict[str, Any]] = []
    updated: list[GeneratedCondition] = []
    for index, condition in enumerate(conditions):
        row = metrics.get(condition.metric)
        rules = TARGET_RULES.get(mode, {}).get(condition.metric)
        if (
            condition.metric == "match.win"
            or not isinstance(row, dict)
            or int(row.get("n") or 0) < 5
            or not rules
        ):
            updated.append(condition)
            continue

        if kind == "CONSISTENCY":
            key = "median"
        elif kind == "CHALLENGE":
            key = "p25" if condition.operator == "lte" else "p75"
        else:
            key = "p25" if condition.operator == "lte" else "p60"

        value = row.get(key)
        if value is None:
            updated.append(condition)
            continue
        cond_index = max(
            0,
            DIFFICULTY_INDEX[difficulty] - (1 if index > 0 else 0) - (1 if index > 1 else 0),
        )
        rule = rules[cond_index]
        target = _snap_to_rule(float(value), rule)
        updated_condition = replace(condition, target=target)
        updated.append(updated_condition)
        basis.append({
            "metric": condition.metric,
            "n": int(row.get("n") or 0),
            "median": row.get("median"),
            "p60": row.get("p60"),
            "p75": row.get("p75"),
            "target": target,
            "source": key,
        })
    return updated, basis


def _operator_for_metric(metric: str) -> str:
    if metric == "player.deaths":
        return "lte"
    if metric == "match.win":
        return "eq"
    return "gte"


def _difficulty_for_slot(rng: random.Random, slot: int, extreme_used: bool) -> str:
    if slot == 0:
        return "LIGHT"
    point = rng.random()
    if point < .16:
        return "LIGHT"
    if point < .62:
        return "FOCUSED"
    if point < .93 or extreme_used:
        return "HARD"
    return "EXTREME"


def _condition_count(rng: random.Random, difficulty: str) -> int:
    point = rng.random()
    if difficulty == "LIGHT":
        return 1
    if difficulty == "FOCUSED":
        return 2 if point < .22 else 1
    if difficulty == "HARD":
        return 2 if point < .66 else 1
    return 3 if point < .28 else 2


def _rarity(difficulty: str, condition_count: int, rng: random.Random) -> str:
    score = DIFFICULTY_INDEX[difficulty] + (condition_count - 1) * 1.55 + rng.random() * .35
    if score < 1.1:
        return "COMMON"
    if score < 2.2:
        return "UNCOMMON"
    if score < 3.65:
        return "RARE"
    return "EPIC"


def _category(metrics: list[str], atoms: dict[str, Any]) -> str:
    categories = [str(_value(atoms[m], "category", "COMBAT")) for m in metrics if m in atoms]
    if "ECONOMY" in categories:
        return "ECONOMY"
    if categories.count("SUPPORT") >= max(1, len(categories) // 2):
        return "SUPPORT"
    if "SURVIVAL" in categories and not any(m in {"player.kills", "player.hero_damage"} for m in metrics):
        return "SURVIVAL"
    return categories[0] if categories else "COMBAT"


def _format_number(value: float) -> str:
    if float(value).is_integer():
        return f"{int(value):,}".replace(",", " ")
    return f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def _condition_text(condition: GeneratedCondition) -> str:
    n = _format_number(condition.target)
    metric = condition.metric
    if metric == "match.win":
        return "победите"
    if metric == "match.duration_s":
        minutes = _format_number(condition.target / 60)
        return f"проведите в матче не менее {minutes} мин"
    if metric == "player.kills":
        return f"сделайте не менее {n} киллов"
    if metric == "player.deaths":
        return f"умрите не более {n} раз"
    if metric == "player.assists":
        return f"сделайте не менее {n} ассистов"
    if metric == "player.kda":
        return f"достигните KDA не ниже {n}"
    if metric == "player.net_worth.final":
        return f"завершите матч с ценностью не менее {n} душ"
    if metric == "player.hero_damage":
        return f"нанесите героям не менее {n} урона"
    if metric == "player.healing":
        return f"восстановите союзникам не менее {n} здоровья"
    if metric == "player.scoreboard_healing":
        return f"наберите не менее {n} лечения по итоговой таблице"
    return f"выполните {metric} {_operator_for_metric(metric)} {n}"


def _description(mode: str, conditions: list[GeneratedCondition]) -> str:
    prefix = {
        "STANDARD": "В следующем обычном матче",
        "RANKED": "В следующем рейтинговом матче",
        "STREET_BRAWL": "В следующей Уличной стычке",
    }[mode]
    pieces = [_condition_text(item) for item in conditions]
    if len(pieces) == 1:
        body = pieces[0]
    elif len(pieces) == 2:
        body = f"{pieces[0]} и {pieces[1]}"
    else:
        body = f"{pieces[0]}, {pieces[1]} и {pieces[2]}"
    return prefix + ": " + body + "."


def _reward(mode: str, difficulty: str, rarity: str, condition_count: int) -> int:
    raw = DIFFICULTY_BASE_XP[difficulty] * RARITY_MULTIPLIER[rarity] * MODE_MULTIPLIER[mode] * COMPOSITE_MULTIPLIER[condition_count]
    return min(650, int(round(raw / 5) * 5))


def _fingerprint(mode: str, conditions: Iterable[GeneratedCondition]) -> str:
    body = "|".join(sorted(f"{c.metric}:{c.operator}:{c.target:g}" for c in conditions))
    return hashlib.sha256(f"{GENERATOR_VERSION}|{mode}|{body}".encode()).hexdigest()[:32]


def _metric_signature(conditions: Iterable[GeneratedCondition]) -> str:
    return "+".join(sorted(c.metric for c in conditions))


def _atom_map(candidates: Iterable[Any], mode: str) -> dict[str, Any]:
    allowed = TARGET_RULES.get(mode, {})
    atoms: dict[str, Any] = {}
    # Stable choice of a carrier template per metric. Prefer the lowest difficulty version,
    # then the lexicographically smallest key. The carrier only supplies FK/category/capability;
    # generated target/text are snapshot fields on BoardOption.
    rows = sorted(candidates, key=lambda item: (DIFFICULTY_INDEX.get(str(_value(item, "difficulty", "FOCUSED")), 9), str(_value(item, "key", ""))))
    for item in rows:
        metric = str(_value(item, "metric", ""))
        if metric in allowed and metric not in atoms:
            atoms[metric] = item
    return atoms


def _choose_metrics(rng: random.Random, primary: str, count: int, available: set[str], recent_signatures: set[str]) -> list[str]:
    result = [primary]
    while len(result) < count:
        options = [m for m in COMPATIBLE.get(result[-1], ()) if m in available and m not in result]
        # Win is valuable as a secondary condition, but avoid turning most generated cards into win contracts.
        if len(result) == 1 and "match.win" in options and rng.random() < .72:
            options = [m for m in options if m != "match.win"] or options
        if not options:
            break
        rng.shuffle(options)
        best = options[0]
        # Prefer a metric signature not recently seen.
        for candidate in options:
            signature = "+".join(sorted(result + [candidate]))
            if signature not in recent_signatures:
                best = candidate
                break
        result.append(best)
    return result


def generate_contracts_v2(
    candidates: Iterable[Any],
    seed: str,
    *,
    board_size: int = 6,
    recent_fingerprints: Iterable[str] = (),
    recent_metric_signatures: Iterable[str] = (),
    adaptive_profile: dict[str, Any] | None = None,
) -> list[GeneratedContract]:
    rows = list(candidates)
    if not rows:
        raise RuntimeError("Нет опубликованных шаблонов для генератора Contracts 2.0")
    mode = str(_value(rows[0], "game_match_mode", "STANDARD"))
    atoms = _atom_map(rows, mode)
    if len(atoms) < board_size:
        raise RuntimeError(f"Для {mode} недостаточно разных безопасных метрик: {len(atoms)} / {board_size}")

    rng = random.Random(f"{GENERATOR_VERSION}:{seed}")
    recent_fp = set(recent_fingerprints)
    recent_sig = set(recent_metric_signatures)
    used_primary: set[str] = set()
    selected: list[GeneratedContract] = []
    extreme_used = False
    used_titles: set[str] = set()
    adaptive_sample = int((adaptive_profile or {}).get("sample_size") or 0)
    adaptive_enabled = adaptive_sample >= 5
    weakest_metric = _weakest_metric(adaptive_profile, mode) if adaptive_enabled else None

    # Primary metrics are selected without replacement, weighted softly by the admin-maintained
    # carrier weight. This preserves admin control while target/compound structure is generated.
    metrics = sorted(atoms)
    for slot in range(board_size):
        available_primary = [m for m in metrics if m not in used_primary]
        if not available_primary:
            break
        weights = [max(.01, float(_value(atoms[m], "drop_weight", 1.0) or 1.0)) for m in available_primary]
        primary = rng.choices(available_primary, weights=weights, k=1)[0]
        used_primary.add(primary)

        difficulty = _difficulty_for_slot(rng, slot, extreme_used)
        if difficulty == "EXTREME":
            extreme_used = True
        requested_count = _condition_count(rng, difficulty)
        condition_metrics = _choose_metrics(rng, primary, requested_count, set(atoms), recent_sig)
        condition_count = len(condition_metrics)
        rarity = _rarity(difficulty, condition_count, rng)

        conditions: list[GeneratedCondition] = []
        for index, metric in enumerate(condition_metrics):
            # Secondary conditions are intentionally one step softer so composite contracts remain
            # achievable in one match rather than becoming accidental impossible conjunctions.
            cond_index = max(0, DIFFICULTY_INDEX[difficulty] - (1 if index > 0 else 0) - (1 if index > 1 else 0))
            cond_difficulty = DIFFICULTIES[cond_index]
            target = _pick_target(rng, mode, metric, cond_difficulty)
            conditions.append(GeneratedCondition(metric, _operator_for_metric(metric), target, _capabilities(atoms[metric])))

        # Exact anti-repeat. First reroll targets; if a metric has a tiny target
        # space (notably match.win), expand the contract with a compatible
        # secondary condition rather than serving the same fingerprint again.
        for attempt in range(24):
            fp = _fingerprint(mode, conditions)
            if fp not in recent_fp and all(item.fingerprint != fp for item in selected):
                break

            if attempt >= 6 and len(conditions) < 3:
                used = {item.metric for item in conditions}
                candidates2 = [
                    metric
                    for anchor in list(used)
                    for metric in COMPATIBLE.get(anchor, ())
                    if metric in atoms and metric not in used
                ]
                if candidates2:
                    rng.shuffle(candidates2)
                    metric = candidates2[0]
                    idx = len(conditions)
                    cond_index = max(0, DIFFICULTY_INDEX[difficulty] - 1 - (1 if idx > 1 else 0))
                    conditions.append(
                        GeneratedCondition(
                            metric,
                            _operator_for_metric(metric),
                            _pick_target(rng, mode, metric, DIFFICULTIES[cond_index]),
                            _capabilities(atoms[metric]),
                        )
                    )
                    condition_metrics.append(metric)
                    continue

            idx = rng.randrange(len(conditions))
            metric = conditions[idx].metric
            cond_index = max(0, DIFFICULTY_INDEX[difficulty] - (1 if idx > 0 else 0) - (1 if idx > 1 else 0))
            conditions[idx] = GeneratedCondition(
                metric,
                _operator_for_metric(metric),
                _pick_target(rng, mode, metric, DIFFICULTIES[cond_index]),
                _capabilities(atoms[metric]),
            )
        adaptive_kind = (
            _adaptive_kind_for_slot(slot, conditions, weakest_metric)
            if adaptive_enabled
            else "COLD_START"
        )
        conditions, adaptive_basis = _personalize_conditions(
            conditions,
            mode=mode,
            difficulty=difficulty,
            kind=adaptive_kind,
            profile=adaptive_profile if adaptive_enabled else None,
        )
        fp = _fingerprint(mode, conditions)
        duplicate_on_board = any(item.fingerprint == fp for item in selected)
        if duplicate_on_board:
            raise RuntimeError("Contracts 2.0 не смог обеспечить уникальность внутри одной доски")
        anti_repeat_relaxed = fp in recent_fp
        condition_count = len(conditions)
        rarity = _rarity(difficulty, condition_count, rng)
        sig = _metric_signature(conditions)
        recent_sig.add(sig)

        category = _category(condition_metrics, atoms)
        pool = TITLE_POOLS.get(category, TITLE_POOLS["COMBAT"])
        available_titles = [name for name in pool if name not in used_titles]
        base_title = rng.choice(available_titles or list(pool))
        used_titles.add(base_title)
        title = base_title
        if condition_count > 1:
            title += rng.choice(COMPOSITE_SUFFIX)

        caps = tuple(sorted({cap for c in conditions for cap in c.capabilities}))
        carrier = atoms[primary]
        contract = GeneratedContract(
            mission_definition_id=str(_value(carrier, "id")),
            base_key=str(_value(carrier, "key")),
            title=title,
            description=_description(mode, conditions),
            metric=conditions[0].metric,
            operator=conditions[0].operator,
            target=conditions[0].target,
            reward_xp=_reward(mode, difficulty, rarity, condition_count),
            difficulty=difficulty,
            rarity=rarity,
            drop_chance_pct=RARITY_CHANCE[rarity],
            category=category,
            required_capabilities=caps,
            game_match_mode=mode,
            conditions=tuple(conditions),
            fingerprint=fp,
            generator_meta={
                "version": GENERATOR_VERSION,
                "seed": seed,
                "slot": slot,
                "dynamic": True,
                "base_template_key": str(_value(carrier, "key")),
                "condition_count": condition_count,
                "metric_signature": sig,
                "anti_repeat_relaxed": anti_repeat_relaxed,
                "adaptive": {
                    "enabled": adaptive_enabled and adaptive_kind != "WILDCARD",
                    "kind": adaptive_kind,
                    "sample_size": adaptive_sample,
                    "confidence": str((adaptive_profile or {}).get("confidence") or "COLD_START"),
                    "profile_version": (adaptive_profile or {}).get("version"),
                    "basis": adaptive_basis,
                    "weakest_metric": weakest_metric if adaptive_kind == "BREAK_THE_HABIT" else None,
                },
            },
        )
        selected.append(contract)
        recent_fp.add(fp)

    if len(selected) < board_size:
        raise RuntimeError(f"Contracts 2.0 смог создать только {len(selected)} из {board_size} контрактов")
    return selected


def preview_payload(item: GeneratedContract) -> dict[str, Any]:
    return {
        "id": item.fingerprint,
        "key": f"generated:{item.base_key}",
        "version": 3,
        "title": item.title,
        "description": item.description,
        "metric": item.metric,
        "operator": item.operator,
        "target": item.target,
        "reward_xp": item.reward_xp,
        "base_xp": DIFFICULTY_BASE_XP[item.difficulty],
        "difficulty": item.difficulty,
        "rarity": item.rarity,
        "drop_weight": RARITY_WEIGHT[item.rarity],
        "drop_chance_pct": item.drop_chance_pct,
        "category": item.category,
        "required_capabilities": list(item.required_capabilities),
        "game_match_mode": item.game_match_mode,
        "ranked_policy": "MODE_LOCKED",
        "status": "GENERATED_PREVIEW",
        "safety_classification": "WIN_ALIGNED",
        "conditions": [c.payload() for c in item.conditions],
        "fingerprint": item.fingerprint,
        "generator_meta": item.generator_meta,
        "created_at": None,
        "published_at": None,
    }
