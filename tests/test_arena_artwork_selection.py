"""Arena starters and portraits reuse approved, illustrated archive designs."""
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select

from app.battle_models import BattleArtwork, BattleDefinitionVersion
from app.models import ArchiveCard
from app.services import archive, card_battle
from app.services.battle_catalog import identity, seed_battle_catalogue
from app.services.battle_definitions import definitions_for_cards
from test_card_battle_service import db  # noqa: F401


PREFERRED = ("abrams", "bebop", "dynamo", "haze", "ivy", "seven")
ALTERNATE = ("apollo", "baba", "calico", "celeste", "drifter", "grey-talon")


def artwork(db, hero_key, rank="F", **changes):
    image = f"Existing artwork: {hero_key}:{rank}:{uuid4()}".encode()
    values = dict(hero=hero_key, rank=rank, title=f"Original {hero_key}", artist="Existing artist",
                  image_data=image, image_digest=sha256(image).hexdigest(), status="PUBLISHED")
    values.update(changes)
    card = ArchiveCard(**values)
    db.add(card)
    db.flush()
    return card


def selection(db, **kwargs):
    from app.services.arena_artwork import starter_cards
    return starter_cards(db, **kwargs)


def decorated(db, rules=None):
    from app.services.arena_artwork import decorate_rules
    return decorate_rules(db, rules if rules is not None else card_battle.RULES)


def source_snapshot(db):
    return list(db.execute(select(ArchiveCard.__table__).order_by(ArchiveCard.id)).mappings())


def test_catalogue_supports_every_actual_archive_hero_without_aliases():
    assert set(card_battle.HEROES) == set(archive.HEROES)
    assert len(card_battle.HEROES) == 44
    for key, name in archive.HEROES.items():
        assert card_battle.HEROES[key]["key"] == key
        assert card_battle.HEROES[key]["name"] == name
        assert card_battle.HEROES[key]["role"]
        assert card_battle.HEROES[key]["hp"] > 0
        assert card_battle.HEROES[key]["attack"] > 0
        assert card_battle.HEROES[key]["ability"]["description"]["ru"]
        assert card_battle.HEROES[key]["ability"]["description"]["en"]
    assert "unknown-hero" not in card_battle.HEROES


def test_original_twelve_hero_stats_and_numeric_effects_stay_frozen():
    expected = {
        "abrams": ("TANK", 650, 70, 15, "SELF", {"shield": 100}),
        "bebop": ("FIGHTER", 560, 75, 10, "ENEMY", {"damage": 110}),
        "dynamo": ("TANK", 610, 65, 12, "NONE", {"shield": 70}),
        "haze": ("SHOOTER", 400, 100, 5, "FIRST", {"damage": 110}),
        "ivy": ("SUPPORT", 440, 65, 5, "OTHER_ALLY", {"heal": 100}),
        "kelvin": ("SUPPORT", 520, 60, 10, "ALLY", {"heal": 60, "shield": 50}),
        "seven": ("MAGE", 420, 80, 5, "ALL_ENEMIES", {"damage": 70}),
        "infernus": ("FIGHTER", 460, 85, 10, "FIRST", {"damage": 70, "burn_damage": 20, "burn_rounds": 2}),
        "wraith": ("ASSASSIN", 410, 110, 5, "ENEMY", {"damage": 100}),
        "mcginnis": ("ENGINEER", 500, 70, 12, "SELF", {"attack_bonus": 40, "duration": 2}),
        "lady-geist": ("MAGE", 450, 90, 5, "ENEMY", {"damage": 130, "hp_cost": 40}),
        "venator": ("HUNTER", 470, 95, 8, "ENEMY", {"damage": 100, "execute_damage": 130, "threshold_percent": 35}),
    }
    for key, (role, hp, attack, armor, target, effects) in expected.items():
        hero = card_battle.HEROES[key]
        assert (hero["role"], hero["hp"], hero["attack"], hero["armor"]) == (role, hp, attack, armor)
        ability = hero["ability"]
        assert (ability["cost"], ability["cooldown"], ability["target"]) == (2, 3, target)
        assert {key: value for key, value in ability.items()
                if key not in {"name", "description", "cost", "cooldown", "target"}} == effects


@pytest.mark.parametrize("key", sorted(set(archive.HEROES) - {
    "abrams", "bebop", "dynamo", "haze", "ivy", "kelvin", "seven", "infernus",
    "wraith", "mcginnis", "lady-geist", "venator",
}))
def test_new_roster_presets_remain_legal_for_the_frozen_legacy_resolver(key):
    def squad(prefix):
        return [{"id": f"{prefix}{index}", "hero_key": hero, "rank": "F", "line": index // 2,
                 "position": "FRONT" if index % 2 == 0 else "BACK"}
                for index, hero in enumerate(PREFERRED)]

    first, second = squad("a"), squad("b")
    first[0]["hero_key"] = key
    state = card_battle.initial_state(first, second)
    plan = [{"type": "HERO_ABILITY", "actor_id": "a0", "target_id": "b1"}]
    card_battle.validate_plan(state, "A", plan)
    _, events = card_battle.resolve_round(state, plan, [])
    assert any(value["type"] == "DAMAGE" and value.get("phase") == "ACTIVE"
               and value.get("source_id") == "a0" and value.get("target_id") == "b1"
               and value.get("amount", 0) > 0 for value in events)


def test_expanded_seed_is_insert_only_and_never_creates_archive_art(db):
    historic = BattleDefinitionVersion(id=identity("definition", "abrams"), key="abrams", category="HERO",
        version=1, approved=False, rules={"key": "abrams", "hp": 777, "historic": True})
    db.add(historic)
    db.flush()
    before = deepcopy(historic.rules)
    seed_battle_catalogue(db)
    seed_battle_catalogue(db)
    assert db.scalar(select(func.count()).select_from(BattleDefinitionVersion)) == 46
    assert db.scalar(select(func.count()).select_from(ArchiveCard)) == 0
    db.expire_all()
    assert historic.rules == before
    assert not historic.approved
    cards = [artwork(db, key, "E") for key in ALTERNATE]
    assert {definition.key for definition in definitions_for_cards(db, cards).values()} == set(ALTERNATE)


def test_missing_preferred_starter_uses_existing_alternate_hero_ranks(db):
    seed_battle_catalogue(db)
    cards = [artwork(db, key, rank) for key, rank in zip(ALTERNATE, ("E", "D", "C", "B", "F", "E"))]
    before = source_snapshot(db)
    chosen = selection(db, user_id="collector-a", lock=True)
    assert set(chosen) == set(ALTERNATE)
    assert {card.id for card in chosen.values()} == {card.id for card in cards}
    assert sum(card_battle.RANKS[card.rank]["cost"] for card in chosen.values()) == 11
    assert source_snapshot(db) == before


def test_complete_preferred_f_starter_keeps_regression_order(db):
    seed_battle_catalogue(db)
    preferred = [artwork(db, key) for key in PREFERRED]
    for key in ALTERNATE:
        artwork(db, key)
    chosen = selection(db, user_id="collector-b")
    assert tuple(chosen) == PREFERRED
    assert [card.id for card in chosen.values()] == [card.id for card in preferred]


def test_starter_minimizes_cost_across_distinct_heroes_and_designs(db):
    seed_battle_catalogue(db)
    cheap = [artwork(db, key, "E") for key in ALTERNATE]
    for key in ALTERNATE:
        artwork(db, key, "A")
    artwork(db, "lash", "SSS")
    artwork(db, "mo-krill", "S")
    chosen = selection(db, user_id="collector-c")
    assert len(chosen) == 6
    assert set(chosen) == set(ALTERNATE)
    assert {card.id for card in chosen.values()} == {card.id for card in cheap}
    assert sum(card_battle.RANKS[card.rank]["cost"] for card in chosen.values()) == 6


def test_equal_cost_heroes_and_existing_designs_vary_stably_per_user(db):
    seed_battle_catalogue(db)
    for key in (*ALTERNATE, "lash", "mo-krill"):
        for _ in range(4):
            artwork(db, key, "E")
    before = source_snapshot(db)
    choices = []
    for user in range(12):
        first = selection(db, user_id=f"collector-{user}")
        ids = tuple(card.id for card in first.values())
        db.expire_all()
        assert tuple(card.id for card in selection(db, user_id=f"collector-{user}").values()) == ids
        assert len(first) == 6
        assert all(card.rank == "E" for card in first.values())
        choices.append((tuple(first), ids))
    assert len({keys for keys, _ in choices}) > 1
    assert len({ids for _, ids in choices}) > 1
    assert source_snapshot(db) == before


@pytest.mark.parametrize("ranks", [("F",) * 5, ("A",) * 6, ("SSS",) * 3 + ("F",) * 3])
def test_insufficient_or_over_budget_illustrated_starters_are_unavailable(db, ranks):
    seed_battle_catalogue(db)
    for key, rank in zip(ALTERNATE, ranks):
        artwork(db, key, rank)
    before = source_snapshot(db)
    assert selection(db) == {}
    assert source_snapshot(db) == before


def test_starter_can_use_two_sss_when_six_sources_fit_budget(db):
    seed_battle_catalogue(db)
    for key, rank in zip(ALTERNATE, ("SSS", "SSS", "F", "F", "F", "F")):
        artwork(db, key, rank)
    chosen = selection(db)
    assert len(chosen) == 6
    assert sum(card_battle.RANKS[card.rank]["cost"] for card in chosen.values()) == 22
    assert sum(card.rank == "SSS" for card in chosen.values()) == 2


@pytest.mark.parametrize("changes", [
    {"status": "DRAFT"}, {"status": "ARCHIVED"}, {"status": "REMOVED"},
    {"image_data": b""}, {"image_data": None}, {"image_digest": None}, {"image_digest": ""},
    {"rank": "EX"}, {"rank": "?"}, {"hero": "unknown-hero"},
])
def test_starter_never_grants_unpublished_empty_or_unknown_art(db, changes):
    seed_battle_catalogue(db)
    for key in ALTERNATE[:-1]:
        artwork(db, key)
    artwork(db, ALTERNATE[-1], **changes)
    assert selection(db) == {}


def test_explicit_revocation_mismatch_and_historical_links_win(db):
    seed_battle_catalogue(db)
    cards = [artwork(db, key) for key in PREFERRED]
    abrams, bebop, _, _, ivy, _ = cards
    db.add(BattleArtwork(card_id=abrams.id, definition_id=identity("definition", "abrams"), approved=False))
    db.add(BattleArtwork(card_id=bebop.id, definition_id=identity("definition", "ivy"), approved=True))
    historic = BattleDefinitionVersion(key="ivy", category="HERO", version=2, approved=True,
                                      rules={"key": "ivy", "hp": 901, "historic": True})
    db.add(historic)
    db.flush()
    db.add(BattleArtwork(card_id=ivy.id, definition_id=identity("definition", "ivy"), approved=True))
    good_abrams, good_bebop = artwork(db, "abrams", "D"), artwork(db, "bebop", "E")
    db.flush()
    chosen = selection(db)
    assert len(chosen) == 6
    assert chosen["abrams"].id == good_abrams.id
    assert chosen["bebop"].id == good_bebop.id
    assert definitions_for_cards(db, [chosen["ivy"]])[ivy.id].version == 1
    assert historic.rules == {"key": "ivy", "hp": 901, "historic": True}


def test_pristine_pr50_placeholders_are_excluded_without_deleting_them(db, monkeypatch):
    from app.models import utcnow
    from app.services import arena_catalog_repair
    # The historical binary is not part of the current checkout. Supply its
    # digest through the same fingerprint data, keeping real recognition logic.
    fingerprint_id = identity("card", "abrams", "F")
    fingerprint = dict(arena_catalog_repair._FINGERPRINTS[fingerprint_id])
    image = b"historical-symbolic-release-artwork"
    fingerprint["image_digest"] = sha256(image).hexdigest()
    monkeypatch.setitem(arena_catalog_repair._FINGERPRINTS, fingerprint_id, fingerprint)
    published = utcnow()
    card = ArchiveCard(id=fingerprint_id, hero="abrams", rank="F", title=fingerprint["title"],
        image_data=image, image_digest=fingerprint["image_digest"], status="PUBLISHED",
        created_at=published, updated_at=published, published_at=published,
        **arena_catalog_repair._DEFAULTS)
    db.add(card)
    db.flush()
    seed_battle_catalogue(db)
    assert arena_catalog_repair.is_pristine_arena_card(card)
    before = source_snapshot(db)
    assert selection(db) == {}
    rules = decorated(db)
    assert not any(hero.get("image_url") for hero in rules["heroes"].values())
    assert not any(base.get("image_url") for base in rules["bases"].values())
    assert source_snapshot(db) == before
    original = [artwork(db, key, "E") for key in ALTERNATE]
    assert {card.id for card in selection(db).values()} == {card.id for card in original}


def test_decorated_rules_use_existing_same_hero_images_and_do_not_mutate_input(db):
    seed_battle_catalogue(db)
    artwork(db, "apollo", "D")
    preferred = artwork(db, "apollo", "F")
    patron = artwork(db, "HIDDEN_KING", "EX")
    db.add(BattleArtwork(card_id=patron.id, definition_id=identity("definition", "HIDDEN_KING"), approved=True))
    artwork(db, "ARCHMOTHER", "EX")  # EX must have an explicit approval.
    db.flush()
    raw = deepcopy(card_battle.RULES)
    raw["heroes"]["baba"]["image_url"] = "/api/archive/cards/unavailable-placeholder/image"
    before = deepcopy(raw)
    rules = decorated(db, raw)
    assert raw == before
    assert rules["heroes"]["apollo"]["image_url"] == f"/api/archive/cards/{preferred.id}/image?r=1"
    assert rules["heroes"]["apollo"]["card"]["id"] == preferred.id
    assert rules["heroes"]["apollo"]["card"]["hero"] == "apollo"
    assert rules["bases"]["HIDDEN_KING"]["image_url"] == f"/api/archive/cards/{patron.id}/image?r=1"
    assert rules["bases"]["HIDDEN_KING"]["card"]["id"] == patron.id
    assert not rules["bases"]["ARCHMOTHER"].get("image_url")
    assert not rules["heroes"]["baba"].get("image_url")


def test_decorated_portraits_respect_card_approval_and_hero_identity(db):
    seed_battle_catalogue(db)
    revoked = artwork(db, "apollo")
    mismatch = artwork(db, "baba")
    removed = artwork(db, "calico", status="REMOVED")
    db.add_all([
        BattleArtwork(card_id=revoked.id, definition_id=identity("definition", "apollo"), approved=False),
        BattleArtwork(card_id=mismatch.id, definition_id=identity("definition", "apollo"), approved=True),
    ])
    db.flush()
    rules = decorated(db)
    for card in (revoked, mismatch, removed):
        assert not rules["heroes"][card.hero].get("image_url")


@pytest.mark.parametrize("operation", [selection, decorated])
def test_catalogue_images_and_definitions_are_loaded_in_batches(db, operation):
    seed_battle_catalogue(db)
    for key in archive.HEROES:
        artwork(db, key, "E")
    db.expire_all()
    statements = []

    def record(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        result = operation(db)
        if operation is selection:
            assert len(result) == 6
            assert all(card.image_data for card in result.values())
        else:
            assert sum(bool(hero.get("image_url")) for hero in result["heroes"].values()) == 44
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert len(statements) == 3, "Images or approvals were loaded separately for each design"
