from __future__ import annotations

from uuid import UUID

import time
from datetime import datetime, timezone

from sqlalchemy import select

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import (
    AdminUserStatusRequest,
    admin_update_user_status,
    app,
)
from app.models import (
    BoardOption,
    CompanionDevice,
    CompanionPairing,
    Evaluation,
    Match,
    RewardLedgerEntry,
    User,
    AuditLog,
)
from app.services.companion import create_pairing


def paired_headers(client: TestClient) -> dict[str, str]:
    unique = int(time.time_ns() % 1_000_000_000)
    with SessionLocal() as db:
        user = User(
            account_id=8_000_000_000 + unique,
            steam_id64=76_561_198_000_000_000 + unique,
            display_name="Desktop API Test",
            access_role="TESTER",
            public_badges=["EARLY_TESTER"],
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        code, _ = create_pairing(db, user)

    claim = client.post(
        "/api/companion/pairing/claim",
        json={
            "code": code,
            "device_id": f"desktop-api-test-{unique}",
            "label": "Desktop API Test",
            "version": "0.5.0-alpha.2",
        },
        headers={"Origin": "www.overwolf.com://deadlockcontracts"},
    )
    assert claim.status_code == 200
    return {
        "Authorization": f"Bearer {claim.json()['token']}",
        "Origin": "www.overwolf.com://deadlockcontracts",
    }

def test_suspended_user_cannot_claim_pending_pairing() -> None:
    unique = int(time.time_ns() % 1_000_000_000)

    with TestClient(app) as client:
        with SessionLocal() as db:
            user = User(
                account_id=8_100_000_000 + unique,
                steam_id64=76_561_199_000_000_000 + unique,
                display_name="Suspended Pairing Test",
                status="ACTIVE",
            )
            db.add(user)
            db.commit()
            db.refresh(user)

            user_id = user.id
            code, pairing = create_pairing(db, user)
            pairing_hash = pairing.code_hash

            # Код был создан, пока пользователь был ACTIVE,
            # затем аккаунт заблокировали.
            user.status = "SUSPENDED"
            db.commit()

        claim = client.post(
            "/api/companion/pairing/claim",
            json={
                "code": code,
                "device_id": f"suspended-pair-{unique}",
                "label": "Suspended Pairing Test",
                "version": "0.5.2-alpha.3",
            },
            headers={
                "Origin": "www.overwolf.com://deadlockcontracts",
            },
        )

        assert claim.status_code == 403

        with SessionLocal() as db:
            device_count = (
                db.query(CompanionDevice)
                .filter(CompanionDevice.user_id == user_id)
                .count()
            )
            assert device_count == 0

            pending_pairing = db.get(
                CompanionPairing,
                pairing_hash,
            )
            assert pending_pairing is not None
            assert pending_pairing.claimed_at is None

def test_suspending_user_invalidates_pending_pairing_code() -> None:
    unique = int(time.time_ns() % 1_000_000_000)

    with TestClient(app) as client:
        with SessionLocal() as db:
            audit_owner = User(
                account_id=8_200_000_000 + unique,
                steam_id64=76_561_200_000_000_000 + unique,
                display_name="Suspension Audit Owner",
                status="ACTIVE",
            )
            target = User(
                account_id=8_300_000_000 + unique,
                steam_id64=76_561_201_000_000_000 + unique,
                display_name="Pending Pairing Target",
                status="ACTIVE",
            )
            db.add_all([audit_owner, target])
            db.commit()
            db.refresh(audit_owner)
            db.refresh(target)

            target_id = str(target.id)

            code, pairing = create_pairing(db, target)
            pairing_hash = pairing.code_hash

            assert db.get(CompanionPairing, pairing_hash) is not None

            result = admin_update_user_status(
                UUID(target_id),
                AdminUserStatusRequest(
                    status="SUSPENDED",
                    reason="Suspension regression test",
                ),
                audit_owner,
                db,
            )

            assert result["user"]["status"] == "SUSPENDED"

            audit = (
                db.query(AuditLog)
                .filter(
                    AuditLog.user_id == audit_owner.id,
                    AuditLog.action == "admin.user_status_updated",
                    AuditLog.entity_id == target.id,
                )
                .order_by(AuditLog.created_at.desc())
                .first()
            )

            assert audit is not None
            assert audit.data["pairings_invalidated"] == 1

            pending = db.get(
                CompanionPairing,
                pairing_hash,
            )
            assert pending is None

        old_code = client.post(
            "/api/companion/pairing/claim",
            json={
                "code": code,
                "device_id": f"invalidated-pair-{unique}",
                "label": "Invalidated Pairing Test",
                "version": "0.5.2-alpha.3",
            },
            headers={
                "Origin": "www.overwolf.com://deadlockcontracts",
            },
        )

        assert old_code.status_code == 410

def test_desktop_bootstrap_lock_and_reroll_use_bearer_authority() -> None:
    with TestClient(app) as client:
        assert client.get("/api/desktop/v1/bootstrap").status_code == 401
        headers = paired_headers(client)

        bootstrap = client.get("/api/desktop/v1/bootstrap", headers=headers)
        assert bootstrap.status_code == 200
        payload = bootstrap.json()
        assert payload["api_version"] == "desktop.v1"
        assert payload["schema_version"] == 1
        assert set(payload["desktop_features"]) == {
            "adaptive_profiles_v1", "debrief_v1", "personal_progress_v1",
        }
        assert payload["policy"] == {
            "selection_min": 1,
            "selection_max": 3,
            "server_authoritative": True,
            "client_can_settle": False,
            "companion_ingest_enabled": True,
            "reward_settlement_enabled": True,
            "minimum_companion_version": None,
        }
        assert set(payload["adaptive_profiles"]) == {"STANDARD", "RANKED", "STREET_BRAWL"}
        assert all(profile["sample_size"] == 0 for profile in payload["adaptive_profiles"].values())
        assert all(profile["confidence"] == "COLD_START" for profile in payload["adaptive_profiles"].values())
        assert {board["game_match_mode"] for board in payload["boards"]} == {"STANDARD", "RANKED", "STREET_BRAWL"}
        assert all(len(board["options"]) == 6 for board in payload["boards"])

        standard = next(board for board in payload["boards"] if board["game_match_mode"] == "STANDARD")
        selected_id = standard["options"][0]["id"]
        forged = client.post(
            "/api/desktop/v1/boards/lock",
            json={"mode": "STANDARD", "option_ids": [selected_id], "completion": True},
            headers=headers,
        )
        assert forged.status_code == 422

        locked = client.post(
            "/api/desktop/v1/boards/lock",
            json={"mode": "STANDARD", "option_ids": [selected_id]},
            headers=headers,
        )
        assert locked.status_code == 200
        assert locked.json()["board"]["status"] == "LOCKED"
        assert [item["id"] for item in locked.json()["board"]["options"] if item["selected"]] == [selected_id]

        after_lock = client.get("/api/desktop/v1/bootstrap", headers=headers).json()
        active = next(item for item in after_lock["active_cases"] if item["game_match_mode"] == "STANDARD")
        assert [item["id"] for item in active["options"]] == [selected_id]
        assert after_lock["history"]["items"][0]["assignment_id"] == selected_id

        rerolled = client.post("/api/desktop/v1/boards/RANKED/reroll", headers=headers)
        assert rerolled.status_code == 200
        assert rerolled.json()["board"]["generation"] == 1
        assert rerolled.json()["refresh"]["remaining"] == 0
        assert client.post("/api/desktop/v1/boards/STREET_BRAWL/reroll", headers=headers).status_code == 409


def test_desktop_token_respects_account_status() -> None:
    with TestClient(app) as client:
        headers = paired_headers(client)
        assert client.get("/api/desktop/v1/bootstrap", headers=headers).status_code == 200
        token = headers["Authorization"].split(" ", 1)[1]
        from app.services.companion import get_device_by_token

        with SessionLocal() as db:
            device = get_device_by_token(db, token)
            owner = db.get(User, device.user_id)
            assert owner is not None
            owner.status = "SUSPENDED"
            db.commit()
        assert client.get("/api/desktop/v1/bootstrap", headers=headers).status_code == 403

def test_companion_token_rejects_suspended_owner_without_recording_heartbeat() -> None:
    with TestClient(app) as client:
        headers = paired_headers(client)
        token = headers["Authorization"].split(" ", 1)[1]

        from app.models import CompanionEvent
        from app.services.companion import get_device_by_token

        with SessionLocal() as db:
            device = get_device_by_token(db, token)
            device_id = device.id

            owner = db.get(User, device.user_id)
            assert owner is not None

            before_events = (
                db.query(CompanionEvent)
                .filter(CompanionEvent.device_id == device_id)
                .count()
            )

            owner.status = "SUSPENDED"
            db.commit()

        hello = client.get(
            "/api/companion/hello",
            headers=headers,
        )

        heartbeat = client.post(
            "/api/companion/heartbeat",
            json={},
            headers=headers,
        )

        with SessionLocal() as db:
            after_events = (
                db.query(CompanionEvent)
                .filter(CompanionEvent.device_id == device_id)
                .count()
            )

        assert hello.status_code == 403
        assert heartbeat.status_code == 403
        assert after_events == before_events

def test_desktop_history_keeps_retry_attempt_and_uses_reward_ledger() -> None:
    with TestClient(app) as client:
        headers = paired_headers(client)
        payload = client.get("/api/desktop/v1/bootstrap", headers=headers).json()
        standard = next(board for board in payload["boards"] if board["game_match_mode"] == "STANDARD")
        selected_ids = [standard["options"][0]["id"], standard["options"][1]["id"]]
        locked = client.post(
            "/api/desktop/v1/boards/lock",
            json={"mode": "STANDARD", "option_ids": selected_ids},
            headers=headers,
        )
        assert locked.status_code == 200

        token = headers["Authorization"].split(" ", 1)[1]
        from app.services.companion import get_device_by_token

        unique = int(time.time_ns() % 1_000_000_000)
        external_match_id = 90_000_000_000 + unique
        with SessionLocal() as db:
            device = get_device_by_token(db, token)
            owner = db.get(User, device.user_id)
            assert owner is not None
            options = {
                item.id: item
                for item in db.scalars(select(BoardOption).where(BoardOption.id.in_(selected_ids))).all()
            }
            match_started = datetime(2026, 8, 18, 20, 0, tzinfo=timezone.utc)
            match_ended = datetime(2026, 8, 18, 20, 35, tzinfo=timezone.utc)
            match = Match(
                external_match_id=external_match_id,
                provider="desktop-test",
                started_at=match_started,
                ended_at=match_ended,
                game_match_mode="STANDARD",
                mode_classifier_version="desktop-test",
                mode_confidence="HIGH",
                scoring_status="SCORED",
                is_final=True,
            )
            db.add(match)
            db.flush()

            retry_option = options[selected_ids[0]]
            completed_option = options[selected_ids[1]]
            retry_eval = Evaluation(
                assignment_id=retry_option.id,
                match_id=match.id,
                revision=1,
                status="FAILED",
                evidence_level="VERIFIED_SUMMARY",
                evaluator_version="test-evaluator",
                progress_current=3,
                progress_target=5,
                score=0.6,
                explanation="Verified failed attempt with retries remaining.",
            )
            complete_eval = Evaluation(
                assignment_id=completed_option.id,
                match_id=match.id,
                revision=1,
                status="COMPLETED",
                evidence_level="VERIFIED_SUMMARY",
                evaluator_version="test-evaluator",
                progress_current=10,
                progress_target=5,
                score=1.0,
                explanation="Verified completed attempt.",
            )
            db.add_all([retry_eval, complete_eval])
            db.flush()

            # A retryable FAILED evaluation deliberately releases bound_match_id.
            retry_option.final_evaluation_id = retry_eval.id
            retry_option.status = "LOCKED"
            retry_option.bound_match_id = None
            retry_option.progress_current = 3
            retry_option.progress_target = 5
            retry_option.explanation = retry_eval.explanation

            completed_option.final_evaluation_id = complete_eval.id
            completed_option.status = "COMPLETED"
            completed_option.bound_match_id = match.id
            completed_option.settled_at = datetime.now(timezone.utc)
            completed_option.progress_current = 10
            completed_option.progress_target = 5
            completed_option.explanation = complete_eval.explanation
            db.add(
                RewardLedgerEntry(
                    user_id=owner.id,
                    source_type="assignment",
                    source_id=completed_option.id,
                    delta=completed_option.reward_xp,
                    balance_after=int(owner.xp or 0) + completed_option.reward_xp,
                    policy_version="xp-v3",
                )
            )
            db.add(
                RewardLedgerEntry(
                    user_id=owner.id,
                    source_type="ADMIN_ADJUSTMENT",
                    source_id=completed_option.id,
                    delta=999,
                    balance_after=int(owner.xp or 0) + completed_option.reward_xp + 999,
                    policy_version="admin-test",
                )
            )
            db.commit()

        history = client.get("/api/desktop/v1/bootstrap", headers=headers).json()["history"]["items"]
        by_id = {item["assignment_id"]: item for item in history}

        retry_item = by_id[selected_ids[0]]
        assert retry_item["status"] == "LOCKED"
        assert retry_item["match_id"] is None
        assert retry_item["last_attempt_match_id"] == str(external_match_id)
        assert retry_item["latest_evaluation"]["status"] == "FAILED"
        assert retry_item["latest_evaluation"]["match_id"] == str(external_match_id)
        assert retry_item["latest_evaluation"]["match_started_at"] == "2026-08-18T20:00:00" or retry_item["latest_evaluation"]["match_started_at"] == "2026-08-18T20:00:00+00:00"
        assert retry_item["latest_evaluation"]["match_ended_at"] == "2026-08-18T20:35:00" or retry_item["latest_evaluation"]["match_ended_at"] == "2026-08-18T20:35:00+00:00"
        assert retry_item["reward_granted_xp"] == 0

        completed_item = by_id[selected_ids[1]]
        assert completed_item["status"] == "COMPLETED"
        assert completed_item["match_id"] == str(external_match_id)
        assert completed_item["last_attempt_match_id"] == str(external_match_id)
        assert completed_item["match_started_at"] == "2026-08-18T20:00:00" or completed_item["match_started_at"] == "2026-08-18T20:00:00+00:00"
        assert completed_item["match_ended_at"] == "2026-08-18T20:35:00" or completed_item["match_ended_at"] == "2026-08-18T20:35:00+00:00"
        assert completed_item["latest_evaluation"]["status"] == "COMPLETED"
        assert completed_item["reward_granted_xp"] == completed_item["reward_xp"]
        assert completed_item["reward_granted_at"] is not None
