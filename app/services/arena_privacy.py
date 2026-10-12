"""Remove copied arena snapshots in the account-deletion transaction."""
from sqlalchemy import delete, or_, select

from ..battle_models import BattleCommand, BattleMatch
from ..models import User


def purge_account_battles(db, user_id):
    """Purge match recovery copies, including commands owned by surviving peers.

    Battle mutations lock every participant before persisting a response. Holding
    the departing user's row until deletion commits prevents a concurrent command
    from recreating a copied snapshot after this purge. User deletion subsequently
    cascades the authoritative matches/actions and the departing user's commands.
    """
    db.scalar(select(User.id).where(User.id == user_id).with_for_update())
    affected = select(BattleMatch.id).where(or_(BattleMatch.user_id == user_id,
                                                BattleMatch.opponent_user_id == user_id))
    result = db.execute(delete(BattleCommand).where(
        BattleCommand.response["match"]["id"].as_string().in_(affected)
    ).execution_options(synchronize_session="fetch"))
    # The account-deletion caller owns commit/rollback.
    return result.rowcount
