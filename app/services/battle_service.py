"""Server-authoritative arena commands. Callers never supply outcomes or stats."""
from copy import deepcopy
from datetime import timedelta, timezone
import hashlib
import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select

from ..battle_models import (BattleAction, BattleArtwork, BattleAssignment, BattleCommand, BattleDefinitionVersion,
    BattleItemReservation, BattleMatch, BattleRating, BattleSeason, BattleShowcase, BattleSquad)
from ..models import ArchiveCard, ArchiveItem, ArchiveOperation, PublicProfile, User, utcnow, uuid4
from . import card_battle as engine
from .archive import aware, card_payload, lock_user

MODES = {"TUTORIAL", "TRAINING", "ASSIGNED", "HARD", "TRIAL", "WEEKLY", "COPY"}
STARTER = ("abrams", "bebop", "dynamo", "haze", "ivy", "seven")
MATCH_TTL = timedelta(hours=24)


def _lock_users(db, *user_ids):
    for user_id in sorted(set(value for value in user_ids if value)):
        row = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
        if row is None: raise HTTPException(404, "Participant unavailable")


def _signature(kind, inputs):
    return hashlib.sha256(json.dumps({"kind": kind, **inputs}, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _begin(db, user_id, key, kind, inputs):
    actor = db.get(User, user_id)
    if actor is None or actor.status != "ACTIVE": raise HTTPException(403, "Account unavailable")
    try:
        key = str(UUID(str(key)))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, "UUID request key required") from None
    signature = _signature(kind, inputs)
    row = db.scalar(select(BattleCommand).where(BattleCommand.user_id == user_id, BattleCommand.request_key == key))
    if row:
        if row.signature != signature:
            raise HTTPException(409, "Request key reused with different inputs")
        return row, True
    row = BattleCommand(user_id=user_id, request_key=key, signature=signature)
    db.add(row); db.flush()
    return row, False


def _finish(db, command, result):
    command.response = deepcopy(result)
    db.commit()
    return result


def request_result(db, user_id, key):
    row = db.scalar(select(BattleCommand).where(BattleCommand.user_id == user_id, BattleCommand.request_key == str(key)))
    return {"result": deepcopy(row.response) if row else None}


def _scope(scope):
    if scope not in {"REAL", "SANDBOX"}:
        raise HTTPException(422, "Unknown economy scope")


def display_rules(db=None):
    rules = deepcopy(engine.RULES)
    if db is not None:
        from .arena_catalog_repair import is_pristine_arena_card
        from .battle_definitions import definitions_for_cards
        rows = list(db.scalars(select(ArchiveCard).where(ArchiveCard.status == "PUBLISHED",
            ArchiveCard.image_digest.is_not(None), ArchiveCard.hero.in_([*engine.HEROES, *engine.BASES]))
            .order_by((ArchiveCard.rank != "F"), ArchiveCard.id)))
        definitions = definitions_for_cards(db, rows)
        for card in rows:
            group = "bases" if card.rank == "EX" else "heroes"
            if (card.id not in definitions or card.hero not in rules[group]
                    or "image_url" in rules[group][card.hero]): continue
            if not card.image_data or is_pristine_arena_card(card): continue
            rules[group][card.hero]["image_url"] = card_payload(card)["image_url"]
    return rules


def approved_definition(db, card):
    from .battle_definitions import definitions_for_cards
    return definitions_for_cards(db, [card]).get(card.id) if card else None


def _starter_cards(db, *, lock=False):
    from .arena_catalog_repair import is_pristine_arena_card
    query = select(ArchiveCard).where(ArchiveCard.hero.in_(STARTER), ArchiveCard.rank == "F",
        ArchiveCard.status == "PUBLISHED", ArchiveCard.image_digest.is_not(None)).order_by(ArchiveCard.id)
    if lock: query = query.with_for_update(read=True)
    choices = {}
    for card in db.scalars(query):
        if card.image_data and not is_pristine_arena_card(card) and approved_definition(db, card):
            choices.setdefault(card.hero, card)
    return choices


def starter_status(db, user_id, scope):
    benefit = "battle_starter_v1" + (":sandbox" if scope == "SANDBOX" else "")
    claimed = db.scalar(select(ArchiveOperation.id).where(ArchiveOperation.user_id == user_id,
        ArchiveOperation.benefit_key == benefit)) is not None
    cards = _starter_cards(db)
    missing = [key for key in STARTER if key not in cards]
    return dict(claimed=claimed, available=not claimed and not missing, missing_heroes=missing)


def ex_access(db, user_id, card=None, scope="REAL", patron_key=None):
    from .extra_coin_rewards import confirmed_contract_count, eligible_pve_win_count
    user = db.get(User, user_id)
    key = patron_key or (card.hero if card else "HIDDEN_KING")
    approved = key in {"HIDDEN_KING", "ARCHMOTHER"} and (card is None or (
        (definition := approved_definition(db, card)) is not None and definition.category == "BASE"))
    days = max(0, (aware(utcnow()) - aware(user.created_at)).days) if user else 0
    count = confirmed_contract_count(db, user_id) if user else 0
    wins = eligible_pve_win_count(db, user_id) if user else 0
    trials = db.scalars(select(BattleMatch.snapshot).where(BattleMatch.user_id == user_id, BattleMatch.mode == "TRIAL",
        BattleMatch.scope == "REAL", BattleMatch.status == "FINISHED", BattleMatch.outcome == "WIN")).all()
    trial = any(value.get("patron_key") == key for value in trials)
    reasons = []
    if not approved:
        reasons.append("BATTLE_APPROVAL")
    if scope != "SANDBOX":
        if days < 7: reasons.append("ACCOUNT_AGE")
        if count < 20 and wins < 15: reasons.append("CONTRACTS_OR_PVE")
        if not trial: reasons.append("PATRON_TRIAL")
    return dict(eligible=not reasons, reasons=reasons, account_days=days, confirmed_contracts=count,
                eligible_pve_wins=wins, trial_completed=trial, patron_key=key)


def assert_ex_purchase(db, user_id, card, scope="REAL"):
    if not ex_access(db, user_id, card, scope)["eligible"]:
        raise HTTPException(409, "EX requirements are not met")


def squad_payload(squad, scope="REAL"):
    return dict(revision=squad.revision if squad else 0, scope=squad.scope if squad else scope,
                base_item_id=squad.base_item_id if squad else None, slots=deepcopy(squad.slots) if squad else [])


def _items_snapshot(db, user_id, scope, slots, base_item_id, *, reserve_check=True, lock_items=True):
    _scope(scope)
    ids = [str(value["item_id"]) for value in slots] + ([str(base_item_id)] if base_item_id else [])
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "Choose different owned instances")
    statement = select(ArchiveItem).where(ArchiveItem.id.in_(ids)).order_by(ArchiveItem.id)
    if lock_items: statement = statement.with_for_update()
    rows = list(db.scalars(statement))
    items = {value.id: value for value in rows}
    heroes, definitions, definition_versions, base_key, base_card = [], {}, {}, "ORDINARY", None
    for index, item_id in enumerate(ids):
        item = items.get(item_id)
        if not item or item.user_id != user_id or item.state != "OWNED" or (scope == "REAL" and item.scope != "REAL"):
            raise HTTPException(409, "Squad contains an unavailable instance; select another card")
        if reserve_check and is_item_reserved(db, item.id):
            raise HTTPException(409, "An instance is reserved by an active match")
        card = db.get(ArchiveCard, item.card_id)
        definition = approved_definition(db, card)
        if not definition:
            raise HTTPException(409, "Artwork has no matching approved battle definition")
        definitions[definition.key] = deepcopy(definition.rules)
        definition_versions[definition.key] = dict(id=definition.id, version=definition.version, category=definition.category)
        if index < len(slots):
            if definition.category != "HERO":
                raise HTTPException(422, "Choose a hero instance for each slot")
            slot = slots[index]
            heroes.append(dict(id=item.id, item_id=item.id, hero_key=definition.key, rank=card.rank,
                               line=slot["line"], position=slot["position"], card=card_payload(card),
                               definition_id=definition.id, definition_version=definition.version))
        else:
            if definition.category != "BASE":
                raise HTTPException(422, "Choose an approved EX base")
            base_key = definition.key
            base_card = card_payload(card)
    try:
        cost = engine.validate_squad(heroes, base_key)
    except (ValueError, KeyError) as error:
        raise HTTPException(422, str(error)) from None
    return dict(heroes=heroes, base_key=base_key, base_card=base_card, item_ids=ids, budget=cost,
                definitions=definitions, definition_versions=definition_versions)


def _saved_snapshot(db, user_id, scope, revision, base_item_id):
    squad = db.scalar(select(BattleSquad).where(BattleSquad.user_id == user_id, BattleSquad.scope == scope))
    if not squad or squad.revision != revision:
        raise HTTPException(409, "Squad changed; reload before starting")
    return _items_snapshot(db, user_id, scope, squad.slots, base_item_id)


def save_squad(db, user_id, expected_revision, scope, base_item_id, slots):
    lock_user(db, user_id)
    _items_snapshot(db, user_id, scope, slots, base_item_id, reserve_check=False)
    row = db.scalar(select(BattleSquad).where(BattleSquad.user_id == user_id, BattleSquad.scope == scope))
    if (row.revision if row else 0) != expected_revision:
        raise HTTPException(409, "Squad changed; reload")
    if row is None:
        row = BattleSquad(user_id=user_id, scope=scope, revision=0); db.add(row)
    row.revision += 1; row.slots = deepcopy(slots); row.base_item_id = base_item_id
    db.commit()
    return {"squad": squad_payload(row)}


def invalidate_item_squads(db, user_id, item_id):
    for model in (BattleSquad, BattleShowcase):
        for row in db.scalars(select(model).where(model.user_id == user_id)):
            if row.base_item_id == item_id or any(value["item_id"] == item_id for value in row.slots):
                row.slots = [value for value in row.slots if value["item_id"] != item_id]
                if row.base_item_id == item_id: row.base_item_id = None
                row.revision += 1
                if isinstance(row, BattleShowcase): row.is_public = False


def claim_starter(db, user_id, request_key, scope="REAL"):
    from .archive_packs import begin, finish, issue
    _lock_users(db, user_id); _scope(scope)
    command, replay = _begin(db, user_id, request_key, "starter", {"scope": scope})
    if replay: return deepcopy(command.response)
    benefit = "battle_starter_v1" + (":sandbox" if scope == "SANDBOX" else "")
    old = db.scalar(select(ArchiveOperation).where(ArchiveOperation.user_id == user_id, ArchiveOperation.benefit_key == benefit))
    if old:
        raise HTTPException(409, "Arena starter already claimed")
    choices = _starter_cards(db, lock=True)
    if any(key not in choices for key in STARTER):
        raise HTTPException(409, "В каталоге нет полного стартового состава F. Используйте свою коллекцию / Original starter artwork is incomplete; use your collection")
    cards = [choices[key] for key in STARTER]
    operation, _ = begin(db, user_id, "BATTLE_STARTER", request_key, {}, scope=scope)
    operation.benefit_key = benefit
    items = issue(db, operation, cards)
    slots = [{"item_id": item["id"], "line": index // 2, "position": "FRONT" if index % 2 == 0 else "BACK"}
             for index, item in enumerate(items)]
    squad = db.scalar(select(BattleSquad).where(BattleSquad.user_id == user_id, BattleSquad.scope == scope))
    if not squad:
        squad = BattleSquad(user_id=user_id, scope=scope, revision=1, slots=slots); db.add(squad)
    # Build the immutable receipt before the single commit (archive.finish commits).
    receipt = {"id": operation.id, "kind": "BATTLE_STARTER", "scope": scope, "delta": 0, "items": items}
    response = {"squad": squad_payload(squad), "receipt": receipt}
    operation.result = receipt; command.response = deepcopy(response)
    db.commit()
    return response


def is_item_reserved(db, item_id):
    return db.scalar(select(BattleItemReservation.item_id).join(BattleMatch,
        BattleMatch.id == BattleItemReservation.match_id).where(BattleItemReservation.item_id == item_id,
        BattleMatch.status == "ACTIVE")) is not None


def _active(db, user_id):
    return list(db.scalars(select(BattleMatch).where(or_(BattleMatch.user_id == user_id,
        BattleMatch.opponent_user_id == user_id), BattleMatch.status == "ACTIVE")))


def _loan(keys=None, rank="F", prefix="bot"):
    return [dict(id=f"{prefix}:{index}", hero_key=key, rank=rank, line=index // 2,
                 position="FRONT" if index % 2 == 0 else "BACK") for index, key in enumerate(keys or STARTER)]


def _assignment(db, user_id, scope, mode, assignment_id=None):
    day = utcnow().astimezone(timezone.utc).date()
    rows = list(db.scalars(select(BattleAssignment).where(BattleAssignment.user_id == user_id,
        BattleAssignment.period_day == day, BattleAssignment.scope == scope).order_by(BattleAssignment.slot)))
    if assignment_id:
        row = next((row for row in rows if row.id == assignment_id and row.status == "OPEN"), None)
        if row is None: raise HTTPException(409, "Assignment is no longer available")
        return row
    row = next((row for row in rows if row.status == "OPEN"), None)
    if row: return row
    if len(rows) >= 3: raise HTTPException(409, "Three daily assigned wins completed; use training")
    slot = len(rows) + 1
    heroes = list(engine.HEROES)
    offset = (day.toordinal() + slot * 3) % len(heroes)
    keys = (heroes + heroes)[offset:offset + 6]
    row = BattleAssignment(user_id=user_id, period_day=day, scope=scope, slot=slot, mode="ASSIGNED" if mode == "WEEKLY" else mode,
        opponent={"heroes": _loan(keys, "C" if mode == "HARD" else "F", f"assigned:{slot}"),
                  "base_key": "ORDINARY", "difficulty": mode, "archetype": ("PRESSURE", "FORTRESS", "SUPPORT")[(slot - 1) % 3],
                  "title": {"ru": f"Назначенный отряд {slot}", "en": f"Assigned squad {slot}"}})
    if mode == "WEEKLY":
        row.opponent = {"heroes": _loan(list(engine.HEROES)[-6:], "B", "weekly"), "base_key": "ORDINARY",
                        "difficulty": "HARD", "encounter_mode": "WEEKLY", "week": (day - timedelta(days=day.weekday())).isoformat(),
                        "title": {"ru": "Недельное испытание", "en": "Weekly challenge"}}
    db.add(row); db.flush()
    return row


def _new_match(db, user_id, opponent_id, mode, scope, first, second, *, assignment=None, season_id=None, patron_key=None):
    from .battle_catalog import identity
    first, second = deepcopy(first), deepcopy(second)
    for snapshot in (first, second):
        versions = snapshot.setdefault("definition_versions", {})
        for key in [hero["hero_key"] for hero in snapshot["heroes"]] + ([snapshot["base_key"]] if snapshot["base_key"] != "ORDINARY" else []):
            versions.setdefault(key, dict(id=identity("definition", key), version=1, category="HERO" if key in engine.HEROES else "BASE"))
    rules = display_rules(db)
    # Each physical artwork keeps its own approved version, including mirror heroes.
    state = engine.initial_state(first["heroes"], second["heroes"], base_a=first["base_key"], base_b=second["base_key"], rules=rules,
                                 definitions_a=first.get("definitions"), definitions_b=second.get("definitions"))
    for side, snapshot in zip(state["sides"], (first, second)):
        if snapshot.get("base_card"):
            side["base"]["card"] = deepcopy(snapshot["base_card"])
            side["base"]["image_url"] = snapshot["base_card"]["image_url"]
        version = snapshot["definition_versions"].get(snapshot["base_key"])
        if version:
            side["base"]["definition_id"] = version["id"]
            side["base"]["definition_version"] = version["version"]
    match = BattleMatch(user_id=user_id, opponent_user_id=opponent_id, mode=mode, scope=scope,
        state=state, snapshot={"A": first, "B": second, "patron_key": patron_key},
        assignment_id=assignment.id if assignment else None, season_id=season_id,
        reward_eligible=bool(scope == "REAL" and assignment), bot_plan=[])
    db.add(match); db.flush()
    for item_id in first.get("item_ids", []) + second.get("item_ids", []):
        if is_item_reserved(db, item_id): raise HTTPException(409, "An instance is reserved")
        db.add(BattleItemReservation(item_id=item_id, match_id=match.id))
    if not opponent_id:
        match.bot_plan = engine.bot_plan(state, difficulty="TUTORIAL" if mode == "TUTORIAL" else ("HARD" if mode in {"HARD", "TRIAL", "WEEKLY"} else "NORMAL"))
    db.flush()
    return match


def start_match(db, user_id, body):
    _lock_users(db, user_id)
    command, replay = _begin(db, user_id, body["request_key"], "match", {key: value for key, value in body.items() if key != "request_key"})
    if replay: return deepcopy(command.response)
    scope, mode = body.get("scope", "REAL"), body["mode"]
    _scope(scope)
    if mode not in MODES: raise HTTPException(422, "Unknown battle mode")
    cleanup_expired(db, user_id, commit=False, bots_only=True)
    if _active(db, user_id): raise HTTPException(409, "Finish or surrender the active match first")
    first = _saved_snapshot(db, user_id, scope, body["squad_revision"], body.get("base_item_id"))
    assignment, patron_key = None, body.get("patron_key")
    second = dict(heroes=_loan(prefix="bot"), base_key="ORDINARY", item_ids=[])
    if mode in {"ASSIGNED", "HARD", "WEEKLY"}:
        assignment = _assignment(db, user_id, scope, mode, body.get("assignment_id"))
        mode = assignment.opponent.get("encounter_mode", assignment.mode)
        second = {**deepcopy(assignment.opponent), "item_ids": []}
    if mode == "TRIAL":
        if patron_key not in {"HIDDEN_KING", "ARCHMOTHER"}: raise HTTPException(422, "Choose a patron")
        first["base_key"] = patron_key
        first["base_card"] = None
        first["definitions"] = {key: value for key, value in first["definitions"].items() if key in engine.HEROES}
        first["definition_versions"] = {key: value for key, value in first["definition_versions"].items() if key in engine.HEROES}
        # The borrowed base replaces the selected owned base; only heroes remain reserved.
        first["item_ids"] = [hero["item_id"] for hero in first["heroes"]]
        try: first["budget"] = engine.validate_squad(first["heroes"], patron_key)
        except ValueError as error: raise HTTPException(422, str(error)) from None
        second = dict(heroes=_loan(("abrams", "mcginnis", "dynamo", "seven", "kelvin", "venator"), "D", "trial"), base_key="ORDINARY", item_ids=[])
    elif mode == "WEEKLY":
        today = utcnow().date()
        week = (today - timedelta(days=today.weekday())).toordinal() // 7
        keys = list(engine.HEROES); offset = week % 6
        # High ranks remain within the normal budget: SSS + S + C + D + E + F.
        heroes = _loan(keys[offset:offset + 6], prefix="loan")
        for hero, rank in zip(heroes, ("SSS", "S", "C", "D", "E", "F")): hero["rank"] = rank
        first = dict(heroes=heroes, base_key="ORDINARY", item_ids=[], budget=24)
    elif mode == "COPY":
        target_id = body.get("copy_user_id")
        second = public_copy_snapshot(db, target_id)
        if second is None: raise HTTPException(404, "Public squad unavailable")
        second["item_ids"] = []
        for index, hero in enumerate(second["heroes"]):
            hero["id"] = f"copy:{index}"; hero.pop("item_id", None)
    match = _new_match(db, user_id, None, mode, scope, first, second, assignment=assignment, patron_key=patron_key)
    return _finish(db, command, match_payload(db, match, user_id))


def _owned_match(db, user_id, match_id, *, lock=False):
    query = select(BattleMatch).where(BattleMatch.id == match_id, or_(BattleMatch.user_id == user_id, BattleMatch.opponent_user_id == user_id))
    if lock: query = query.with_for_update().execution_options(populate_existing=True)
    match = db.scalar(query)
    if match is None: raise HTTPException(404, "Match not found")
    return match


def _image_card_id(image_url):
    prefix = "/api/archive/cards/"
    if not isinstance(image_url, str) or not image_url.startswith(prefix): return None
    identifier, separator, rest = image_url[len(prefix):].partition("/image")
    if not separator or (rest and not rest.startswith("?")): return None
    try: return str(UUID(identifier))
    except ValueError: return None


def match_card(db, user_id, match_id, card_id):
    match = _owned_match(db, user_id, match_id)
    permitted = set()
    for side in match.state.get("sides", []):
        for unit in [*side.get("heroes", []), side.get("base", {})]:
            if unit.get("card"): permitted.add(unit["card"]["id"])
            image_id = _image_card_id(unit.get("image_url"))
            if image_id: permitted.add(image_id)
    for side in ("A", "B"):
        base = match.snapshot.get(side, {}).get("base_card")
        if base: permitted.add(base["id"])
    card = db.get(ArchiveCard, card_id) if card_id in permitted else None
    if not card or card.status == "REMOVED" or not card.image_data:
        raise HTTPException(404, "Image not found")
    return card


def match_payload(db, match, user_id):
    side = "A" if match.user_id == user_id else "B"
    pending = set(db.scalars(select(BattleAction.user_id).where(BattleAction.match_id == match.id, BattleAction.round == match.round))) if match.status == "ACTIVE" else set()
    reward = match.reward
    if match.scope == "REAL" and match.status == "FINISHED":
        from .extra_coin_rewards import battle_receipt
        reward = battle_receipt(db, match.id, user_id)
    state = deepcopy(match.state)
    # Participants can see frozen opponent art without making it public.
    for state_side, side_key in zip(state.get("sides", []), ("A", "B")):
        base = match.snapshot.get(side_key, {}).get("base_card")
        if base:
            state_side["base"]["card"] = deepcopy(base)
            state_side["base"]["image_url"] = base.get("image_url")
        for unit in [*state_side.get("heroes", []), state_side.get("base", {})]:
            card = unit.get("card")
            card_id = card["id"] if card and card.get("image_url") else _image_card_id(unit.get("image_url"))
            if card_id:
                url = f"/api/arena/matches/{match.id}/cards/{card_id}/image"
                unit["image_url"] = url
                if card and card.get("image_url"): card["image_url"] = url
    # Full squads are revealed only after both room/queue confirmations. Never expose pending actions or bot plan.
    return {"match": dict(id=match.id, mode=match.mode, scope=match.scope, status=match.status,
        expired=bool(match.status == "ACTIVE" and aware(match.updated_at) < utcnow() - MATCH_TTL),
        round=match.round, revision=match.revision, state=state, player_side=side,
        last_events=deepcopy(match.last_events), submitted=user_id in pending,
        opponent_submitted=any(value != user_id for value in pending), result=deepcopy(match.result), reward=reward)}


def get_match(db, user_id, match_id):
    return match_payload(db, _owned_match(db, user_id, match_id), user_id)


def _complete(db, match, result):
    match.status = "FINISHED"
    match.result = deepcopy(result)
    match.finished_at = utcnow()
    match.updated_at = match.finished_at
    match.state = {**match.state, "status": "FINISHED", "result": deepcopy(result)}
    winner = result.get("winner_side")
    match.outcome = "DRAW" if winner is None else ("WIN" if winner == "A" else "LOSS")
    match.winner_user_id = match.user_id if winner == "A" else (match.opponent_user_id if winner == "B" else None)
    db.execute(delete(BattleItemReservation).where(BattleItemReservation.match_id == match.id))
    if match.assignment_id and match.outcome == "WIN" and result["reason"] not in {"SURRENDER", "EXPIRED"}:
        assignment = db.get(BattleAssignment, match.assignment_id)
        if assignment.status == "OPEN" and assignment.period_day == aware(match.finished_at).date():
            assignment.status = "COMPLETED"; assignment.completed_at = match.finished_at; assignment.match_id = match.id
        else: match.reward_eligible = False
    elif match.assignment_id: match.reward_eligible = False
    if match.mode == "RANKED":
        from .battle_social import settle_rating
        settle_rating(db, match)
    db.flush()
    from .extra_coin_rewards import settle_battle
    match.reward = settle_battle(db, match)


def submit_plan(db, user_id, match_id, request_key, expected_revision, actions):
    raw = _owned_match(db, user_id, match_id)
    _lock_users(db, raw.user_id, raw.opponent_user_id)
    match = _owned_match(db, user_id, match_id, lock=True)
    command, replay = _begin(db, user_id, request_key, "plan", {"match_id": match_id, "revision": expected_revision, "actions": actions})
    if replay: return deepcopy(command.response)
    if match.status != "ACTIVE" or match.revision != expected_revision:
        raise HTTPException(409, "Round changed; reload")
    if aware(match.updated_at) < utcnow() - MATCH_TTL:
        raise HTTPException(409, "Match expired; cancel it to release instances")
    side = "A" if match.user_id == user_id else "B"
    try: engine.validate_plan(match.state, side, actions)
    except (ValueError, KeyError, TypeError) as error: raise HTTPException(422, str(error)) from None
    if db.scalar(select(BattleAction.id).where(BattleAction.match_id == match_id, BattleAction.round == match.round, BattleAction.user_id == user_id)):
        raise HTTPException(409, "A sealed plan is already submitted for this round")
    action = BattleAction(match_id=match_id, user_id=user_id, request_key=str(request_key), round=match.round,
        signature=command.signature, actions=deepcopy(actions))
    db.add(action); db.flush()
    pending = list(db.scalars(select(BattleAction).where(BattleAction.match_id == match_id, BattleAction.round == match.round)))
    if not match.opponent_user_id or len(pending) == 2:
        plans = {value.user_id: value.actions for value in pending}
        state, events = engine.resolve_round(match.state, plans[match.user_id], plans[match.opponent_user_id] if match.opponent_user_id else match.bot_plan)
        match.state = state
        match.round = state["round"]
        match.revision += 1
        match.last_events = events
        if state["status"] == "FINISHED": _complete(db, match, state["result"])
        elif not match.opponent_user_id:
            match.bot_plan = engine.bot_plan(state, difficulty="TUTORIAL" if match.mode == "TUTORIAL" else ("HARD" if match.mode in {"HARD", "TRIAL", "WEEKLY"} else "NORMAL"))
    match.updated_at = utcnow()
    result = match_payload(db, match, user_id); action.response = deepcopy(result)
    return _finish(db, command, result)


def surrender(db, user_id, match_id, request_key, expected_revision):
    raw = _owned_match(db, user_id, match_id); _lock_users(db, raw.user_id, raw.opponent_user_id)
    match = _owned_match(db, user_id, match_id, lock=True)
    command, replay = _begin(db, user_id, request_key, "surrender", {"match_id": match_id, "revision": expected_revision})
    if replay: return deepcopy(command.response)
    if match.status != "ACTIVE" or match.revision != expected_revision: raise HTTPException(409, "Round changed; reload")
    side = "B" if match.user_id == user_id else "A"
    expired = aware(match.updated_at) < utcnow() - MATCH_TTL
    _complete(db, match, {"winner_side": None if expired else side, "reason": "EXPIRED" if expired else "SURRENDER"})
    match.revision += 1
    return _finish(db, command, match_payload(db, match, user_id))


def cleanup_expired(db, user_id, *, commit=True, bots_only=False):
    candidates = [row for row in _active(db, user_id) if (not bots_only or not row.opponent_user_id)
                  and aware(row.updated_at) < utcnow() - MATCH_TTL]
    _lock_users(db, user_id, *(row.user_id for row in candidates), *(row.opponent_user_id for row in candidates))
    count = 0
    for candidate in candidates:
        row = _owned_match(db, user_id, candidate.id, lock=True)
        if aware(row.updated_at) < utcnow() - MATCH_TTL:
            _complete(db, row, {"winner_side": None, "reason": "EXPIRED"}); row.revision += 1; count += 1
    if commit: db.commit()
    return {"expired": count}


def bootstrap(db, user_id, scope="REAL"):
    _scope(scope)
    user = db.get(User, user_id)
    squad = db.scalar(select(BattleSquad).where(BattleSquad.user_id == user_id, BattleSquad.scope == scope))
    inventory, unavailable = [], []
    for item, card in db.execute(select(ArchiveItem, ArchiveCard).join(ArchiveCard, ArchiveCard.id == ArchiveItem.card_id)
        .where(ArchiveItem.user_id == user_id, ArchiveItem.state == "OWNED",
               ArchiveItem.scope.in_(["REAL", "SANDBOX"] if scope == "SANDBOX" else ["REAL"]))):
        definition = approved_definition(db, card)
        if not definition:
            unavailable.append(dict(item_id=item.id, card=card_payload(card),
                reason="UNSUPPORTED_HERO" if card.hero not in engine.HEROES and card.rank != "EX" else "BATTLE_APPROVAL"))
            continue
        preview_rules = {**engine.RULES, "heroes": {**engine.HEROES, definition.key: definition.rules}}
        inventory.append(dict(item_id=item.id, card=card_payload(card), hero_key=definition.key, category=definition.category,
            definition_key=definition.key, scope=item.scope, reserved=is_item_reserved(db, item.id),
            definition=dict(id=definition.id, key=definition.key, category=definition.category, version=definition.version, rules=deepcopy(definition.rules)),
            stats=engine.stats(definition.key, card.rank, preview_rules) if definition.category == "HERO" else {"cost": 2, "max_hp": 1000}))
    access = {key: ex_access(db, user_id, scope=scope, patron_key=key) for key in ("HIDDEN_KING", "ARCHMOTHER")}
    assignments = [dict(id=row.id, mode=row.mode, period_day=row.period_day.isoformat(), slot=row.slot,
        status=row.status, opponent=deepcopy(row.opponent)) for row in db.scalars(select(BattleAssignment).where(
        BattleAssignment.user_id == user_id, BattleAssignment.period_day == utcnow().date(), BattleAssignment.scope == scope).order_by(BattleAssignment.slot))]
    season = db.scalar(select(BattleSeason).where(BattleSeason.active.is_(True), BattleSeason.starts_at <= utcnow(), BattleSeason.ends_at > utcnow()))
    rating = db.get(BattleRating, (season.id, user_id)) if season else None
    showcase = db.get(BattleShowcase, user_id)
    first = access["HIDDEN_KING"]
    return dict(account_key=user.id, rules=display_rules(db), squad=squad_payload(squad, scope), inventory=inventory,
        unavailable_inventory=unavailable, starter=starter_status(db, user_id, scope),
        assignments=assignments, active_matches=[dict(id=value.id, mode=value.mode, scope=value.scope, status=value.status,
            revision=value.revision, round=value.round, expired=aware(value.updated_at) < utcnow() - MATCH_TTL) for value in _active(db, user_id)],
        progression={**{key: first[key] for key in ("account_days", "confirmed_contracts", "eligible_pve_wins")},
            "trials": {key: value["trial_completed"] for key, value in access.items()}, "ex_access": access},
        season=dict(id=season.id, title=season.title, starts_at=aware(season.starts_at).isoformat(), ends_at=aware(season.ends_at).isoformat(),
                    rating=rating.rating if rating else 1000, games=rating.games if rating else 0,
                    earned_title=rating.earned_title if rating else "RECRUIT") if season else None,
        showcase=dict(revision=showcase.revision if showcase else 0, is_public=showcase.is_public if showcase else False,
                      base_item_id=showcase.base_item_id if showcase else None, slots=deepcopy(showcase.slots) if showcase else []))


# Social commands live separately; these exports keep the public service API stable.
def create_room(*args, **kwargs):
    from .battle_social import create_room as run
    return run(*args, **kwargs)


def join_room(*args, **kwargs):
    from .battle_social import join_room as run
    return run(*args, **kwargs)


def confirm_room(*args, **kwargs):
    from .battle_social import confirm_room as run
    return run(*args, **kwargs)


def public_copy_snapshot(*args, **kwargs):
    from .battle_social import public_copy_snapshot as run
    return run(*args, **kwargs)
