"""Compare Relay GC policies on the same synthetic matches; no Steam or API access."""

from __future__ import annotations

import argparse
import json
import math
import random
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from statistics import median

HOUR = 60
DAY = 24 * HOUR
POLICIES = ("round_robin", "legacy_ingest", "smart", "streamer_priority")


@dataclass(frozen=True)
class Match:
    players: tuple[int, ...]
    contracts: tuple[int, ...]
    fulfilled: tuple[int, ...]
    start: int
    end: int
    history_at: int
    metadata_at: int
    collectible: bool


@dataclass(frozen=True)
class Scenario:
    hours: int
    active: int
    streamers: int
    limits: tuple[int, int]
    seed: int


def generate(scenario: Scenario) -> tuple[list[Match], set[int]]:
    rng = random.Random(scenario.seed)
    hidden = set(rng.sample(range(scenario.active), max(1, scenario.active // 4)))
    next_game = [0] * scenario.active
    matches = []
    for now in range(8 * HOUR, scenario.hours * HOUR, 20):
        hour = now % DAY // HOUR
        if rng.random() > (0.91 if 18 <= hour < 24 else 0.29 if 11 <= hour < 18 else 0.04):
            continue
        available = [player for player, due in enumerate(next_game) if due <= now]
        if not available:
            continue
        players = tuple(sorted(rng.sample(available, min(len(available), rng.choice((1, 1, 1, 2, 3))))))
        duration = rng.randint(10, 22) if rng.random() < 0.25 else rng.randint(25, 45)
        end = now + duration
        for player in players:
            next_game[player] = end + rng.choice((10, 20, 25, 60, 180))
        contracts = tuple(player for player in players if rng.random() < 0.72)
        fulfilled = tuple(player for player in contracts if rng.random() < 0.67)
        history_at = end + rng.choice((3, 30, 65, 120, 250, 650, 1440, 5000))
        metadata_at = history_at + rng.choice((0, 0, 8, 15, 90, 240, 660))
        matches.append(Match(players, contracts, fulfilled, now, end, history_at, metadata_at, rng.random() < 0.9))
    return matches, hidden


class Requests:
    def __init__(self, limits: tuple[int, int]) -> None:
        self.limits = limits
        self.reserved = tuple(limit // 5 for limit in limits)
        self.timestamps: tuple[deque[int], deque[int]] = (deque(), deque())
        self.full_cycles: Counter[int] = Counter()
        self.peak: Counter[int] = Counter()
        self.spent: Counter[tuple[int, bool]] = Counter()
        self.useful: Counter[int] = Counter()
        self.reserve_spent: Counter[int] = Counter()

    def available(self, kind: int, now: int, urgent: bool = True) -> bool:
        timeline = self.timestamps[kind]
        while timeline and timeline[0] <= now - DAY:
            timeline.popleft()
        limit = self.limits[kind] - (0 if urgent else self.reserved[kind])
        return len(timeline) < limit

    def charge(self, kind: int, now: int, streamer: bool, urgent: bool) -> bool:
        if not self.available(kind, now, urgent):
            return False
        timeline = self.timestamps[kind]
        if len(timeline) >= self.limits[kind] - self.reserved[kind]:
            self.reserve_spent[kind] += 1
        timeline.append(now)
        self.spent[kind, streamer] += 1
        self.peak[kind] = max(self.peak[kind], len(timeline))
        return True


def priority(wait: int, signal: int, streamer: bool, missed: bool) -> int:
    return 100 + signal + 40 * streamer + min(120, 10 * (wait // HOUR)) - 30 * missed


def percentile(values: list[int], fraction: float) -> int | None:
    return sorted(values)[math.ceil(len(values) * fraction) - 1] if values else None


def simulate(scenario: Scenario, policy: str) -> dict:
    matches, hidden = generate(scenario)
    streamers = set(range(scenario.streamers))
    stop = scenario.hours * HOUR
    smart = policy in ("smart", "streamer_priority")
    boost = policy == "streamer_priority"
    legacy = policy == "legacy_ingest"
    requests = Requests(scenario.limits)
    cooldown: dict[int, int] = defaultdict(int)
    missed: set[int] = set()
    metadata_pending: dict[int, int] = {}
    requested: set[int] = set()
    collected: dict[int, int] = {}
    settled: dict[tuple[int, int], tuple[int, bool]] = {}
    discovered: set[int] = set()
    availability_known: set[int] = set()
    duplicate_discoveries = 0
    background = random.Random(scenario.seed + 1)
    latest_result = {player: -background.randint(30, 2 * DAY) for player in range(scenario.active)}
    previous_presence = {player: end + background.randint(0, 90) for player, end in latest_result.items()}
    cadence = {player: background.choice((90, 180, 300, 720, 1440, 2880)) for player in latest_result}
    latest_stored_id = dict.fromkeys(latest_result, -1)
    streamer_streak = [0, 0]
    last_player: list[int | None] = [None, None]
    last_charge = [-DAY, -DAY]
    normal_spacing = [max(base, math.ceil(DAY / (limit - limit // 5))) for base, limit in zip((60, 30), scenario.limits)]
    player_cursor = 0
    observed_hour = -1
    demand: list[int | None] = [None] * 24
    reserve_available = [0, 0]

    def order(options: list[tuple[int, int, int, bool]], kind: int) -> list[tuple[int, int, int, bool]]:
        def score(option: tuple[int, int, int, bool], with_bonus: bool = False) -> int:
            wait, signal, player, was_missed = option
            return priority(wait, signal, with_bonus and player in streamers, was_missed)

        options.sort(key=lambda option: (
            boost and (option[2] in streamers or option[0] < 6 * HOUR),
            -score(option, boost), -option[0], -option[2],
        ))
        if options and options[0][2] == last_player[kind]:
            preferred = options[0]
            for index, alternative in enumerate(options[1:], 1):
                if (
                    alternative[2] != preferred[2]
                    and (alternative[2] in streamers) == (preferred[2] in streamers)
                    and score(alternative) >= score(preferred) - 20
                ):
                    options.insert(0, options.pop(index))
                    break
        if boost and options and options[0][2] in streamers and streamer_streak[kind] >= 2:
            preferred = options[0]
            for index, alternative in enumerate(options[1:], 1):
                if alternative[2] not in streamers and score(alternative) >= score(preferred) - 30:
                    options.insert(0, options.pop(index))
                    break
        return options

    def allowed(kind: int, now: int, urgent: bool, observed_completion: bool = False) -> bool:
        if smart and now - last_charge[kind] < (60 if observed_completion else normal_spacing[kind]):
            return False
        return requests.available(kind, now, urgent)

    def charge(kind: int, now: int, player: int, urgent: bool, observed_completion: bool = False) -> bool:
        if not allowed(kind, now, urgent, observed_completion):
            return False
        if not requests.charge(kind, now, player in streamers, urgent):
            return False
        last_charge[kind] = now
        last_player[kind] = player
        streamer_streak[kind] = streamer_streak[kind] + 1 if player in streamers else 0
        return True

    for now in range(0, stop + 1, 5):
        new_hour = now // HOUR != observed_hour
        for kind in (0, 1):
            if new_hour:
                requests.full_cycles[kind] += not requests.available(kind, now)
                reserve_available[kind] += requests.available(kind, now)
        observed_hour = now // HOUR
        for match_id, match in enumerate(matches):
            if now >= match.history_at and match_id not in availability_known:
                availability_known.add(match_id)
                for player in match.players:
                    latest_result[player] = max(latest_result[player], match.end)
                    latest_stored_id[player] = max(latest_stored_id[player], match_id)
            if min(match.metadata_at, collected.get(match_id, math.inf)) <= now:
                metadata_pending.pop(match_id, None)
                if now < match.start + DAY:
                    for player in match.contracts:
                        settled.setdefault((match_id, player), (now, player in match.fulfilled))
        if now == stop or (not smart and now % 30):
            continue
        # A daily restart skips one pass. Quota, cooldowns and class state remain present.
        if now > 0 and now % DAY == 2 * HOUR:
            continue

        if smart and new_hour:
            players = {
                player for match_id, match in enumerate(matches) if match.start <= now < match.start + DAY
                for player in match.contracts if (match_id, player) not in settled
            }
            hour = observed_hour % 24
            previous = demand[hour]
            demand[hour] = len(players) if previous is None else (previous * 3 + len(players) + 3) // 4
        hour = observed_hour % 24
        peak_soon = demand[hour] is not None and demand[hour] <= 3 and any(
            (demand[(hour + offset) % 24] or 0) >= 8 for offset in (1, 2)
        )

        history_options = []
        for player in range(30):
            if now < cooldown[player]:
                continue
            eligible = [
                (match_id, match)
                for match_id, match in enumerate(matches)
                if player in match.players and match.start <= now < match.start + DAY
            ]
            if not smart:
                if legacy:
                    # Upstream asks for recently indexed players, then projects persona/cadence.
                    if player not in latest_result:
                        continue
                    in_game = player not in hidden and any(now < match.end + 15 for _, match in eligible)
                    last_seen = max(
                        (min(now, match.end + 15) for _, match in eligible), default=previous_presence[player]
                    )
                    elapsed = now - latest_result[player]
                    gap = cadence[player]
                    if in_game and elapsed > HOUR:
                        history_options.append((elapsed * 100 // gap, 1 << 32, player, False))
                    elif not in_game and (
                        elapsed > 2 * gap if player in hidden else elapsed > gap and last_seen > latest_result[player] + 45
                    ):
                        history_options.append((elapsed * 100 // gap, 0, player, False))
                else:
                    history_options.append((0, 0, player, False))
                continue
            pending = [
                match
                for match_id, match in eligible
                if player in match.contracts and (match_id, player) not in settled
                and match_id not in metadata_pending and match_id not in availability_known
                and now >= match.start + (15 if match.end - match.start < 25 else 35)
            ]
            if not pending:
                continue
            waited = now - min(match.start for match in pending)
            signal = 0
            if player not in hidden:
                if any(match.end <= now <= match.end + 60 for match in pending):
                    signal = 40
                elif any(
                    match.start + (15 if match.end - match.start < 25 else 35) <= now < match.end + 15
                    for match in pending
                ):
                    signal = 30
            history_options.append((waited, signal, player, player in missed))

        if smart:
            history_options = order([
                option for option in history_options
                if allowed(0, now, option[1] >= 40 or (option[2] not in streamers and option[0] >= 6 * HOUR),
                           option[1] >= 40)
                and not (peak_soon and option[0] < 2 * HOUR and option[1] < 40
                         and scenario.limits[0] - len(requests.timestamps[0]) <= requests.reserved[0] + 2)
            ], 0)
            for match_id in availability_known - requested - metadata_pending.keys():
                match = matches[match_id]
                pending_players = [player for player in match.contracts if (match_id, player) not in settled]
                if pending_players and now < match.start + DAY:
                    metadata_pending[match_id] = max(pending_players, key=lambda player: (boost and player in streamers, -player))
        elif legacy:
            history_options.sort(key=lambda option: (-(option[0] + option[1]), option[2]))
        else:
            history_options.sort(key=lambda option: (option[2] - player_cursor) % 30)

        per_pass = 1 if smart else 5 if legacy else 1
        for waited, signal, player, _ in history_options[:per_pass]:
            urgent = not smart or signal >= 40 or (player not in streamers and waited >= 6 * HOUR)
            if not requests.available(1, now) or not charge(0, now, player, urgent, signal >= 40):
                continue
            player_cursor = (player + 1) % 30
            found = [
                match_id for match_id, match in enumerate(matches)
                if player in match.players and match.end <= now < match.start + DAY
                and (not smart or player in match.contracts)
                and (not legacy or match_id > latest_stored_id[player])
            ]
            fresh = set(found) - availability_known - requested
            due = fresh - discovered
            duplicate_discoveries += len(fresh & discovered)
            discovered.update(fresh)
            requests.useful[0] += bool(due)
            if due:
                missed.discard(player)
            else:
                missed.add(player)
            cooldown[player] = now + (180 if smart and due else 360 if smart or legacy else 90)
            for match_id in due:
                metadata_pending.setdefault(match_id, player)

        queue = sorted(metadata_pending, key=lambda match_id: (-matches[match_id].end, match_id))
        if smart:
            candidates = defaultdict(list)
            for match_id in queue:
                option = (now - matches[match_id].start, 60, metadata_pending[match_id], False)
                candidates[option].append(match_id)
            queue = [match_id for option in order(list(candidates), 1) for match_id in candidates[option]]
        for match_id in queue[:2 if smart else len(queue)]:
            match = matches[match_id]
            player = metadata_pending[match_id]
            if smart and (now >= match.start + DAY or not match.contracts):
                del metadata_pending[match_id]
                continue
            if not charge(1, now, player, True):
                break
            del metadata_pending[match_id]
            requested.add(match_id)
            if match.collectible:
                collected[match_id] = now + 10
                requests.useful[1] += bool(match.contracts and collected[match_id] < match.metadata_at)
                for teammate in match.players:
                    latest_stored_id[teammate] = max(latest_stored_id[teammate], match_id)
                    latest_result[teammate] = max(latest_result[teammate], match.end)

    groups = {}
    for name, is_streamer in (("streamer", True), ("regular", False)):
        eligible = [
            (match_id, player)
            for match_id, match in enumerate(matches)
            for player in match.contracts
            if match.end < stop and (player in streamers) == is_streamer
        ]
        confirmed = [key for key in eligible if key in settled and settled[key][1]]
        delays = [settled[key][0] - matches[key[0]].end for key in confirmed]
        ages = [min(stop, matches[key[0]].start + DAY) - matches[key[0]].end for key in eligible if key not in settled]
        groups[name] = {
            "attempts": len(eligible), "resolved": sum(key in settled for key in eligible),
            "confirmed": len(confirmed),
            "confirmed_with_gc": sum(settled[key][0] < matches[key[0]].metadata_at for key in confirmed),
            "median_minutes": median(delays) if delays else None,
            "p90_minutes": percentile(delays, 0.9),
            "max_wait_minutes": max([*delays, *ages], default=None),
            "max_pending_minutes": max(ages, default=None),
            "history_requests": requests.spent[0, is_streamer], "metadata_requests": requests.spent[1, is_streamer],
        }
    return {
        "groups": groups,
        "gc_matches_discovered": len(discovered),
        "duplicated_discoveries_avoided": duplicate_discoveries,
        "resolved_through_public_data": sum(
            settled_at >= matches[match_id].metadata_at for (match_id, _), (settled_at, _) in settled.items()
        ),
        "quota": {
            name: {
                "used": sum(requests.spent[kind, klass] for klass in (True, False)),
                "useful": requests.useful[kind],
                "peak_24h": requests.peak[kind],
                "hours_fully_spent": requests.full_cycles[kind],
                "hours_with_capacity": reserve_available[kind],
                "reserve_requests": requests.reserve_spent[kind],
            }
            for kind, name in enumerate(("history", "metadata"))
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=4159)
    args = parser.parse_args()
    scenarios = (
        Scenario(24, 12, 2, (20, 40), args.seed),
        Scenario(48, 15, 3, (20, 40), args.seed),
        Scenario(168, 15, 2, (20, 40), args.seed),
        Scenario(168, 15, 8, (10, 20), args.seed),
    )
    print(json.dumps([
        {"scenario": vars(scenario), "policies": {policy: simulate(scenario, policy) for policy in POLICIES}}
        for scenario in scenarios
    ], indent=2))


if __name__ == "__main__":
    main()
