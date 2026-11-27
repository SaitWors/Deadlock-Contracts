"""Install or rotate a Relay node using a SHA-256 digest read from stdin."""

from __future__ import annotations

import argparse
import re
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import AuditLog
from .relay_models import RelayNode


NODE_PATTERN = r"[a-z][a-z0-9-]{0,31}"
HASH_PATTERN = r"[a-f0-9]{64}"


def install_credential(db: Session, node_id: str, token_hash: str, *, friendship_writes: bool = False) -> RelayNode:
    if not re.fullmatch(NODE_PATTERN, node_id) or not re.fullmatch(HASH_PATTERN, token_hash):
        raise ValueError("Invalid node identifier or SHA-256 digest")
    node = db.scalar(select(RelayNode).where(RelayNode.id == node_id).with_for_update())
    action = "rotate"
    if node is None:
        node = RelayNode(id=node_id, enabled=False)
        db.add(node)
        action = "install"
    node.token_hash = token_hash
    node.friendship_writes = friendship_writes
    db.add(AuditLog(action=f"relay.credential_{action}", entity_type="relay_node", entity_id=node_id, data={}))
    db.commit()
    return node


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("node_id")
    parser.add_argument("--friendship-writes", action="store_true")
    args = parser.parse_args()
    digest = sys.stdin.read(128).strip()
    try:
        with SessionLocal() as db:
            node = install_credential(db, args.node_id, digest, friendship_writes=args.friendship_writes)
    except ValueError as error:
        parser.error(str(error))
    print(f"Credential installed for {node.id}. Node enabled: {node.enabled}.")


if __name__ == "__main__":
    main()
