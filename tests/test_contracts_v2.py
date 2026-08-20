from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.services.contract_factory import GENERATOR_VERSION, TARGET_RULES, generate_contracts_v2
from app.services.evaluator import _result
from app.services.boards import upgrade_offered_boards_to_contracts_v2
from app.db import Base
from app.models import BoardOption, ContractBoard, MissionDefinition, User


CAPS = {
    "player.kills": ["summary.kills"],
    "player.deaths": ["summary.deaths"],
    "player.assists": ["summary.assists"],
    "player.kda": ["summary.kills", "summary.deaths", "summary.assists"],
    "player.net_worth.final": ["summary.net_worth"],
    "player.hero_damage": ["summary.hero_damage"],
    "player.healing": ["summary.healing"],
    "player.scoreboard_healing": ["gep.scoreboard_healing"],
    "match.duration_s": ["summary.duration"],
    "match.win": ["summary.result"],
}

CATEGORY = {
    "player.assists": "SUPPORT",
    "player.healing": "SUPPORT",
    "player.scoreboard_healing": "SUPPORT",
    "player.deaths": "SURVIVAL",
    "player.kda": "SURVIVAL",
    "player.net_worth.final": "ECONOMY",
}


def atoms(mode: str):
    rows = []
    for index, metric in enumerate(TARGET_RULES[mode]):
        rows.append(
            SimpleNamespace(
                id=f"{mode.lower()}-{index}",
                key=f"{mode.lower()}-{metric}",
                game_match_mode=mode,
                metric=metric,
                difficulty="FOCUSED",
                category=CATEGORY.get(metric, "COMBAT"),
                drop_weight=1.0,
                required_capabilities=CAPS[metric],
            )
        )
    return rows


class ContractsV2GeneratorTests(unittest.TestCase):
    def test_same_seed_is_deterministic(self):
        first = generate_contracts_v2(atoms("STANDARD"), "same-seed")
        second = generate_contracts_v2(atoms("STANDARD"), "same-seed")
        self.assertEqual([x.fingerprint for x in first], [x.fingerprint for x in second])
        self.assertEqual(
            [[c.payload() for c in x.conditions] for x in first],
            [[c.payload() for c in x.conditions] for x in second],
        )

    def test_boards_have_unique_contracts_and_valid_bounds(self):
        for mode in TARGET_RULES:
            board = generate_contracts_v2(atoms(mode), f"bounds-{mode}")
            self.assertEqual(len(board), 6)
            self.assertEqual(len({x.fingerprint for x in board}), 6)
            self.assertEqual(len({x.title for x in board}), 6)
            self.assertLessEqual(sum(x.difficulty == "EXTREME" for x in board), 1)
            self.assertTrue(all(x.generator_meta["version"] == GENERATOR_VERSION for x in board))
            for contract in board:
                self.assertGreaterEqual(len(contract.conditions), 1)
                self.assertLessEqual(len(contract.conditions), 3)
                for condition in contract.conditions:
                    self.assertIn(condition.metric, TARGET_RULES[mode])
                    all_bands = TARGET_RULES[mode][condition.metric]
                    minimum = min(row[0] for row in all_bands)
                    maximum = max(row[1] for row in all_bands)
                    self.assertGreaterEqual(condition.target, minimum)
                    self.assertLessEqual(condition.target, maximum)

    def test_adaptive_profile_changes_safe_targets_and_explains_them(self):
        profile = {
            "version": "adaptive-profile-1",
            "mode": "STANDARD",
            "sample_size": 12,
            "confidence": "MEDIUM",
            "metrics": {
                metric: {
                    "n": 12,
                    "median": 8 if metric == "player.kills" else 10,
                    "p25": 4 if metric == "player.deaths" else 8,
                    "p60": 10 if metric == "player.kills" else 12,
                    "p75": 12 if metric == "player.kills" else 14,
                    "best": 16,
                }
                for metric in TARGET_RULES["STANDARD"]
                if metric != "match.win"
            },
        }
        first = generate_contracts_v2(atoms("STANDARD"), "adaptive-seed", adaptive_profile=profile)
        second = generate_contracts_v2(atoms("STANDARD"), "adaptive-seed", adaptive_profile=profile)
        self.assertEqual([x.fingerprint for x in first], [x.fingerprint for x in second])
        adaptive = [item.generator_meta["adaptive"] for item in first]
        self.assertTrue(any(item["enabled"] for item in adaptive))
        self.assertTrue(any(item["kind"] == "WILDCARD" for item in adaptive))
        self.assertTrue(any(item["basis"] for item in adaptive if item["enabled"]))
        self.assertTrue(all(item["sample_size"] == 12 for item in adaptive))

    def test_cold_start_keeps_random_contracts_without_fake_personalization(self):
        profile = {
            "version": "adaptive-profile-1", "mode": "STANDARD",
            "sample_size": 4, "confidence": "COLD_START", "metrics": {},
        }
        board = generate_contracts_v2(atoms("STANDARD"), "cold-start", adaptive_profile=profile)
        self.assertTrue(all(not item.generator_meta["adaptive"]["enabled"] for item in board))
        self.assertTrue(all(item.generator_meta["adaptive"]["kind"] == "COLD_START" for item in board))

    def test_generator_produces_composites_over_batch(self):
        composites = 0
        fingerprints = set()
        signatures = set()
        for index in range(40):
            board = generate_contracts_v2(
                atoms("RANKED"),
                f"batch-{index}",
                recent_fingerprints=fingerprints,
                recent_metric_signatures=signatures,
            )
            composites += sum(len(x.conditions) > 1 for x in board)
            for contract in board:
                self.assertNotIn(contract.fingerprint, fingerprints)
                fingerprints.add(contract.fingerprint)
                signatures.add(contract.generator_meta["metric_signature"])
        self.assertGreater(composites, 30)
        self.assertGreater(len(fingerprints), 220)


class ContractsV2MigrationTests(unittest.TestCase):
    def test_only_offered_legacy_boards_are_upgraded(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            user = User(steam_id64=76561198000000001, account_id=12345, display_name="Generator Tester")
            db.add(user)
            db.flush()
            mission_rows = []
            for index, atom in enumerate(atoms("STANDARD")):
                row = MissionDefinition(
                    id=atom.id, key=atom.key, version=2, title=atom.key, description=atom.key,
                    metric=atom.metric, operator="lte" if atom.metric == "player.deaths" else ("eq" if atom.metric == "match.win" else "gte"),
                    target=1, reward_xp=100, difficulty="FOCUSED", rarity="COMMON",
                    drop_weight=1.0, drop_chance_pct=25.0, category=atom.category,
                    required_capabilities=atom.required_capabilities, game_match_mode="STANDARD",
                    ranked_policy="STANDARD_ONLY", status="PUBLISHED", safety_classification="WIN_ALIGNED",
                )
                mission_rows.append(row)
                db.add(row)
            db.flush()
            expires = datetime.now(timezone.utc) + timedelta(hours=12)
            offered = ContractBoard(user_id=user.id, board_date=date.today(), seed="legacy-offered", status="OFFERED", game_match_mode="STANDARD", generator_version="legacy-v3", expires_at=expires)
            locked = ContractBoard(user_id=user.id, board_date=date.today() - timedelta(days=1), seed="legacy-locked", status="LOCKED", game_match_mode="STANDARD", generator_version="legacy-v3", expires_at=expires)
            db.add_all([offered, locked])
            db.flush()
            db.add(BoardOption(board_id=offered.id, mission_definition_id=mission_rows[0].id, rendered_title="Legacy", rendered_description="Legacy", metric=mission_rows[0].metric, operator="gte", target=5, reward_xp=80, required_capabilities=mission_rows[0].required_capabilities, required_game_match_mode="STANDARD"))
            db.commit()

            upgraded = upgrade_offered_boards_to_contracts_v2(db)
            db.commit()
            self.assertEqual(upgraded, 1)
            db.refresh(offered); db.refresh(locked)
            self.assertEqual(offered.generator_version, GENERATOR_VERSION)
            self.assertEqual(locked.generator_version, "legacy-v3")
            options = list(db.scalars(select(BoardOption).where(BoardOption.board_id == offered.id)).all())
            self.assertEqual(len(options), 6)
            self.assertTrue(all(option.fingerprint for option in options))
            self.assertTrue(all(option.conditions for option in options))



class ContractsV2EvaluatorTests(unittest.TestCase):
    def option(self, *, capabilities=None):
        return SimpleNamespace(
            conditions=[
                {"metric": "player.kills", "operator": "gte", "target": 8, "capabilities": ["summary.kills"]},
                {"metric": "player.deaths", "operator": "lte", "target": 5, "capabilities": ["summary.deaths"]},
            ],
            metric="player.kills",
            operator="gte",
            target=8,
            required_capabilities=capabilities or ["summary.kills", "summary.deaths"],
            required_game_match_mode="RANKED",
        )

    def match(self, *, capabilities=None):
        return SimpleNamespace(
            is_final=True,
            duration_s=1800,
            game_match_mode="RANKED",
            scoring_status="SCORED",
            capabilities=capabilities or ["summary.kills", "summary.deaths"],
        )

    def participant(self, kills=8, deaths=5):
        return SimpleNamespace(
            won=True,
            kills=kills,
            deaths=deaths,
            assists=10,
            net_worth=30000,
            hero_damage=30000,
            object_damage=1000,
            healing=2000,
        )

    def test_composite_requires_all_conditions(self):
        ok = _result(self.option(), self.match(), self.participant(9, 4))
        self.assertEqual(ok.status, "COMPLETED")
        self.assertEqual(ok.current, 2.0)
        self.assertEqual(ok.target, 2.0)
        self.assertTrue(all(row["passed"] for row in ok.facts))

        failed = _result(self.option(), self.match(), self.participant(9, 8))
        self.assertEqual(failed.status, "FAILED")
        self.assertEqual(failed.current, 1.0)
        self.assertEqual(failed.target, 2.0)
        self.assertEqual([row["passed"] for row in failed.facts], [True, False])

    def test_missing_capability_is_unverifiable(self):
        result = _result(
            self.option(),
            self.match(capabilities=["summary.kills"]),
            self.participant(),
        )
        self.assertEqual(result.status, "UNVERIFIABLE")
        self.assertIn("summary.deaths", result.explanation)

    def test_street_brawl_scoreboard_healing_is_an_explicit_metric(self):
        option = SimpleNamespace(
            conditions=[{
                "metric": "player.scoreboard_healing", "operator": "gte", "target": 6000,
                "capabilities": ["gep.scoreboard_healing"],
            }],
            metric="player.scoreboard_healing", operator="gte", target=6000,
            required_capabilities=["gep.scoreboard_healing"],
            required_game_match_mode="STREET_BRAWL",
        )
        match = SimpleNamespace(
            is_final=True, duration_s=None, provider="gep_fallback",
            raw_summary={"companion_finalization": {"trusted": True, "signal": "match_end"}},
            game_match_mode="STREET_BRAWL", scoring_status="SCORED",
            capabilities=["gep.scoreboard_healing"],
        )
        participant = self.participant()
        participant.healing = 8567
        result = _result(option, match, participant)
        self.assertEqual(result.status, "COMPLETED")
        self.assertEqual(result.current, 8567.0)
        self.assertIn("итоговой таблице", result.explanation)

    def test_legacy_brawl_healing_alias_is_scoped_to_gep_fallback(self):
        option = SimpleNamespace(
            conditions=[{
                "metric": "player.healing", "operator": "gte", "target": 6000,
                "capabilities": ["summary.healing"],
            }],
            metric="player.healing", operator="gte", target=6000,
            required_capabilities=["summary.healing"],
            required_game_match_mode="STREET_BRAWL",
        )
        finality = {"companion_finalization": {"trusted": True, "signal": "postgame"}}
        participant = self.participant()
        participant.healing = 8567
        gep_match = SimpleNamespace(
            is_final=True, duration_s=None, provider="gep_fallback", raw_summary=finality,
            game_match_mode="STREET_BRAWL", scoring_status="SCORED",
            capabilities=["gep.scoreboard_healing"],
        )
        resolved = _result(option, gep_match, participant)
        self.assertEqual(resolved.status, "COMPLETED")
        self.assertEqual(resolved.facts[0]["semantic_compatibility"], "street_brawl_legacy_healing")

        standard_match = SimpleNamespace(
            is_final=True, duration_s=1800, provider="gep_fallback", raw_summary=finality,
            game_match_mode="STANDARD", scoring_status="SCORED",
            capabilities=["gep.scoreboard_healing"],
        )
        standard_option = SimpleNamespace(**{**option.__dict__, "required_game_match_mode": "STANDARD"})
        unresolved = _result(standard_option, standard_match, participant)
        self.assertEqual(unresolved.status, "UNVERIFIABLE")
        self.assertIn("summary.healing", unresolved.explanation)


if __name__ == "__main__":
    unittest.main()
