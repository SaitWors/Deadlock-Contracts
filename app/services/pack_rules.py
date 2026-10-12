"""Integer rank odds and paid-card guarantees; independent of artwork counts."""
from __future__ import annotations

import secrets

RANKS = ("F", "E", "D", "C", "B", "A", "S", "SS", "SSS")
RULE_VERSION = "packs-v2"
SLOT_WEIGHTS = {
    "ORDINARY": (3400, 2500, 1800, 1200, 600, 300, 130, 55, 15),
    "B_PLUS": (0, 0, 0, 0, 7000, 2000, 700, 250, 50),
}
THRESHOLDS = {"without_a": (30, "A"), "without_s": (120, "S"), "without_sss": (360, "SSS")}
PRESETS = {
    "NIGHT_ENVELOPE": {"price": 180, "slots": ["ORDINARY"] * 3,
                       "title": "Ночной конверт / Night envelope"},
    "SPECIAL_FOLDER": {"price": 450, "slots": ["ORDINARY"] * 4 + ["B_PLUS"],
                       "title": "Папка особого отдела / Special department folder"},
}


def minimum_rank(counters):
    forced = [rank for key, (limit, rank) in THRESHOLDS.items() if counters[key] + 1 >= limit]
    return max(forced, key=RANKS.index) if forced else None


def slot_odds(slot_kind, minimum=None):
    weights = {}
    for rank, weight in zip(RANKS, SLOT_WEIGHTS[slot_kind]):
        if weight:
            final = minimum if minimum and RANKS.index(rank) < RANKS.index(minimum) else rank
            weights[final] = weights.get(final, 0) + weight
    return [{"rank": rank, "weight": weights[rank], "total_weight": 10000, "percent": weights[rank] / 100}
            for rank in RANKS if rank in weights]


def draw_slot(slot_kind, counters, randbelow=None):
    ticket = (randbelow or secrets.randbelow)(10000)
    natural = RANKS[-1]
    for rank, weight in zip(RANKS, SLOT_WEIGHTS[slot_kind]):
        ticket -= weight
        if ticket < 0:
            natural = rank
            break
    minimum = minimum_rank(counters)
    final = max((natural, minimum or natural), key=RANKS.index)
    updated = {key: 0 if RANKS.index(final) >= RANKS.index(rank) else counters[key] + 1
               for key, (_, rank) in THRESHOLDS.items()}
    return {"slot_kind": slot_kind, "natural_rank": natural, "rank": final,
            "guaranteed_minimum_rank": minimum, "forced": final != natural}, updated


def choose_artwork(entries, rank, randbelow=None):
    """One approved weight per hero/rank; illustration multiplicity is separate."""
    variants = {}
    for entry in entries:
        if entry["rank"] != rank:
            continue
        group = variants.setdefault(entry["hero"], {"weight": entry["weight"], "cards": []})
        if group["weight"] != entry["weight"]:
            raise ValueError("Conflicting weights for the same hero variant")
        group["cards"].append(entry["card_id"])
    if not variants:
        raise ValueError("No artwork for the required rank")
    random_ticket = randbelow or secrets.randbelow
    ticket = random_ticket(sum(group["weight"] for group in variants.values()))
    for hero in sorted(variants):
        group = variants[hero]
        ticket -= group["weight"]
        if ticket < 0:
            cards = sorted(group["cards"])
            return cards[random_ticket(len(cards))]
    raise ValueError("Invalid random ticket")
