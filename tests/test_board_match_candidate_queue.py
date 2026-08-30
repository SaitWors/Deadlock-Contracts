from types import SimpleNamespace

from sqlalchemy import select

from app.models import BoardMatchCandidate, Job
from app.worker import _capture_or_bind_companion_match, handle_promote_board_match_candidate, store_normalized_match
from tests.test_companion_provisional_binding import (
    _add_board,
    _add_mission,
    _add_option,
    _add_user,
    _new_db,
    _provisional_data,
)


def test_second_match_is_captured_then_promoted_once_previous_attempt_releases():
    db = _new_db()
    with db:
        user = _add_user(db)
        mission = _add_mission(db, key="queue-second")
        board = _add_board(db, user, status="VERIFYING", attempts_used=1)
        first = store_normalized_match(db, _provisional_data(102510635))
        second = store_normalized_match(db, _provisional_data(102528343))
        option = _add_option(db, board, mission, status="VERIFYING", bound_match_id=first.id)
        db.commit()

        state = _capture_or_bind_companion_match(
            db, board, second, capture_source="COMPANION_AUTO"
        )
        assert state == "CAPTURED"
        db.refresh(board)
        assert board.attempts_used == 1
        candidate = db.scalar(
            select(BoardMatchCandidate).where(
                BoardMatchCandidate.board_id == board.id,
                BoardMatchCandidate.match_id == second.id,
            )
        )
        assert candidate is not None
        assert candidate.status == "CAPTURED"
        assert candidate.attempt_no is None

        duplicate = _capture_or_bind_companion_match(
            db, board, second, capture_source="COMPANION_AUTO"
        )
        assert duplicate == "CAPTURED"
        assert len(list(db.scalars(select(BoardMatchCandidate)).all())) == 1
        db.refresh(board)
        assert board.attempts_used == 1

        option.status = "LOCKED"
        option.bound_match_id = None
        board.status = "LOCKED"
        board.baseline_match_id = first.external_match_id
        db.commit()

        promotion = db.scalar(
            select(Job).where(Job.type == "promote_board_match_candidate")
        )
        assert promotion is not None
        handle_promote_board_match_candidate(db, promotion)

        db.refresh(board)
        db.refresh(option)
        db.refresh(candidate)
        assert board.attempts_used == 2
        assert board.status == "VERIFYING"
        assert option.bound_match_id == second.id
        assert option.status == "VERIFYING"
        assert candidate.status == "BOUND"
        assert candidate.attempt_no == 2
