"""Private confirmation rooms, opt-in seasons and explicitly public squad copies."""
from copy import deepcopy
from datetime import timedelta
import math
import secrets

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select

from ..battle_models import (BattleMatch, BattleQueue, BattleRating, BattleRoom, BattleSeason, BattleShowcase)
from ..models import PublicProfile, User, utcnow
from .archive import aware
from . import battle_service as core


def _room(db, code, user_id=None, *, lock=False):
    query = select(BattleRoom).where(BattleRoom.code == code)
    if user_id: query = query.where(or_(BattleRoom.user_id == user_id, BattleRoom.opponent_user_id == user_id))
    if lock: query = query.with_for_update().execution_options(populate_existing=True)
    row = db.scalar(query)
    if not row: raise HTTPException(404, "Room not found")
    return row


def room_payload(room, user_id):
    return {"room": dict(code=room.code, scope=room.scope, status=room.status, match_id=room.match_id,
        own_confirmed=user_id in room.confirmations,
        opponent_confirmed=any(key != user_id for key in room.confirmations))}


def get_room(db, user_id, code):
    return room_payload(_room(db, code, user_id), user_id)


def create_room(db, user_id, request_key, scope="REAL"):
    core._lock_users(db, user_id); core._scope(scope)
    command, replay = core._begin(db, user_id, request_key, "room", {"scope": scope})
    if replay: return deepcopy(command.response)
    if db.scalar(select(BattleRoom.id).where(BattleRoom.user_id == user_id, BattleRoom.status == "WAITING")):
        raise HTTPException(409, "Leave the waiting room first")
    room = BattleRoom(user_id=user_id, scope=scope, code=secrets.token_hex(6).upper(), confirmations={})
    db.add(room); db.flush()
    return core._finish(db, command, room_payload(room, user_id))


def join_room(db, user_id, code, request_key):
    room = _room(db, code)
    core._lock_users(db, room.user_id, user_id)
    room = _room(db, code, lock=True)
    command, replay = core._begin(db, user_id, request_key, "join", {"code": code})
    if replay: return deepcopy(command.response)
    if room.status != "WAITING" or room.user_id == user_id or (room.opponent_user_id and room.opponent_user_id != user_id):
        raise HTTPException(409, "Room unavailable")
    if aware(room.created_at) < utcnow() - timedelta(hours=1): raise HTTPException(409, "Room expired")
    room.opponent_user_id = user_id
    return core._finish(db, command, room_payload(room, user_id))


def confirm_room(db, user_id, code, request_key, squad_revision, base_item_id):
    room = _room(db, code, user_id)
    participants = (room.user_id, room.opponent_user_id)
    core._lock_users(db, room.user_id, room.opponent_user_id)
    room = _room(db, code, user_id, lock=True)
    if participants != (room.user_id, room.opponent_user_id): raise HTTPException(409, "Room participants changed; reload")
    command, replay = core._begin(db, user_id, request_key, "confirm", {"code": code, "revision": squad_revision, "base_item_id": base_item_id})
    if replay: return deepcopy(command.response)
    if room.status != "WAITING" or not room.opponent_user_id or aware(room.created_at) < utcnow() - timedelta(hours=1):
        raise HTTPException(409, "Room unavailable")
    if user_id in room.confirmations: raise HTTPException(409, "Squad already sealed")
    if core._active(db, user_id): raise HTTPException(409, "Finish the active match first")
    snapshot = core._saved_snapshot(db, user_id, room.scope, squad_revision, base_item_id)
    confirmations = {**room.confirmations, user_id: snapshot}
    if len(confirmations) == 2:
        snapshots = {}
        for participant in (room.user_id, room.opponent_user_id):
            if core._active(db, participant): raise HTTPException(409, "Participant has an active match")
            saved = confirmations[participant]
            slots = [{"item_id": hero["item_id"], "line": hero["line"], "position": hero["position"]} for hero in saved["heroes"]]
            base = next((value for value in saved["item_ids"] if value not in [hero["item_id"] for hero in saved["heroes"]]), None)
            fresh = core._items_snapshot(db, participant, room.scope, slots, base)
            if (fresh["definitions"] != saved["definitions"] or fresh["definition_versions"] != saved["definition_versions"] or
                    [(value["hero_key"], value["rank"]) for value in fresh["heroes"]] !=
                    [(value["hero_key"], value["rank"]) for value in saved["heroes"]]):
                raise HTTPException(409, "A sealed squad definition changed; create a new room")
            snapshots[participant] = deepcopy(saved)
        match = core._new_match(db, room.user_id, room.opponent_user_id, "FRIENDLY", room.scope,
                               snapshots[room.user_id], snapshots[room.opponent_user_id])
        room.status = "STARTED"; room.match_id = match.id
    room.confirmations = confirmations
    return core._finish(db, command, room_payload(room, user_id))


def leave_room(db, user_id, code, request_key):
    room = _room(db, code, user_id)
    participants = (room.user_id, room.opponent_user_id)
    core._lock_users(db, room.user_id, room.opponent_user_id)
    room = _room(db, code, user_id, lock=True)
    if participants != (room.user_id, room.opponent_user_id): raise HTTPException(409, "Room participants changed; reload")
    command, replay = core._begin(db, user_id, request_key, "leave", {"code": code})
    if replay: return deepcopy(command.response)
    if room.status != "WAITING": raise HTTPException(409, "Room already started; surrender the match")
    room.status = "CLOSED"; room.confirmations = {}
    return core._finish(db, command, room_payload(room, user_id))


def save_showcase(db, user_id, expected_revision, is_public, base_item_id, slots):
    from .archive import lock_user
    lock_user(db, user_id)
    core._items_snapshot(db, user_id, "REAL", slots, base_item_id, reserve_check=False)
    row = db.get(BattleShowcase, user_id)
    if (row.revision if row else 0) != expected_revision: raise HTTPException(409, "Showcase changed; reload")
    if row is None:
        row = BattleShowcase(user_id=user_id, revision=0); db.add(row)
    row.revision += 1; row.is_public = is_public; row.base_item_id = base_item_id; row.slots = deepcopy(slots)
    db.commit()
    return {"showcase": dict(revision=row.revision, is_public=row.is_public, base_item_id=row.base_item_id, slots=deepcopy(row.slots))}


def public_copy_snapshot(db, user_id):
    profile = db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id, PublicProfile.is_public.is_(True), PublicProfile.show_showcase.is_(True)))
    user = db.get(User, user_id) if user_id else None
    row = db.get(BattleShowcase, user_id) if user_id else None
    if not profile or not user or user.status != "ACTIVE" or not row or not row.is_public: return None
    try:
        return core._items_snapshot(db, user_id, "REAL", row.slots, row.base_item_id, reserve_check=False, lock_items=False)
    except HTTPException:
        return None


def public_showcase(db, slug):
    profile = db.scalar(select(PublicProfile).where(PublicProfile.slug == slug, PublicProfile.is_public.is_(True)))
    snapshot = public_copy_snapshot(db, profile.user_id if profile else None)
    if snapshot is None: raise HTTPException(404, "Public squad unavailable")
    # Public shape includes only displayed cards/positions, never physical instance IDs or private inventory.
    result = {"user_id": profile.user_id, "base_key": snapshot["base_key"], "budget": snapshot["budget"],
        "base_card": deepcopy(snapshot.get("base_card")),
        "heroes": [{key: deepcopy(hero[key]) for key in ("hero_key", "rank", "line", "position", "card")} for hero in snapshot["heroes"]]}
    for card in [value["card"] for value in result["heroes"]] + ([result["base_card"]] if result["base_card"] else []):
        card["image_url"] = f"/api/public/players/{slug}/arena/cards/{card['id']}/image" if card["image_url"] else None
    return {"showcase": result}


def active_season(db, *, lock=False):
    query = select(BattleSeason).where(BattleSeason.active.is_(True), BattleSeason.starts_at <= utcnow(), BattleSeason.ends_at > utcnow()).order_by(BattleSeason.starts_at.desc())
    if lock: query = query.with_for_update().execution_options(populate_existing=True)
    return db.scalar(query)


def set_season(db, user_id, request_key, title, starts_at, ends_at, active):
    if aware(starts_at) >= aware(ends_at): raise HTTPException(422, "Season end must follow start")
    seasons = list(db.scalars(select(BattleSeason).where(BattleSeason.active.is_(True)).order_by(BattleSeason.id).with_for_update()))
    core._lock_users(db, user_id)
    command, replay = core._begin(db, user_id, request_key, "season", dict(title=title, starts_at=starts_at.isoformat(), ends_at=ends_at.isoformat(), active=active))
    if replay: return deepcopy(command.response)
    for row in seasons: row.active = False
    db.execute(delete(BattleQueue))
    row = BattleSeason(title=title, starts_at=starts_at, ends_at=ends_at, active=active); db.add(row); db.flush()
    return core._finish(db, command, {"season": dict(id=row.id, title=title, starts_at=aware(starts_at).isoformat(), ends_at=aware(ends_at).isoformat(), active=active)})


def queue_status(db, user_id):
    matches = [row for row in core._active(db, user_id) if row.mode == "RANKED"]
    if matches: return {"queued": False, **core.match_payload(db, matches[0], user_id)}
    queue = db.get(BattleQueue, user_id)
    return {"queued": bool(queue and aware(queue.created_at) >= utcnow() - timedelta(minutes=10)), "match": None}


def cancel_queue(db, user_id):
    core._lock_users(db, user_id)
    db.execute(delete(BattleQueue).where(BattleQueue.user_id == user_id)); db.commit()
    return {"queued": False, "match": None}


def join_queue(db, user_id, request_key, squad_revision, base_item_id):
    # One season row serializes matching, including first-queue creation on PostgreSQL.
    season = active_season(db, lock=True)
    if not season: raise HTTPException(409, "No active arena season")
    # Lock the compatible candidates and initiator in canonical order before touching instances.
    candidates = list(db.scalars(select(BattleQueue).where(BattleQueue.season_id == season.id,
        BattleQueue.user_id != user_id, BattleQueue.created_at >= utcnow() - timedelta(minutes=10)).order_by(BattleQueue.created_at)))
    core._lock_users(db, user_id, *(value.user_id for value in candidates))
    command, replay = core._begin(db, user_id, request_key, "queue", dict(revision=squad_revision, base_item_id=base_item_id))
    if replay: return deepcopy(command.response)
    if core._active(db, user_id): raise HTTPException(409, "Finish the active match first")
    snapshot = core._saved_snapshot(db, user_id, "REAL", squad_revision, base_item_id)
    rating = db.get(BattleRating, (season.id, user_id))
    if not rating:
        rating = BattleRating(season_id=season.id, user_id=user_id, rating=1000, games=0, wins=0); db.add(rating)
    experience = db.scalar(select(func.count()).select_from(BattleMatch).where(BattleMatch.user_id == user_id,
        BattleMatch.scope == "REAL", BattleMatch.status == "FINISHED", BattleMatch.mode.in_(["ASSIGNED", "HARD", "TRAINING", "TUTORIAL"]))) or 0
    db.execute(delete(BattleQueue).where(or_(BattleQueue.user_id == user_id,
        BattleQueue.created_at < utcnow() - timedelta(minutes=10))).execution_options(synchronize_session="fetch"))
    for candidate in candidates:
        participant = db.get(User, candidate.user_id)
        if not participant or participant.status != "ACTIVE":
            db.delete(candidate); continue
        if abs(candidate.rating - rating.rating) > 200 or abs(candidate.budget - snapshot["budget"]) > 4 or (candidate.experience < 10) != (experience < 10): continue
        if core._active(db, candidate.user_id):
            db.delete(candidate); continue
        saved = candidate.snapshot
        slots = [{"item_id": hero["item_id"], "line": hero["line"], "position": hero["position"]} for hero in saved["heroes"]]
        base = next((value for value in saved["item_ids"] if value not in [hero["item_id"] for hero in saved["heroes"]]), None)
        try: second = core._items_snapshot(db, candidate.user_id, "REAL", slots, base)
        except HTTPException:
            db.delete(candidate); continue
        match = core._new_match(db, candidate.user_id, user_id, "RANKED", "REAL", second, snapshot, season_id=season.id)
        db.delete(candidate)
        return core._finish(db, command, {"queued": False, **core.match_payload(db, match, user_id)})
    db.add(BattleQueue(user_id=user_id, season_id=season.id, snapshot=snapshot, rating=rating.rating,
                       budget=snapshot["budget"], experience=experience))
    return core._finish(db, command, {"queued": True, "match": None})


def settle_rating(db, match):
    if match.scope != "REAL" or not match.season_id or not match.opponent_user_id or match.result["reason"] == "EXPIRED": return
    ratings = []
    for user_id in (match.user_id, match.opponent_user_id):
        row = db.get(BattleRating, (match.season_id, user_id))
        if row is None:
            row = BattleRating(season_id=match.season_id, user_id=user_id, rating=1000, games=0, wins=0); db.add(row)
        ratings.append(row)
    first, second = ratings
    expected = 1 / (1 + 10 ** ((second.rating - first.rating) / 400))
    actual = 0.5 if match.outcome == "DRAW" else (1 if match.outcome == "WIN" else 0)
    delta = math.floor(24 * (actual - expected) + 0.5)
    first.rating += delta; second.rating -= delta
    first.games += 1; second.games += 1
    if match.outcome == "WIN": first.wins += 1
    elif match.outcome == "LOSS": second.wins += 1
    # Presentation-only season cosmetics, retained with this season's result.
    for row in ratings:
        row.earned_title = ("VETERAN" if row.games >= 30 and row.rating >= 1400 else
                            "TACTICIAN" if row.games >= 10 and row.rating >= 1100 else
                            "PARTICIPANT" if row.games >= 3 else "RECRUIT")


def leaderboard(db):
    season = active_season(db)
    if not season: return {"season": None, "players": []}
    rows = db.execute(select(BattleRating, User, PublicProfile).join(User, User.id == BattleRating.user_id)
        .join(PublicProfile, PublicProfile.user_id == User.id).where(BattleRating.season_id == season.id,
            BattleRating.games > 0, User.status == "ACTIVE", PublicProfile.is_public.is_(True))
        .order_by(BattleRating.rating.desc(), BattleRating.games.desc(), BattleRating.user_id).limit(100)).all()
    return {"season": {"id": season.id, "title": season.title}, "players": [dict(slug=profile.slug,
        display_name=user.display_name, rating=rating.rating, games=rating.games, wins=rating.wins,
        earned_title=rating.earned_title) for rating, user, profile in rows]}
