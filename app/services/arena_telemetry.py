"""Aggregate pilot measurements. No player identities or reward mutations."""
from datetime import timedelta
from statistics import median

from sqlalchemy import func, select

from ..battle_models import BattleMatch
from ..coin_models import CoinEntitlement
from ..models import ArchiveCard, ArchiveItem, ArchiveLedger, User, utcnow
from .archive import aware


def _cap_times(rights):
    """Quotas are consumed by awarded rights, including later corrections."""
    totals, reached = {}, {}
    for right in sorted(rights, key=lambda row: (aware(row.created_at), row.id)):
        for kind, period, limit in (("DAY", right.period_day, 24), ("WEEK", right.period_week, 120)):
            key = (right.user_id, kind, period)
            totals[key] = totals.get(key, 0) + right.amount
            if totals[key] >= limit or (right.amount == 0 and right.reason == f"{'DAILY' if kind == 'DAY' else 'WEEKLY'}_LIMIT"):
                reached.setdefault(key, aware(right.created_at))
    return reached


def pilot_metrics(db, *, now=None):
    cutoff = aware(now or utcnow()) - timedelta(days=30)
    economy = db.execute(select(ArchiveLedger.reason, func.sum(ArchiveLedger.delta), func.count())
        .where(ArchiveLedger.scope == "REAL", ArchiveLedger.created_at >= cutoff)
        .group_by(ArchiveLedger.reason).order_by(ArchiveLedger.reason)).all()
    decisions = db.execute(select(CoinEntitlement.source_type, CoinEntitlement.reason,
        CoinEntitlement.status, func.count()).where(CoinEntitlement.created_at >= cutoff)
        .group_by(CoinEntitlement.source_type, CoinEntitlement.reason, CoinEntitlement.status)).all()
    matches = list(db.scalars(select(BattleMatch).where(BattleMatch.scope == "REAL",
                                                      BattleMatch.created_at >= cutoff)))
    mode_counts, patrons, patron_results, heroes, budgets = {}, {}, {}, {}, {}
    durations, rounds, draws, practice_after_cap = [], [], 0, 0
    cutoff_day = cutoff.date()
    cutoff_week = cutoff_day - timedelta(days=cutoff_day.weekday())
    capped = _cap_times(db.scalars(select(CoinEntitlement).where(
        CoinEntitlement.source_type == "pve", CoinEntitlement.period_week >= cutoff_week)))
    def after_cap(match):
        day = aware(match.created_at).date()
        week = day - timedelta(days=day.weekday())
        return bool(match.mode == "TRAINING" and any(
            (at := capped.get((match.user_id, kind, period))) and aware(match.created_at) >= at
            for kind, period in (("DAY", day), ("WEEK", week))))
    for match in matches:
        mode_counts[match.mode] = mode_counts.get(match.mode, 0) + 1
        for index, side in enumerate(match.state.get("sides", [])):
            key = side.get("base", {}).get("key", "ORDINARY")
            patrons[key] = patrons.get(key, 0) + 1
            if match.status == "FINISHED" and match.result and match.result.get("reason") not in {"EXPIRED", "SURRENDER"}:
                group = f"{match.mode}:{key}"
                record = patron_results.setdefault(group, {"mode": match.mode, "patron": key, "wins": 0, "losses": 0, "draws": 0})
                winner = match.result.get("winner_side")
                record["draws" if winner is None else "wins" if winner == ("A" if index == 0 else "B") else "losses"] += 1
                for hero in side.get("heroes", []):
                    hero_key = hero.get("hero_key", "UNKNOWN")
                    heroes[hero_key] = heroes.get(hero_key, 0) + 1
                frozen_base = match.state.get("rules", {}).get("bases", {}).get(key, {})
                budget = str(sum(hero.get("cost", 0) for hero in side.get("heroes", [])) + frozen_base.get("cost", 0))
                budgets[budget] = budgets.get(budget, 0) + 1
        if match.status == "FINISHED" and match.completed_at:
            durations.append(max(0, (aware(match.completed_at)-aware(match.created_at)).total_seconds()))
            rounds.append(match.round)
            draws += match.outcome == "DRAW"
        practice_after_cap += after_cap(match)
    first_targets = {}
    for rank in ("A", "S", "EX"):
        rows = db.execute(select(ArchiveItem.user_id, func.min(ArchiveItem.created_at), User.created_at)
            .join(ArchiveCard, ArchiveCard.id == ArchiveItem.card_id).join(User, User.id == ArchiveItem.user_id)
            .where(ArchiveItem.scope == "REAL", ArchiveItem.test_grant.is_(False), ArchiveCard.rank == rank)
            .group_by(ArchiveItem.user_id, User.created_at)).all()
        values = [max(0, (aware(acquired)-aware(created)).total_seconds()/86400) for _, acquired, created in rows]
        first_targets[rank] = {"accounts": len(values), "median_days": round(median(values), 2) if values else None}
    return {"window_days": 30, "since": cutoff.isoformat(),
        "ledger": [{"reason": reason, "net": net, "entries": count} for reason, net, count in economy],
        "decisions": [{"source": source, "reason": reason, "status": status, "count": count}
                      for source, reason, status, count in decisions],
        "battle_modes": mode_counts, "patron_selections": patrons, "draws": draws,
        "patron_results": list(patron_results.values()), "hero_presence": heroes, "squad_budgets": budgets,
        "finished_battles": len(durations), "median_battle_seconds": round(median(durations), 1) if durations else None,
        "median_rounds": median(rounds) if rounds else None,
        "practice_accounts_after_limit": len({m.user_id for m in matches if after_cap(m)}),
        "practice_battles_by_capped_accounts": practice_after_cap, "first_acquisition": first_targets}
