from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.contract_relay import opt_in
from app.db import Base
from app.models import ContractRelayConnection, User
from test_bureau_operations import elevate
from test_contract_relay import PROFILE, steam_player
from test_player_community import community


def seed_participants(factory, count):
    with factory() as db:
        users = [User(display_name=f"Participant {index}", steam_id64=76561197960265728 + index, account_id=index)
                 for index in range(1, count + 1)]
        db.add_all(users)
        db.flush()
        db.add_all(ContractRelayConnection(user_id=user.id) for user in users)
        db.commit()
        return [user.id for user in users]


def test_pilot_cap_rejects_new_consent_but_keeps_existing_and_allows_explicit_retry(community):
    factory, player = community
    seed_participants(factory, 29)
    _, current = steam_player(factory, player, "Last place", 100)
    _, waiting = steam_player(factory, player, "Another player", 101)

    accepted = current.put(PROFILE)
    assert accepted.status_code == 200 and accepted.json()["connection"] is not None
    assert current.put(PROFILE).json() == accepted.json()
    denied = waiting.put(PROFILE, headers={"Accept-Language": "en"})
    assert denied.status_code == 409
    assert denied.json()["code"] == "RELAY_PILOT_FULL"
    assert "30" in denied.json()["message"]
    assert waiting.get(PROFILE).json() == {"connection": None}

    assert current.delete(PROFILE).status_code == 200
    assert waiting.get(PROFILE).json() == {"connection": None}
    assert waiting.put(PROFILE).status_code == 200


def test_pilot_keeps_existing_over_capacity_records_and_admin_can_release_them(community):
    factory, player = community
    existing = seed_participants(factory, 30)
    current_id, current = steam_player(factory, player, "Existing place", 100)
    with factory() as db:
        db.add(ContractRelayConnection(user_id=current_id))
        db.commit()
    _, waiting = steam_player(factory, player, "Another player", 101)
    admin_id, admin = player("Admin")
    elevate(factory, admin_id, admin, role="ADMIN")

    assert waiting.put(PROFILE).status_code == 409
    assert current.put(PROFILE).status_code == 200
    review_url = f"/api/admin/users/{existing[-1]}/contract-relay"
    connection = admin.get(review_url).json()["connection"]
    assert admin.patch(f'{review_url}/{connection["id"]}', json={"action": "disconnect"}).status_code == 200
    assert waiting.put(PROFILE).status_code == 409
    assert current.delete(PROFILE).status_code == 200
    assert waiting.put(PROFILE).status_code == 200


@pytest.mark.parametrize("backend", ["sqlite", "postgresql"])
def test_simultaneous_consents_cannot_both_claim_the_final_place(tmp_path, backend):
    schema = None
    if backend == "postgresql":
        url = os.getenv("RELAY_PILOT_TEST_DATABASE_URL")
        if not url:
            pytest.skip("Set RELAY_PILOT_TEST_DATABASE_URL for the PostgreSQL concurrency check")
        schema = f"relay_pilot_{uuid4().hex}"
        engine = create_engine(url, execution_options={"schema_translate_map": {None: schema}})
        assert engine.dialect.name == "postgresql"
    else:
        engine = create_engine(f"sqlite:///{tmp_path / 'relay.db'}")

    try:
        with engine.begin() as connection:
            if schema:
                connection.execute(CreateSchema(schema))
            Base.metadata.create_all(connection, tables=[User.__table__, ContractRelayConnection.__table__])
        factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        seed_participants(factory, 29)
        with factory.begin() as db:
            applicants = [User(steam_id64=76561197960265728 + index, account_id=index) for index in (100, 101)]
            db.add_all(applicants)
        barrier = Barrier(2)

        def join(user_id):
            with factory() as db:
                user = db.get(User, user_id)
                barrier.wait(timeout=10)
                try:
                    return 200 if opt_in(Response(), user, db)["connection"] else 500
                except HTTPException as exc:
                    return exc.status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            assert sorted(executor.map(join, (user.id for user in applicants))) == [200, 409]
        with factory() as db:
            assert db.scalar(select(func.count()).select_from(ContractRelayConnection)) == 30
    finally:
        if schema:
            with engine.begin() as connection:
                connection.execute(DropSchema(schema, if_exists=True, cascade=True))
        engine.dispose()
