"""Opt-in pilot queue and durable request accounting, independent of any GC client."""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Collection, Iterable, Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID


QuotaKind = Literal["history", "metadata"]
PASS_INTERVAL = 60 * 60
QUOTA_WINDOW = 24 * PASS_INTERVAL
LIMITS = {"history": 20, "metadata": 40}
RESERVES = {"history": 4, "metadata": 8}
BACKGROUND_PER_PASS = {"history": 1, "metadata": 2}


def _timestamp(instant: datetime) -> float:
    if instant.utcoffset() is None:
        raise ValueError("A timestamp with a UTC offset is required")
    return instant.timestamp()


@dataclass(frozen=True)
class Candidate:
    kind: QuotaKind
    target_id: int
    connection_id: UUID | None
    waiting_since: datetime | None = None

    def __post_init__(self) -> None:
        if self.kind not in LIMITS or type(self.target_id) is not int or not 0 < self.target_id < 2**64:
            raise ValueError("Invalid Relay request kind or target")
        if self.waiting_since is not None:
            _timestamp(self.waiting_since)


def order_candidates(
    candidates: Iterable[Candidate], *, confirmed_connections: Collection[UUID],
) -> tuple[Candidate, ...]:
    """Exclude general queue entries, then keep the strongest reason for each target."""
    eligible = sorted(
        (
            candidate for candidate in candidates
            if candidate.connection_id is not None and candidate.connection_id in confirmed_connections
        ),
        key=lambda candidate: (
            _timestamp(candidate.waiting_since) if candidate.waiting_since is not None else float("inf"),
            candidate.kind != "metadata",
            candidate.target_id,
            str(candidate.connection_id),
        ),
    )
    unique: dict[tuple[QuotaKind, int], Candidate] = {}
    for candidate in eligible:
        unique.setdefault((candidate.kind, candidate.target_id), candidate)
    return tuple(unique.values())


class QuotaLedger:
    """Persist a single Steam account's charges and scheduling clock across restarts."""

    def __init__(self, path: Path, *, account_id: int) -> None:
        if type(account_id) is not int or not 0 < account_id < 2**64:
            raise ValueError("A valid Steam account ID is required")
        self._uri = f"{path.resolve().as_uri()}?mode=rw"
        self._account_id = str(account_id)

    @classmethod
    def initialize(
        cls,
        path: Path,
        *,
        account_id: int,
        now: datetime,
        history_spent_at: Iterable[datetime],
        metadata_spent_at: Iterable[datetime],
    ) -> QuotaLedger:
        """Create explicitly from verified prior usage. Never replace existing state."""
        ledger = cls(path, account_id=account_id)
        instant = _timestamp(now)
        charges = [
            (kind, _timestamp(spent))
            for kind, instants in (("history", history_spent_at), ("metadata", metadata_spent_at))
            for spent in instants
        ]
        if any(spent > instant for _, spent in charges):
            raise ValueError("Quota charges cannot be in the future")

        os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
        with closing(sqlite3.connect(ledger._uri, uri=True)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE account (steam_id TEXT PRIMARY KEY, last_seen_at REAL NOT NULL, pass_at REAL)")
            db.execute("CREATE TABLE blocked (kind TEXT PRIMARY KEY, until REAL NOT NULL)")
            db.execute("""
                CREATE TABLE charges (
                    kind TEXT NOT NULL, spent_at REAL NOT NULL, pass_at REAL, target_id TEXT,
                    background INTEGER NOT NULL, UNIQUE(kind, pass_at, target_id)
                )
            """)
            db.execute("INSERT INTO account VALUES (?, ?, NULL)", (ledger._account_id, instant))
            db.executemany(
                "INSERT INTO charges VALUES (?, ?, NULL, NULL, 0)",
                ((kind, spent) for kind, spent in charges if spent > instant - QUOTA_WINDOW),
            )
        return ledger

    @contextmanager
    def _transaction(self, now: float) -> Iterator[tuple[sqlite3.Connection, float | None]]:
        try:
            with closing(sqlite3.connect(self._uri, uri=True)) as db, db:
                db.execute("BEGIN IMMEDIATE")
                state = db.execute(
                    "SELECT last_seen_at, pass_at FROM account WHERE steam_id = ?", (self._account_id,),
                ).fetchone()
                if state is None:
                    raise RuntimeError("Wrong account for this Relay quota ledger")
                last_seen_at, pass_at = state
                if now < last_seen_at:
                    raise RuntimeError("Clock moved backwards for the Relay quota ledger")
                db.execute("UPDATE account SET last_seen_at = ?", (now,))
                db.execute("DELETE FROM charges WHERE spent_at <= ?", (now - QUOTA_WINDOW,))
                yield db, pass_at
        except sqlite3.DatabaseError as exc:
            raise RuntimeError("Relay quota ledger is unavailable") from exc

    def begin_cycle(self, *, now: datetime) -> datetime | None:
        """Claim the hourly queue analysis, independently of how much it spends."""
        instant = _timestamp(now)
        with self._transaction(instant) as (db, previous):
            if previous is not None and instant < previous + PASS_INTERVAL:
                return None
            db.execute("UPDATE account SET pass_at = ?", (instant,))
        return datetime.fromtimestamp(instant, timezone.utc)

    @staticmethod
    def _has_capacity(db: sqlite3.Connection, kind: QuotaKind, *, now: float, background: bool) -> bool:
        if db.execute("SELECT 1 FROM blocked WHERE kind = ? AND until > ?", (kind, now)).fetchone():
            return False
        count = db.execute("SELECT COUNT(*) FROM charges WHERE kind = ?", (kind,)).fetchone()[0]
        limit = LIMITS[kind] - (RESERVES[kind] if background else 0)
        return count < limit

    def try_reserve(
        self,
        cycle: datetime,
        candidate: Candidate,
        *,
        confirmed_connections: Collection[UUID],
        now: datetime,
    ) -> bool:
        """Commit one charge before one attempt. A timeout does not refund the charge."""
        if candidate.connection_id is None or candidate.connection_id not in confirmed_connections:
            return False
        instant, cycle_at = _timestamp(now), _timestamp(cycle)
        background = candidate.waiting_since is None
        if candidate.waiting_since is not None and _timestamp(candidate.waiting_since) > instant:
            raise ValueError("A pending contract cannot start in the future")

        with self._transaction(instant) as (db, active_cycle):
            if cycle_at != active_cycle or not cycle_at <= instant < cycle_at + PASS_INTERVAL:
                return False
            if not self._has_capacity(db, candidate.kind, now=instant, background=background):
                return False
            if candidate.kind == "history" and not self._has_capacity(
                db, "metadata", now=instant, background=background,
            ):
                return False
            if background:
                count = db.execute(
                    "SELECT COUNT(*) FROM charges WHERE kind = ? AND pass_at = ? AND background = 1",
                    (candidate.kind, cycle_at),
                ).fetchone()[0]
                if count >= BACKGROUND_PER_PASS[candidate.kind]:
                    return False
            result = db.execute(
                "INSERT INTO charges VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, pass_at, target_id) DO NOTHING",
                (candidate.kind, instant, cycle_at, str(candidate.target_id), background),
            )
            return result.rowcount == 1

    def record_rate_limit(self, kind: QuotaKind, *, now: datetime) -> None:
        """Stop spending this quota for a full window after provider rate limiting."""
        if kind not in LIMITS:
            raise ValueError("Invalid Relay request kind")
        instant = _timestamp(now)
        with self._transaction(instant) as (db, _):
            db.execute(
                "INSERT INTO blocked VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET until = excluded.until",
                (kind, instant + QUOTA_WINDOW),
            )
