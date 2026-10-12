"""Contract coin rights and isolated test economy.

Revision ID: 0021
Revises: 0020
"""
from datetime import datetime, timezone
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def migrate_scopes(connection):
    """Replay old pooled funds; never convert test money into REAL assets.

    Mixed purchases use REAL first, then SANDBOX. Because inventory must have
    one scope, the whole mixed purchase is sandboxed; paired ledger transfers
    record its REAL contribution without changing original amounts/receipts.
    """
    metadata = sa.MetaData()
    ledger, operations, items = [sa.Table(name, metadata, autoload_with=connection) for name in
                                 ("archive_ledger", "archive_operations", "archive_items")]
    operation_rows = {row.id: row for row in connection.execute(sa.select(operations))}
    item_scopes = {}
    operation_scopes = {}
    balances = {}
    rows = connection.execute(sa.select(ledger).order_by(ledger.c.user_id, ledger.c.created_at, ledger.c.id)).all()
    for row in rows:
        current = balances.setdefault(row.user_id, {"REAL": 0, "SANDBOX": 0})
        operation_id = row.source.removeprefix("operation:") if row.source.startswith("operation:") else None
        operation = operation_rows.get(operation_id)
        scope = "SANDBOX" if row.reason == "OWNER_TOKENS" else "REAL"
        if row.reason == "RECYCLE" and operation:
            scope = item_scopes.get((operation.result or {}).get("recycled_item_id"), "REAL")
        contribution = 0
        if row.delta < 0:
            if row.reason == "OWNER_TOKENS":
                # Old OWNER debits could consume earned money in the pooled
                # wallet. Preserve that debit rather than minting spendable REAL.
                contribution = min(max(0, current["REAL"]), max(0, -row.delta - current["SANDBOX"]))
            elif current["REAL"] < -row.delta:
                scope = "SANDBOX"
                contribution = max(0, current["REAL"])
        if contribution:
            for target, delta in (("REAL", -contribution), ("SANDBOX", contribution)):
                connection.execute(ledger.insert().values(
                    id=str(uuid4()), user_id=row.user_id,
                    source=f"scope-migration:{row.id}:{target}", reason="SCOPE_MIGRATION",
                    delta=delta, scope=target, created_at=row.created_at))
                current[target] += delta
        current[scope] += row.delta
        connection.execute(ledger.update().where(ledger.c.id == row.id).values(scope=scope))
        if operation:
            operation_scopes[operation_id] = scope
            for item in connection.execute(sa.select(items).where(items.c.operation_id == operation_id)):
                item_scopes[item.id] = "SANDBOX" if item.test_grant else scope
    for operation in operation_rows.values():
        scope = operation_scopes.get(operation.id, "SANDBOX" if operation.kind == "OWNER_CARD" else "REAL")
        connection.execute(operations.update().where(operations.c.id == operation.id).values(scope=scope))
        if scope == "SANDBOX" and operation.kind == "STARTER_PACK" and "benefit_key" in operations.c:
            connection.execute(operations.update().where(operations.c.id == operation.id).values(benefit_key="starter:sandbox"))
        connection.execute(items.update().where(items.c.operation_id == operation.id).values(scope=scope))
    connection.execute(items.update().where(items.c.test_grant.is_(True)).values(scope="SANDBOX"))
    connection.execute(items.update().where(items.c.scope == "SANDBOX").values(test_grant=True))


def reprice_packs(connection):
    """Append policy-2 versions; old purchases continue to point at old rules."""
    metadata = sa.MetaData()
    packs = sa.Table("archive_packs", metadata, autoload_with=connection)
    versions = sa.Table("archive_pack_versions", metadata, autoload_with=connection)
    prices = dict(zip(("F", "E", "D", "C", "B", "A", "S", "SS", "SSS"),
                      (25, 40, 70, 120, 220, 380, 700, 1300, 2600)))
    for pack in connection.execute(sa.select(packs).where(packs.c.active.is_(True))).all():
        old = connection.execute(sa.select(versions).where(versions.c.pack_id == pack.id,
                                 versions.c.revision == pack.revision)).one()
        config = dict(old.config)
        if config.get("price_model", 1) >= 2:
            continue
        entries = config["entries"]
        total = sum(entry["weight"] for entry in entries)
        value = sum(prices[entry["rank"]] * entry["weight"] for entry in entries)
        denominator = total * 100 * 5
        config["price"] = max(5, ((config["draws"] * value * 55 + denominator - 1) // denominator) * 5)
        config["price_model"] = 2
        next_revision = pack.revision + 1
        connection.execute(versions.insert().values(id=str(uuid4()), pack_id=pack.id, revision=next_revision,
                           config=config, created_at=datetime.now(timezone.utc)))
        connection.execute(packs.update().where(packs.c.id == pack.id).values(revision=next_revision))


def upgrade():
    for table, constraint in (("archive_ledger", "ck_archive_ledger_scope"),
                              ("archive_operations", "ck_archive_operation_scope"),
                              ("archive_items", "ck_archive_item_scope")):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("scope", sa.String(8), nullable=False, server_default="REAL"))
            batch.create_check_constraint(constraint, "scope IN ('REAL', 'SANDBOX')")
    migrate_scopes(op.get_bind())
    reprice_packs(op.get_bind())
    op.create_table("coin_policy_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assignment_id", sa.String(36), sa.ForeignKey("board_options.id", ondelete="CASCADE"), nullable=False),
        sa.Column("board_id", sa.String(36), sa.ForeignKey("contract_boards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("policy_version", sa.String(32), nullable=False),
        sa.Column("mode", sa.String(32), nullable=False),
        sa.Column("difficulty", sa.String(24), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("case_bonus", sa.Integer(), nullable=False),
        sa.Column("selected_count", sa.Integer(), nullable=False),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("assignment_id", name="uq_coin_policy_assignment"),
        sa.CheckConstraint("amount >= 0 AND case_bonus >= 0", name="ck_coin_policy_amount"))
    for field in ("user_id", "assignment_id", "board_id"):
        op.create_index(f"ix_coin_policy_snapshots_{field}", "coin_policy_snapshots", [field])
    op.create_table("coin_entitlements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.String(24), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("policy_version", sa.String(32), nullable=False),
        sa.Column("policy_snapshot_id", sa.String(36), sa.ForeignKey("coin_policy_snapshots.id", ondelete="SET NULL")),
        sa.Column("evaluation_id", sa.String(36), sa.ForeignKey("evaluations.id", ondelete="SET NULL")),
        sa.Column("match_id", sa.String(36), sa.ForeignKey("matches.id", ondelete="SET NULL")),
        sa.Column("period_day", sa.Date()), sa.Column("period_week", sa.Date()),
        sa.Column("nominal_amount", sa.Integer(), nullable=False), sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("eligible", sa.Boolean(), nullable=False), sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("status", sa.String(24), nullable=False), sa.Column("ledger_source", sa.String(80)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "source_type", "source_id", name="uq_coin_entitlement_source"),
        sa.CheckConstraint("nominal_amount >= 0 AND amount >= 0 AND amount <= nominal_amount", name="ck_coin_entitlement_amount"))
    op.create_index("ix_coin_entitlements_user_id", "coin_entitlements", ["user_id"])
    op.create_table("coin_quotas",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(24), nullable=False), sa.Column("period_kind", sa.String(8), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False), sa.Column("used", sa.Integer(), nullable=False),
        sa.UniqueConstraint("user_id", "source", "period_kind", "period_start", name="uq_coin_quota_period"),
        sa.CheckConstraint("used >= 0", name="ck_coin_quota_used"))
    op.create_index("ix_coin_quotas_user_id", "coin_quotas", ["user_id"])
    op.create_table("coin_corrections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entitlement_id", sa.String(36), sa.ForeignKey("coin_entitlements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("request_key", sa.String(36), nullable=False), sa.Column("reason", sa.String(300), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "request_key", name="uq_coin_correction_request"),
        sa.UniqueConstraint("entitlement_id", name="uq_coin_correction_entitlement"),
        sa.CheckConstraint("delta <= 0", name="ck_coin_correction_delta"))
    for field in ("user_id", "entitlement_id"):
        op.create_index(f"ix_coin_corrections_{field}", "coin_corrections", [field])


def downgrade():
    op.drop_table("coin_corrections")
    op.drop_table("coin_quotas")
    op.drop_table("coin_entitlements")
    op.drop_table("coin_policy_snapshots")
    # Scope transfers sum to zero and can be removed when the wallets merge.
    op.execute(sa.text("DELETE FROM archive_ledger WHERE reason = 'SCOPE_MIGRATION'"))
    for table, constraint in (("archive_items", "ck_archive_item_scope"),
                              ("archive_operations", "ck_archive_operation_scope"),
                              ("archive_ledger", "ck_archive_ledger_scope")):
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(constraint, type_="check")
            batch.drop_column("scope")
