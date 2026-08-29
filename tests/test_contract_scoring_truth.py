from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

_tmp = tempfile.TemporaryDirectory(prefix="dc-contract-truth-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(_tmp.name) / 'test.db'}")
os.environ.setdefault("MATCH_PROVIDER", "mock")
os.environ.setdefault("ALLOW_DEMO_AUTH", "true")
os.environ.setdefault("ALLOW_DEV_ENDPOINTS", "true")
os.environ.setdefault(
    "SESSION_SECRET",
    "test-secret-not-for-production-use-only-2026",
)

from app.db import Base
from app.models import (
    BoardOption,
    ContractBoard,
    MatchParticipant,
    MissionDefinition,
    OutboxEvent,
    RewardLedgerEntry,
    User,
)
from app.services.contract_factory import generate_contracts_v2
from app.services.evaluator import _result, capability_available, evaluate_board
from app.services.normalization import normalize_deadlock_match
from app.services.seed import MISSIONS_V2
from app.worker import dispatch_outbox, store_normalized_match


ACCOUNT_ID = 1020621313
STEAM_ID64 = 76561198980887041
NOW = datetime(2026, 8, 29, 20, 30, 0, tzinfo=timezone.utc)
TRUSTED_CAPABILITIES = {
    "summary.result",
    "summary.kills",
    "summary.deaths",
    "summary.assists",
    "summary.net_worth",
    "summary.hero_damage",
    "summary.object_damage",
    "summary.healing",
    "summary.scoreboard_healing",
    "summary.duration",
}
SUPPORTED_METRICS = {
    "match.win",
    "match.duration_s",
    "player.kills",
    "player.deaths",
    "player.assists",
    "player.kda",
    "player.net_worth.final",
    "player.hero_damage",
    "player.object_damage",
    "player.healing",
    "player.scoreboard_healing",
}


def _new_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def _participant_for_conditions(conditions: list[dict]) -> SimpleNamespace:
    kills = 100
    deaths = 1
    assists = 100
    net_worth = 1_000_000
    hero_damage = 1_000_000
    object_damage = 1_000_000
    healing = 1_000_000
    won = True

    for condition in conditions:
        metric = str(condition.get("metric") or "")
        operator = str(condition.get("operator") or "")
        target = float(condition.get("target") or 0)
        if metric == "player.kills" and operator == "gte":
            kills = max(kills, int(target))
        elif metric == "player.assists" and operator == "gte":
            assists = max(assists, int(target))
        elif metric == "player.deaths" and operator == "lte":
            deaths = min(deaths, max(0, int(target)))
        elif metric == "player.net_worth.final" and operator == "gte":
            net_worth = max(net_worth, int(target))
        elif metric == "player.hero_damage" and operator == "gte":
            hero_damage = max(hero_damage, int(target))
        elif metric == "player.object_damage" and operator == "gte":
            object_damage = max(object_damage, int(target))
        elif metric in {"player.healing", "player.scoreboard_healing"} and operator == "gte":
            healing = max(healing, int(target))
        elif metric == "match.win":
            won = target >= 1

    return SimpleNamespace(
        won=won,
        kills=kills,
        deaths=deaths,
        assists=assists,
        net_worth=net_worth,
        hero_damage=hero_damage,
        object_damage=object_damage,
        healing=healing,
    )


def _trusted_match(mode: str, conditions: list[dict], capabilities: list[str]) -> SimpleNamespace:
    duration_target = max(
        [
            int(float(item.get("target") or 0))
            for item in conditions
            if item.get("metric") == "match.duration_s"
        ]
        or [0]
    )
    return SimpleNamespace(
        is_final=True,
        provider="deadlock_api",
        duration_s=max(1800 if mode != "STREET_BRAWL" else 778, duration_target),
        game_match_mode=mode,
        scoring_status="SCORED",
        capabilities=list(capabilities),
    )


def _option_from_contract(contract) -> SimpleNamespace:
    conditions = [item.payload() for item in contract.conditions]
    return SimpleNamespace(
        conditions=conditions,
        metric=contract.metric,
        operator=contract.operator,
        target=contract.target,
        required_capabilities=list(contract.required_capabilities),
        required_game_match_mode=contract.game_match_mode,
    )


class CatalogueTruthTests(unittest.TestCase):
    def test_every_seed_contract_uses_supported_metric_and_trusted_capability(self) -> None:
        self.assertGreater(len(MISSIONS_V2), 0)
        for mission in MISSIONS_V2:
            with self.subTest(key=mission["key"]):
                self.assertIn(mission["metric"], SUPPORTED_METRICS)
                self.assertTrue(mission["required_capabilities"])
                self.assertTrue(
                    set(mission["required_capabilities"]).issubset(TRUSTED_CAPABILITIES),
                    f"{mission['key']} requires client-only/unknown capabilities: "
                    f"{mission['required_capabilities']}",
                )

    def test_every_seed_contract_can_complete_and_fail_with_authoritative_data(self) -> None:
        for mission in MISSIONS_V2:
            conditions = [
                {
                    "metric": mission["metric"],
                    "operator": mission["operator"],
                    "target": mission["target"],
                    "capabilities": list(mission["required_capabilities"]),
                }
            ]
            option = SimpleNamespace(
                conditions=conditions,
                metric=mission["metric"],
                operator=mission["operator"],
                target=mission["target"],
                required_capabilities=list(mission["required_capabilities"]),
                required_game_match_mode=mission["game_match_mode"],
            )
            match = _trusted_match(
                mission["game_match_mode"],
                conditions,
                list(mission["required_capabilities"]),
            )
            participant = _participant_for_conditions(conditions)

            with self.subTest(key=mission["key"], phase="pass"):
                result = _result(option, match, participant)
                self.assertEqual(result.status, "COMPLETED", result.explanation)

            failing = SimpleNamespace(**vars(participant))
            metric = mission["metric"]
            if metric == "match.win":
                failing.won = False
            elif metric == "match.duration_s":
                match = SimpleNamespace(**vars(match))
                match.duration_s = max(180 if mission["game_match_mode"] == "STREET_BRAWL" else 600, int(mission["target"]) - 1)
            elif metric == "player.kills":
                failing.kills = max(0, int(mission["target"]) - 1)
            elif metric == "player.assists":
                failing.assists = max(0, int(mission["target"]) - 1)
            elif metric == "player.deaths":
                failing.deaths = int(mission["target"]) + 1
            elif metric == "player.kda":
                failing.kills = 0
                failing.assists = 0
                failing.deaths = 10
            elif metric == "player.net_worth.final":
                failing.net_worth = max(0, int(mission["target"]) - 1)
            elif metric == "player.hero_damage":
                failing.hero_damage = max(0, int(mission["target"]) - 1)
            elif metric == "player.object_damage":
                failing.object_damage = max(0, int(mission["target"]) - 1)
            elif metric in {"player.healing", "player.scoreboard_healing"}:
                failing.healing = max(0, int(mission["target"]) - 1)

            with self.subTest(key=mission["key"], phase="fail"):
                result = _result(option, match, failing)
                self.assertEqual(result.status, "FAILED", result.explanation)


class GeneratedContractTruthTests(unittest.TestCase):
    def _carrier_rows(self, mode: str) -> list[SimpleNamespace]:
        rows = []
        for index, mission in enumerate(
            item for item in MISSIONS_V2 if item["game_match_mode"] == mode
        ):
            rows.append(
                SimpleNamespace(
                    id=f"mission-{mode}-{index}",
                    key=mission["key"],
                    metric=mission["metric"],
                    required_capabilities=list(mission["required_capabilities"]),
                    game_match_mode=mission["game_match_mode"],
                    difficulty=mission["difficulty"],
                    rarity=mission["rarity"],
                    drop_weight=mission["drop_weight"],
                    category=mission["category"],
                )
            )
        return rows

    def test_generated_boards_are_unique_supported_and_scorable_across_many_seeds(self) -> None:
        for mode in ("STANDARD", "RANKED", "STREET_BRAWL"):
            carriers = self._carrier_rows(mode)
            for seed_no in range(60):
                contracts = generate_contracts_v2(
                    carriers,
                    f"truth:{mode}:{seed_no}",
                    board_size=6,
                )
                self.assertEqual(len(contracts), 6)
                self.assertEqual(len({item.fingerprint for item in contracts}), 6)
                self.assertLessEqual(
                    sum(1 for item in contracts if item.difficulty == "EXTREME"),
                    1,
                )

                for contract in contracts:
                    with self.subTest(mode=mode, seed=seed_no, title=contract.title):
                        self.assertIn(contract.metric, SUPPORTED_METRICS)
                        self.assertTrue(
                            set(contract.required_capabilities).issubset(TRUSTED_CAPABILITIES),
                            contract.required_capabilities,
                        )
                        self.assertEqual(contract.game_match_mode, mode)
                        self.assertIn(len(contract.conditions), {1, 2, 3})

                        option = _option_from_contract(contract)
                        conditions = [item.payload() for item in contract.conditions]
                        match = _trusted_match(
                            mode,
                            conditions,
                            list(contract.required_capabilities),
                        )
                        participant = _participant_for_conditions(conditions)
                        result = _result(option, match, participant)
                        self.assertEqual(result.status, "COMPLETED", result.explanation)
                        self.assertEqual(len(result.facts), len(conditions))
                        self.assertTrue(all(item["passed"] for item in result.facts))


class ProviderNormalizationTruthTests(unittest.TestCase):
    def _metadata(self, *, mode: str) -> tuple[dict, dict]:
        if mode == "STREET_BRAWL":
            match_mode, game_mode = 1, 4
        elif mode == "RANKED":
            match_mode, game_mode = 4, 1
        else:
            match_mode, game_mode = 1, 1

        history = {
            "match_id": 102442126,
            "start_time": int((NOW - timedelta(seconds=778)).timestamp()),
            "match_mode": match_mode,
            "game_mode": game_mode,
            "player_match_outcome": 1,
        }
        metadata = {
            "match_info": {
                "match_id": 102442126,
                "duration_s": 778 if mode == "STREET_BRAWL" else 1800,
                "match_mode": match_mode,
                "game_mode": game_mode,
                "players": [
                    {
                        "account_id": ACCOUNT_ID,
                        "hero_id": 64,
                        "player_team": 1,
                        "player_match_outcome": 1,
                        "kills": 4,
                        "deaths": 3,
                        "assists": 8,
                        "net_worth": 34000,
                        "stats": [
                            {
                                "time_stamp_s": 778,
                                "player_damage": 26876,
                                "player_healing": 4478,
                                "teammate_healing": 3001,
                            }
                        ],
                    }
                ],
            }
        }
        return history, metadata

    def test_street_brawl_uses_independent_scoreboard_healing(self) -> None:
        history, metadata = self._metadata(mode="STREET_BRAWL")
        normalized = normalize_deadlock_match(ACCOUNT_ID, history, metadata)
        self.assertEqual(normalized["game_match_mode"], "STREET_BRAWL")
        self.assertEqual(normalized["participant"]["healing"], 4478)
        self.assertIn("summary.scoreboard_healing", normalized["capabilities"])
        self.assertNotIn("summary.healing", normalized["capabilities"])

    def test_standard_keeps_teammate_healing_semantics(self) -> None:
        history, metadata = self._metadata(mode="STANDARD")
        normalized = normalize_deadlock_match(ACCOUNT_ID, history, metadata)
        self.assertEqual(normalized["game_match_mode"], "STANDARD")
        self.assertEqual(normalized["participant"]["healing"], 3001)
        self.assertIn("summary.healing", normalized["capabilities"])
        self.assertNotIn("summary.scoreboard_healing", normalized["capabilities"])

    def test_old_locked_brawl_scoreboard_capability_is_compatible_with_provider(self) -> None:
        option = SimpleNamespace(
            metric="player.scoreboard_healing",
            required_capabilities=["gep.scoreboard_healing"],
            conditions=[
                {
                    "metric": "player.scoreboard_healing",
                    "operator": "gte",
                    "target": 3000,
                    "capabilities": ["gep.scoreboard_healing"],
                }
            ],
        )
        match = SimpleNamespace(
            provider="deadlock_api",
            game_match_mode="STREET_BRAWL",
            capabilities=["summary.scoreboard_healing"],
        )
        self.assertTrue(capability_available(option, match, "gep.scoreboard_healing"))


class RealStreetBrawlSettlementTests(unittest.TestCase):
    def test_real_102442126_shape_completes_three_contracts_and_credits_xp(self) -> None:
        db = _new_db()
        with db:
            user = User(
                steam_id64=STEAM_ID64,
                account_id=ACCOUNT_ID,
                display_name="Mandarin",
                xp=0,
            )
            db.add(user)
            db.flush()

            missions = [
                MissionDefinition(
                    key="qa-assists",
                    version=99,
                    title="Общий интерес",
                    description="8 assists",
                    metric="player.assists",
                    operator="gte",
                    target=8,
                    reward_xp=80,
                    required_capabilities=["summary.assists"],
                    game_match_mode="STREET_BRAWL",
                ),
                MissionDefinition(
                    key="qa-win-kills",
                    version=99,
                    title="Жёсткий протокол",
                    description="win + 4 kills",
                    metric="match.win",
                    operator="eq",
                    target=1,
                    reward_xp=120,
                    required_capabilities=["summary.result", "summary.kills"],
                    game_match_mode="STREET_BRAWL",
                ),
                MissionDefinition(
                    key="qa-scoreboard-heal",
                    version=99,
                    title="Сеть контактов",
                    description="3000 scoreboard healing",
                    metric="player.scoreboard_healing",
                    operator="gte",
                    target=3000,
                    reward_xp=100,
                    required_capabilities=["summary.scoreboard_healing"],
                    game_match_mode="STREET_BRAWL",
                ),
            ]
            db.add_all(missions)
            db.flush()

            board = ContractBoard(
                user_id=user.id,
                board_date=date(2026, 8, 29),
                status="VERIFYING",
                game_match_mode="STREET_BRAWL",
                seed="real-102442126",
                attempts_used=1,
                max_attempts=3,
                locked_at=NOW - timedelta(minutes=20),
                expires_at=NOW + timedelta(hours=6),
            )
            db.add(board)
            db.flush()

            conditions = [
                [
                    {
                        "metric": "player.assists",
                        "operator": "gte",
                        "target": 8,
                        "capabilities": ["summary.assists"],
                    }
                ],
                [
                    {
                        "metric": "match.win",
                        "operator": "eq",
                        "target": 1,
                        "capabilities": ["summary.result"],
                    },
                    {
                        "metric": "player.kills",
                        "operator": "gte",
                        "target": 4,
                        "capabilities": ["summary.kills"],
                    },
                ],
                [
                    {
                        "metric": "player.scoreboard_healing",
                        "operator": "gte",
                        "target": 3000,
                        "capabilities": ["summary.scoreboard_healing"],
                    }
                ],
            ]

            match = store_normalized_match(
                db,
                {
                    "external_match_id": 102442126,
                    "provider": "deadlock_api",
                    "provider_payload_hash": "c" * 64,
                    "started_at": NOW - timedelta(seconds=778),
                    "ended_at": NOW,
                    "duration_s": 778,
                    "game_match_mode": "STREET_BRAWL",
                    "provider_mode_raw": "match_mode=1, game_mode=4",
                    "mode_classifier_version": "qa-truth-v1",
                    "mode_confidence": "HIGH",
                    "scoring_status": "SCORED",
                    "is_final": True,
                    "capabilities": [
                        "summary.result",
                        "summary.kills",
                        "summary.deaths",
                        "summary.assists",
                        "summary.hero_damage",
                        "summary.scoreboard_healing",
                        "summary.duration",
                    ],
                    "raw_summary": {"qa_fixture": "102442126"},
                    "participant": {
                        "account_id": ACCOUNT_ID,
                        "steam_id64": STEAM_ID64,
                        "hero_id": 64,
                        "won": True,
                        "kills": 4,
                        "deaths": 3,
                        "assists": 8,
                        "net_worth": 34000,
                        "hero_damage": 26876,
                        "object_damage": 7979,
                        "healing": 4478,
                    },
                },
            )

            for mission, rows in zip(missions, conditions):
                option = BoardOption(
                    board_id=board.id,
                    mission_definition_id=mission.id,
                    rendered_title=mission.title,
                    rendered_description=mission.description,
                    metric=mission.metric,
                    operator=mission.operator,
                    target=mission.target,
                    reward_xp=mission.reward_xp,
                    required_capabilities=list(mission.required_capabilities or []),
                    required_game_match_mode="STREET_BRAWL",
                    selected=True,
                    status="VERIFYING",
                    locked_at=board.locked_at,
                    bound_match_id=match.id,
                    conditions=rows,
                )
                db.add(option)
            db.commit()

            processed = evaluate_board(db, board.id, match.id)
            self.assertEqual(processed, 3)

            options = list(
                db.scalars(
                    select(BoardOption)
                    .where(BoardOption.board_id == board.id)
                    .order_by(BoardOption.rendered_title)
                ).all()
            )
            self.assertTrue(options)
            self.assertTrue(all(item.status == "COMPLETED" for item in options))
            db.refresh(board)
            self.assertEqual(board.status, "SETTLED")

            events = list(
                db.scalars(
                    select(OutboxEvent).where(
                        OutboxEvent.event_type == "assignment.settled"
                    )
                ).all()
            )
            self.assertEqual(len(events), 3)
            self.assertEqual(sum(int(item.payload["reward_xp"]) for item in events), 300)

            # Drain the durable reward outbox and verify idempotent XP crediting.
            for _ in range(3):
                self.assertTrue(dispatch_outbox(db))
            self.assertFalse(dispatch_outbox(db))

            db.refresh(user)
            self.assertEqual(user.xp, 300)
            ledger = list(db.scalars(select(RewardLedgerEntry)).all())
            self.assertEqual(len(ledger), 3)
            self.assertEqual(sum(item.delta for item in ledger), 300)


if __name__ == "__main__":
    unittest.main()
