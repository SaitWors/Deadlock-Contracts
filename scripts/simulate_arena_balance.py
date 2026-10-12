"""Reproducible legal-squad diagnostics, not a measured human win-rate claim."""
import argparse
from collections import Counter
import json
from pathlib import Path
import random

from app.services import card_battle as battle


def squad(keys, ranks, prefix, rng):
    values = list(zip(keys, ranks))
    rng.shuffle(values)
    return [{"id": f"{prefix}:{index}", "hero_key": key, "rank": rank,
        "line": index//2, "position": "FRONT" if index%2 == 0 else "BACK"}
        for index, (key, rank) in enumerate(values)]


def play(first, second, base_a, base_b):
    state = battle.initial_state(first, second, base_a=base_a, base_b=base_b)
    while state["status"] != "FINISHED":
        # Both plans are computed from the same public round-start snapshot.
        left = battle.bot_plan(state, "A", "NORMAL")
        right = battle.bot_plan(state, "B", "NORMAL")
        state, _ = battle.resolve_round(state, left, right)
    return state


def simulate(seed):
    rng = random.Random(seed)
    rows = []
    for hero in battle.HEROES:
        others = rng.sample([key for key in battle.HEROES if key != hero], 5)
        opponent_keys = rng.sample(list(battle.HEROES), 6)
        for focus_rank, ranks in (("F", ("F", "S", "A", "A", "C", "D")),
                                  ("SSS", ("SSS", "C", "C", "D", "D", "E"))):
            first = squad([hero, *others], ranks, "focus", rng)
            second = squad(opponent_keys, ("S", "S", "B", "C", "E", "F"), "opponent", rng)
            for base in battle.BASES:
                assert battle.validate_squad(first, base) == battle.validate_squad(second, base)
                original = play(first, second, base, base)
                mirrored = play(second, first, base, base)
                winner = original["result"]["winner_side"]
                assert mirrored["result"]["winner_side"] == ({"A": "B", "B": "A", None: None}[winner])
                assert original["round"] == mirrored["round"]
                assert [side["base"]["hp"] for side in original["sides"]] == list(reversed([side["base"]["hp"] for side in mirrored["sides"]]))
                for flipped, state in ((False, original), (True, mirrored)):
                    focus_side = "B" if flipped else "A"
                    winner = state["result"]["winner_side"]
                    rows.append({"hero": hero, "role": battle.HEROES[hero]["role"], "focus_rank": focus_rank,
                        "patron": base, "focus_side": focus_side, "budget": battle.validate_squad(first, base),
                        "focus_squad": [{key: value[key] for key in ("hero_key", "rank", "line", "position")} for value in first],
                        "opponent_squad": [{key: value[key] for key in ("hero_key", "rank", "line", "position")} for value in second],
                        "outcome": "DRAW" if winner is None else "WIN" if winner == focus_side else "LOSS",
                        "rounds": state["round"], "reason": state["result"]["reason"]})
    return {"rules": battle.VERSION, "seed": seed, "policy": "NORMAL vs NORMAL, both sealed before resolution",
        "limitation": "Mirrored pairs are dependent diagnostics. Rank substitutions redistribute the same total budget; compositions and positions confound rank effects. These are not human win rates or evidence of statistical balance.",
        "matches": len(rows), "outcomes": dict(Counter(row["outcome"] for row in rows)),
        "side_counts": dict(Counter(row["focus_side"] for row in rows)), "rows": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=20261012)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = simulate(args.seed)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "rows"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
