"""Historical money must stay conserved while test-funded assets stay sandboxed."""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa


@pytest.fixture()
def legacy():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    definitions = {
        "archive_ledger": [sa.Column("user_id", sa.String), sa.Column("source", sa.String),
                           sa.Column("reason", sa.String), sa.Column("delta", sa.Integer),
                           sa.Column("scope", sa.String, default="REAL"), sa.Column("created_at", sa.DateTime)],
        "archive_operations": [sa.Column("user_id", sa.String), sa.Column("kind", sa.String),
                               sa.Column("scope", sa.String, default="REAL"), sa.Column("result", sa.JSON),
                               sa.Column("benefit_key", sa.String)],
        "archive_items": [sa.Column("operation_id", sa.String), sa.Column("user_id", sa.String),
                          sa.Column("test_grant", sa.Boolean), sa.Column("scope", sa.String, default="REAL")],
        "archive_packs": [sa.Column("active", sa.Boolean), sa.Column("revision", sa.Integer)],
        "archive_pack_versions": [sa.Column("pack_id", sa.String), sa.Column("revision", sa.Integer),
                                  sa.Column("config", sa.JSON), sa.Column("created_at", sa.DateTime)],
    }
    tables = {name: sa.Table(name, metadata, sa.Column("id", sa.String, primary_key=True), *cols)
              for name, cols in definitions.items()}
    metadata.create_all(engine)
    with engine.begin() as connection:
        yield connection, tables


def migration():
    path = Path(__file__).parents[1] / "alembic/versions/0021_contract_coin_economy.py"
    spec = importlib.util.spec_from_file_location("coin_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_mixed_legacy_test_money_conserves_balance_and_classifies_purchases(legacy):
    connection, tables = legacy
    rows = [
        ("earn", "cipher:1", "CIPHER", 100),
        ("grant", "operation:g", "OWNER_TOKENS", 200),
        ("buy1", "operation:b1", "DIRECT_CARD", -50),
        ("buy2", "operation:b2", "PACK_OPEN", -100),
        ("refund", "operation:r", "RECYCLE", 20),
        ("adjust", "operation:a", "OWNER_TOKENS", -10),
    ]
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    for index, (key, source, reason, delta) in enumerate(rows):
        connection.execute(tables["archive_ledger"].insert().values(
            id=key, user_id="u", source=source, reason=reason, delta=delta,
            scope="REAL", created_at=start + timedelta(seconds=index)))
    receipt = {"balance_after": 150, "items": [{"id": "item2"}]}
    connection.execute(tables["archive_operations"].insert(), [
        {"id": key, "user_id": "u", "kind": kind, "scope": "REAL", "result": result}
        for key, kind, result in [("g", "OWNER_TOKENS", {}), ("b1", "DIRECT_CARD", {}),
                                  ("b2", "PACK_OPEN", receipt), ("r", "RECYCLE", {"recycled_item_id": "item2"}),
                                  ("a", "OWNER_TOKENS", {}), ("free", "OWNER_CARD", {})]])
    connection.execute(tables["archive_items"].insert(), [
        {"id": key, "operation_id": op, "user_id": "u", "test_grant": test, "scope": "REAL"}
        for key, op, test in [("item1", "b1", False), ("item2", "b2", False), ("free", "free", True)]])
    migration().migrate_scopes(connection)
    balances = dict(connection.execute(sa.select(tables["archive_ledger"].c.scope,
                    sa.func.sum(tables["archive_ledger"].c.delta)).group_by(tables["archive_ledger"].c.scope)).all())
    assert balances == {"REAL": 0, "SANDBOX": 160}
    items = dict(connection.execute(sa.select(tables["archive_items"].c.id, tables["archive_items"].c.scope)).all())
    assert items == {"item1": "REAL", "item2": "SANDBOX", "free": "SANDBOX"}
    assert connection.scalar(sa.select(tables["archive_items"].c.test_grant).where(
        tables["archive_items"].c.id == "item2")) is True
    assert connection.scalar(sa.select(tables["archive_operations"].c.result).where(
        tables["archive_operations"].c.id == "b2")) == receipt
    original = {row.id: row.delta for row in connection.execute(sa.select(tables["archive_ledger"])) if row.id in {r[0] for r in rows}}
    assert original == {key: delta for key, _, _, delta in rows}


def test_pack_repricing_creates_only_a_future_active_version(legacy):
    connection, tables = legacy
    old = {"title": "Legacy", "price": 10, "draws": 3, "price_model": 1,
           "entries": [{"card_id": "f", "rank": "F", "weight": 1},
                       {"card_id": "s", "rank": "S", "weight": 1}]}
    connection.execute(tables["archive_packs"].insert(), [
        {"id": "active", "active": True, "revision": 1}, {"id": "inactive", "active": False, "revision": 1}])
    connection.execute(tables["archive_pack_versions"].insert(), [
        {"id": key, "pack_id": key, "revision": 1, "config": old} for key in ["active", "inactive"]])
    migration().reprice_packs(connection)
    migration().reprice_packs(connection)
    versions = list(connection.execute(sa.select(tables["archive_pack_versions"]).order_by(
        tables["archive_pack_versions"].c.pack_id, tables["archive_pack_versions"].c.revision)))
    assert len(versions) == 3
    assert versions[0].config == old
    assert versions[1].config == {**old, "price": 600, "price_model": 2}
    assert versions[2].config == old
    assert connection.scalar(sa.select(tables["archive_packs"].c.revision).where(tables["archive_packs"].c.id == "active")) == 2


def test_historical_owner_debit_cannot_create_extra_spendable_real_funds(legacy):
    connection, tables = legacy
    connection.execute(tables["archive_ledger"].insert(), [
        {"id": "earn", "user_id": "u", "source": "cipher:1", "reason": "CIPHER", "delta": 100,
         "scope": "REAL", "created_at": datetime(2026, 10, 1)},
        {"id": "debit", "user_id": "u", "source": "operation:debit", "reason": "OWNER_TOKENS", "delta": -50,
         "scope": "REAL", "created_at": datetime(2026, 10, 2)},
    ])
    migration().migrate_scopes(connection)
    balances = dict(connection.execute(sa.select(tables["archive_ledger"].c.scope,
                    sa.func.sum(tables["archive_ledger"].c.delta)).group_by(tables["archive_ledger"].c.scope)).all())
    assert balances == {"REAL": 50, "SANDBOX": 0}
