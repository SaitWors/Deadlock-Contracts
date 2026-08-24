from __future__ import annotations

import argparse

from .config import settings
from .db import SessionLocal
from .services.boards import upgrade_offered_boards_to_contracts_v2


def upgrade_offered_boards() -> int:
    """Run the idempotent offered-board content migration explicitly.

    This used to execute during every web-process startup. Keeping it as a
    deployment/maintenance command avoids hidden bulk writes in the HTTP
    lifecycle and makes the operation observable and repeatable.
    """
    settings.validate()
    with SessionLocal() as db:
        try:
            upgraded = upgrade_offered_boards_to_contracts_v2(db)
            db.commit()
        except Exception:
            db.rollback()
            raise
    return upgraded


def main() -> int:
    parser = argparse.ArgumentParser(description="Deadlock Contracts maintenance commands")
    parser.add_argument("command", choices=("upgrade-offered-boards",))
    args = parser.parse_args()

    if args.command == "upgrade-offered-boards":
        upgraded = upgrade_offered_boards()
        print(f"[maintenance] upgraded offered boards: {upgraded}")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
