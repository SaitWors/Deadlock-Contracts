from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import MissionDefinition
from .contract_pool import estimate_inclusion_chances

DIFFICULTY_BASE_XP = {"LIGHT": 70, "FOCUSED": 105, "HARD": 155, "EXTREME": 230}
RARITY_MULTIPLIER = {"COMMON": 1.0, "UNCOMMON": 1.15, "RARE": 1.35, "EPIC": 1.7}
RARITY_WEIGHT = {"COMMON": 100.0, "UNCOMMON": 32.0, "RARE": 8.0, "EPIC": 1.0}
MODE_MULTIPLIER = {"STANDARD": 1.0, "RANKED": 1.20, "STREET_BRAWL": 0.78}

METRIC_EN = {
    "player.kills": ("Elimination file", "kills"),
    "player.deaths": ("Clean getaway", "deaths"),
    "player.assists": ("Network of contacts", "assists"),
    "player.kda": ("Clean dossier", "KDA"),
    "player.net_worth.final": ("Case capital", "souls"),
    "player.hero_damage": ("Compelling evidence", "hero damage"),
    "player.healing": ("Field support", "healing"),
    "player.scoreboard_healing": ("Field medic", "scoreboard healing"),
    "match.duration_s": ("Long investigation", "seconds of match time"),
}
MODE_EN = {
    "STANDARD": "standard match",
    "RANKED": "ranked match",
    "STREET_BRAWL": "Street Brawl match",
}


def english_copy(metric: str, operator: str, target: float, mode: str) -> tuple[str, str]:
    match_name = MODE_EN[mode]
    if metric == "match.win":
        return "Close the case with a win", f"Win your next {match_name}."
    title, label = METRIC_EN.get(metric, ("Contract objective", metric))
    display_target = int(target) if float(target).is_integer() else target
    if metric == "match.duration_s":
        display_target = int(round(float(target) / 60))
        label = "minutes"
    if operator == "lte":
        description = f"Finish your next {match_name} with no more than {display_target} {label}."
    else:
        description = f"Reach at least {display_target} {label} in your next {match_name}."
    return title, description


def reward(mode: str, difficulty: str, rarity: str) -> int:
    value = DIFFICULTY_BASE_XP[difficulty] * RARITY_MULTIPLIER[rarity] * MODE_MULTIPLIER[mode]
    return int(round(value / 5) * 5)


def mission(
    key: str,
    mode: str,
    title: str,
    description: str,
    metric: str,
    operator: str,
    target: float,
    capability: list[str],
    difficulty: str,
    rarity: str,
    category: str,
    *,
    safety: str = "WIN_ALIGNED",
) -> dict:
    title_en, description_en = english_copy(metric, operator, target, mode)
    return {
        "key": f"{key}_{mode.lower()}",
        "title": title,
        "description": description,
        "title_en": title_en,
        "description_en": description_en,
        "metric": metric,
        "operator": operator,
        "target": target,
        "base_xp": DIFFICULTY_BASE_XP[difficulty],
        "reward_xp": reward(mode, difficulty, rarity),
        "difficulty": difficulty,
        "rarity": rarity,
        "drop_weight": RARITY_WEIGHT[rarity],
        "drop_chance_pct": 0.0,
        "category": category,
        "required_capabilities": capability,
        "game_match_mode": mode,
        "ranked_policy": "RANKED_SAFE" if mode == "RANKED" else ("STANDARD_ONLY" if mode == "STANDARD" else "MODE_SPECIFIC"),
        "safety_classification": safety,
    }


MISSIONS_V2 = [
    # STANDARD — broad, post-match-safe pool.
    mission("win", "STANDARD", "Закрыть дело победой", "Победите в следующем обычном матче.", "match.win", "eq", 1, ["summary.result"], "FOCUSED", "COMMON", "COMBAT"),
    mission("kills_6", "STANDARD", "Шесть отметок", "Сделайте не менее 6 киллов.", "player.kills", "gte", 6, ["summary.kills"], "LIGHT", "COMMON", "COMBAT"),
    mission("kills_10", "STANDARD", "Десять подписей", "Сделайте не менее 10 киллов.", "player.kills", "gte", 10, ["summary.kills"], "FOCUSED", "UNCOMMON", "COMBAT"),
    mission("kills_15", "STANDARD", "Красная папка", "Сделайте не менее 15 киллов.", "player.kills", "gte", 15, ["summary.kills"], "EXTREME", "EPIC", "COMBAT"),
    mission("assists_12", "STANDARD", "Соучастник", "Сделайте не менее 12 ассистов.", "player.assists", "gte", 12, ["summary.assists"], "FOCUSED", "COMMON", "SUPPORT"),
    mission("assists_20", "STANDARD", "Сеть контактов", "Сделайте не менее 20 ассистов.", "player.assists", "gte", 20, ["summary.assists"], "HARD", "RARE", "SUPPORT"),
    mission("deaths_5", "STANDARD", "Без лишних следов", "Завершите матч, умерев не более 5 раз.", "player.deaths", "lte", 5, ["summary.deaths"], "FOCUSED", "UNCOMMON", "SURVIVAL"),
    mission("kda_3", "STANDARD", "Чистое досье", "Достигните KDA не ниже 3.0.", "player.kda", "gte", 3, ["summary.kills", "summary.deaths", "summary.assists"], "HARD", "RARE", "SURVIVAL"),
    mission("net_30k", "STANDARD", "Капитал дела", "Завершите матч с ценностью не менее 30 000 душ.", "player.net_worth.final", "gte", 30000, ["summary.net_worth"], "FOCUSED", "COMMON", "ECONOMY"),
    mission("hero_damage_28k", "STANDARD", "Убедительные доказательства", "Нанесите героям не менее 28 000 урона.", "player.hero_damage", "gte", 28000, ["summary.hero_damage"], "FOCUSED", "UNCOMMON", "COMBAT"),
    mission("healing_6k", "STANDARD", "Полевой нотариус", "Восстановите союзникам не менее 6 000 здоровья.", "player.healing", "gte", 6000, ["summary.healing"], "FOCUSED", "UNCOMMON", "SUPPORT"),
    mission("duration_30", "STANDARD", "Долгое разбирательство", "Продержитесь в матче не менее 30 минут.", "match.duration_s", "gte", 1800, ["summary.duration"], "LIGHT", "COMMON", "SURVIVAL"),

    # RANKED — no intentionally grief-prone restrictions; thresholds are a little stricter.
    mission("ranked_win", "RANKED", "Вердикт рейтинга", "Победите в следующем рейтинговом матче.", "match.win", "eq", 1, ["summary.result"], "FOCUSED", "COMMON", "COMBAT"),
    mission("ranked_kills_7", "RANKED", "Семь печатей", "Сделайте не менее 7 киллов в рейтинговом матче.", "player.kills", "gte", 7, ["summary.kills"], "LIGHT", "COMMON", "COMBAT"),
    mission("ranked_kills_11", "RANKED", "Дело повышенной важности", "Сделайте не менее 11 киллов в рейтинговом матче.", "player.kills", "gte", 11, ["summary.kills"], "HARD", "RARE", "COMBAT"),
    mission("ranked_assists_14", "RANKED", "Коллективное решение", "Сделайте не менее 14 ассистов в рейтинговом матче.", "player.assists", "gte", 14, ["summary.assists"], "FOCUSED", "COMMON", "SUPPORT"),
    mission("ranked_assists_22", "RANKED", "Безупречная координация", "Сделайте не менее 22 ассистов в рейтинговом матче.", "player.assists", "gte", 22, ["summary.assists"], "HARD", "RARE", "SUPPORT"),
    mission("ranked_deaths_5", "RANKED", "Холодная голова", "Завершите рейтинговый матч, умерев не более 5 раз.", "player.deaths", "lte", 5, ["summary.deaths"], "FOCUSED", "UNCOMMON", "SURVIVAL"),
    mission("ranked_kda_3_2", "RANKED", "Без права на ошибку", "Достигните KDA не ниже 3,2 в рейтинговом матче.", "player.kda", "gte", 3.2, ["summary.kills", "summary.deaths", "summary.assists"], "HARD", "RARE", "SURVIVAL"),
    mission("ranked_net_32k", "RANKED", "Рейтинговый капитал", "Завершите рейтинговый матч с ценностью не менее 32 000 душ.", "player.net_worth.final", "gte", 32000, ["summary.net_worth"], "FOCUSED", "UNCOMMON", "ECONOMY"),
    mission("ranked_hero_damage_32k", "RANKED", "Аргумент без возражений", "Нанесите героям не менее 32 000 урона в рейтинговом матче.", "player.hero_damage", "gte", 32000, ["summary.hero_damage"], "HARD", "UNCOMMON", "COMBAT"),
    mission("ranked_heal_7k", "RANKED", "Протокол поддержки", "Восстановите союзникам не менее 7 000 здоровья в рейтинговом матче.", "player.healing", "gte", 7000, ["summary.healing"], "FOCUSED", "UNCOMMON", "SUPPORT"),
    mission("ranked_extreme_kda", "RANKED", "Безупречное алиби", "Завершите рейтинговый матч с KDA не ниже 5,0.", "player.kda", "gte", 5, ["summary.kills", "summary.deaths", "summary.assists"], "EXTREME", "EPIC", "SURVIVAL"),

    # STREET BRAWL — separate short-form pool; no duration/objective assumptions.
    mission("brawl_kills_5", "STREET_BRAWL", "Пять быстрых отметок", "Сделайте не менее 5 киллов в Уличной стычке.", "player.kills", "gte", 5, ["summary.kills"], "LIGHT", "COMMON", "COMBAT"),
    mission("brawl_kills_8", "STREET_BRAWL", "Восьмёрка на районе", "Сделайте не менее 8 киллов в Уличной стычке.", "player.kills", "gte", 8, ["summary.kills"], "FOCUSED", "UNCOMMON", "COMBAT"),
    mission("brawl_kills_12", "STREET_BRAWL", "Уличный приговор", "Сделайте не менее 12 киллов в Уличной стычке.", "player.kills", "gte", 12, ["summary.kills"], "EXTREME", "EPIC", "COMBAT"),
    mission("brawl_assists_8", "STREET_BRAWL", "Связной", "Сделайте не менее 8 ассистов в Уличной стычке.", "player.assists", "gte", 8, ["summary.assists"], "LIGHT", "COMMON", "SUPPORT"),
    mission("brawl_assists_14", "STREET_BRAWL", "Уличная сеть", "Сделайте не менее 14 ассистов в Уличной стычке.", "player.assists", "gte", 14, ["summary.assists"], "HARD", "RARE", "SUPPORT"),
    mission("brawl_deaths_4", "STREET_BRAWL", "Не оставлять следов", "Завершите Уличную стычку, умерев не более 4 раз.", "player.deaths", "lte", 4, ["summary.deaths"], "HARD", "RARE", "SURVIVAL"),
    mission("brawl_kda_2_5", "STREET_BRAWL", "Чистая улица", "Достигните KDA не ниже 2,5 в Уличной стычке.", "player.kda", "gte", 2.5, ["summary.kills", "summary.deaths", "summary.assists"], "FOCUSED", "UNCOMMON", "SURVIVAL"),
    mission("brawl_damage_14k", "STREET_BRAWL", "Громкое заявление", "Нанесите героям не менее 14 000 урона в Уличной стычке.", "player.hero_damage", "gte", 14000, ["summary.hero_damage"], "FOCUSED", "COMMON", "COMBAT"),
    mission("brawl_damage_22k", "STREET_BRAWL", "Улица запомнит", "Нанесите героям не менее 22 000 урона в Уличной стычке.", "player.hero_damage", "gte", 22000, ["summary.hero_damage"], "HARD", "RARE", "COMBAT"),
    mission("brawl_scoreboard_heal_3k", "STREET_BRAWL", "Полевой медик", "Наберите не менее 3 000 лечения по итоговой таблице Уличной стычки.", "player.scoreboard_healing", "gte", 3000, ["gep.scoreboard_healing"], "FOCUSED", "UNCOMMON", "SUPPORT"),
    mission("brawl_win", "STREET_BRAWL", "Хозяин улицы", "Победите в следующей Уличной стычке.", "match.win", "eq", 1, ["summary.result"], "FOCUSED", "COMMON", "COMBAT"),
    mission("brawl_kda_4", "STREET_BRAWL", "Легенда квартала", "Достигните KDA не ниже 4,0 в Уличной стычке.", "player.kda", "gte", 4, ["summary.kills", "summary.deaths", "summary.assists"], "EXTREME", "EPIC", "SURVIVAL"),
]


# The UI shows an approximate *inclusion chance*, not a raw RNG weight. Recalculate it from
# the exact v0.3 board algorithm so rare cards cannot advertise misleading percentages.
for _mode in ("STANDARD", "RANKED", "STREET_BRAWL"):
    _items = [item for item in MISSIONS_V2 if item["game_match_mode"] == _mode]
    _chances = estimate_inclusion_chances(_items, _mode)
    for _item in _items:
        _item["drop_chance_pct"] = _chances.get(_item["key"], 0.0)


def seed_missions(db: Session) -> None:
    existing = {
        mission.key: mission
        for mission in db.scalars(select(MissionDefinition).where(MissionDefinition.version == 2)).all()
    }
    changed = False
    for item in MISSIONS_V2:
        mission_row = existing.get(item["key"])
        if mission_row is None:
            db.add(MissionDefinition(version=2, status="PUBLISHED", **item))
            changed = True
            continue
        # Contracts 2.0 treats existing v2 rows as admin-maintained generator atoms.
        # Never overwrite edits made in Admin Console on every web/worker restart.
        # Code defaults are only used to create missing atoms on fresh installs.
        if not mission_row.title_en:
            mission_row.title_en = item["title_en"]
            changed = True
        if not mission_row.description_en:
            mission_row.description_en = item["description_en"]
            changed = True
    if changed:
        db.commit()
