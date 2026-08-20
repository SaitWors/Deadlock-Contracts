from __future__ import annotations

import random
from collections import Counter
from typing import Any, Iterable


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _weighted_pick(rng: random.Random, candidates: list[Any], selected: list[Any]) -> Any:
    """Pick one contract while keeping rarity dominant and category variety a soft preference."""
    weights: list[float] = []
    for item in candidates:
        weight = max(0.001, float(_value(item, "drop_weight", 0.001) or 0.001))
        same_category = sum(1 for chosen in selected if _value(chosen, "category") == _value(item, "category"))
        # Vault guidance asks the generator to avoid monotonous boards. Make this a soft
        # penalty instead of a hard cap so a thin mode pool never forces rare/extreme cards.
        if same_category >= 2:
            weight *= 0.6 ** (same_category - 1)
        weights.append(weight)

    total = sum(weights)
    point = rng.random() * total
    cursor = 0.0
    for item, weight in zip(candidates, weights):
        cursor += weight
        if cursor >= point:
            return item
    return candidates[-1]


def generate_contract_set(candidates: Iterable[Any], seed: str, board_size: int = 6) -> list[Any]:
    pool = list(candidates)
    if len(pool) < board_size:
        raise RuntimeError(f"Для режима недостаточно миссий: нужно минимум {board_size}")

    # Stable ordering means a board seed behaves the same even when the database returns
    # rows in a different physical order.
    pool.sort(key=lambda item: str(_value(item, "key", "")))
    rng = random.Random(seed)
    selected: list[Any] = []

    # At least one comfortable option per board when the mode has one.
    light = [item for item in pool if _value(item, "difficulty") == "LIGHT"]
    if light:
        first = _weighted_pick(rng, light, selected)
        selected.append(first)
        pool.remove(first)

    while len(selected) < board_size and pool:
        # Do not intentionally offer two EXTREME contracts on one board. If a future tiny
        # pool makes that impossible, fail soft rather than refusing to create the board.
        valid = [
            item
            for item in pool
            if not (
                _value(item, "difficulty") == "EXTREME"
                and any(_value(chosen, "difficulty") == "EXTREME" for chosen in selected)
            )
        ]
        if not valid:
            valid = pool
        picked = _weighted_pick(rng, valid, selected)
        selected.append(picked)
        pool.remove(picked)

    return selected[:board_size]


def estimate_inclusion_chances(candidates: Iterable[dict[str, Any]], mode: str, *, samples: int = 4000, board_size: int = 6) -> dict[str, float]:
    """Deterministically estimate the actual per-board inclusion chance shown in the UI.

    Weighted sampling without replacement, the guaranteed LIGHT slot and category diversity
    make a raw weight unsuitable as a user-facing percentage. This small Monte-Carlo pass is
    performed only while constructing the v0.3 seed catalogue and gives each mission an honest
    approximate inclusion probability for the current pool.
    """
    pool = list(candidates)
    counts: Counter[str] = Counter()
    if not pool:
        return {}
    for index in range(samples):
        for item in generate_contract_set(pool, f"chance:{mode}:{index}", board_size=board_size):
            counts[str(item["key"])] += 1
    return {str(item["key"]): round(counts[str(item["key"])] * 100.0 / samples, 1) for item in pool}
