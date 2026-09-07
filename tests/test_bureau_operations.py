from datetime import timedelta
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.models import (BoardOption, BureauApplication, BureauBan, BureauContribution, BureauContributionEvent,
    BureauMembershipPeriod, BureauOperation, BureauOperationParticipant, Evaluation, Match,
    PlayerBureau, RewardLedgerEntry, SessionToken, User, utcnow)
from app.services import bureau_operations as operations
from app.services.auth import COOKIE_NAME, hash_token
from test_player_community import community, contract, create_bureau  # shared real-session fixture


def setup_operation(community, template="city_cases"):
    factory, player = community
    people = [player(f"Operative {i}") for i in range(5)]
    owner = people[0][1]
    create_bureau(owner, recruitment="OPEN")
    for _, client in people[1:]:
        assert client.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True}).status_code == 200
    response = owner.post("/api/bureaus/deadlock-night/operations", json={"template": template, "days": 3})
    assert response.status_code == 200, response.text
    operation_id = response.json()["operation"]["id"]
    with factory() as db:
        operation = db.get(BureauOperation, operation_id)
        operation.started_at = utcnow() - timedelta(days=2)
        for period in db.scalars(select(BureauMembershipPeriod)):
            period.joined_at = utcnow() - timedelta(days=3)
        db.commit()
    return factory, people, operation_id


def verified(db, user_id, index=0, *, category="COMBAT", signed=None, ended=None, reward=True, gep=False):
    option = contract(db, user_id, index, category=category, reward=reward)
    option.locked_at = signed or utcnow() - timedelta(hours=3)
    match = Match(external_match_id=uuid4().int % 10**14, provider="deadlock_api",
        mode_classifier_version="test", started_at=option.locked_at + timedelta(minutes=10),
        ended_at=ended or utcnow() - timedelta(hours=1), is_final=True,
        integrity_status="CLIENT_ATTESTED_GEP" if gep else "LEGACY_DIAGNOSTIC")
    db.add(match); db.flush()
    evaluation = Evaluation(assignment_id=option.id, match_id=match.id, status="COMPLETED",
                            evaluator_version="test", explanation="Verified")
    db.add(evaluation); db.flush()
    option.bound_match_id, option.final_evaluation_id = match.id, evaluation.id
    return option


def recalculate(factory, operation_id):
    with factory() as db:
        operation = db.get(BureauOperation, operation_id)
        operations.reconcile(db, operation)
        db.commit()
        return operation


def team_items(client):
    return {item["id"]: item for item in client.get("/api/achievements").json()["items"] if item["id"].startswith("team_")}


def elevate(factory, user_id, client, *, elevated=True, role="MODERATOR"):
    with factory() as db:
        db.get(User, user_id).access_role = role
        session = db.get(SessionToken, hash_token(client.cookies.get(COOKIE_NAME)))
        session.admin_verified_at = utcnow() if elevated else None
        db.commit()


def test_verified_contribution_is_idempotent_and_corrected_seals_follow_verdicts(community):
    factory, people, operation_id = setup_operation(community)
    option_ids = []
    with factory() as db:
        for i in range(20):
            option = verified(db, people[i % 3][0], i)
            option_ids.append(option.id)
        db.commit()
        xp_before = db.scalar(select(func.sum(RewardLedgerEntry.delta)))
    assert recalculate(factory, operation_id).status == "COMPLETED"
    recalculate(factory, operation_id)
    assert team_items(people[0][1])["team_city_cases"]["earned"]
    assert not team_items(people[4][1])["team_city_cases"]["earned"]
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(BureauContribution)) == 20
        assert db.scalar(select(func.count()).select_from(BureauContributionEvent)) == 20
        assert db.scalar(select(func.sum(RewardLedgerEntry.delta))) == xp_before
        db.get(BoardOption, option_ids[0]).status = "FAILED"
        db.commit()
    assert recalculate(factory, operation_id).status == "CORRECTED"
    assert not team_items(people[0][1])["team_city_cases"]["earned"]
    with factory() as db:
        db.get(BoardOption, option_ids[0]).status = "COMPLETED"
        db.commit()
    assert recalculate(factory, operation_id).status == "COMPLETED"
    with factory() as db:
        item = db.scalar(select(BureauContribution).where(BureauContribution.source_key == option_ids[0]))
        assert list(db.scalars(select(BureauContributionEvent.action).where(BureauContributionEvent.contribution_id == item.id)
                              .order_by(BureauContributionEvent.revision))) == ["CREDIT", "REVOKE", "RESTORE"]
    member_data = people[1][1].get("/api/bureaus/deadlock-night/operations").json()["items"][0]
    assert member_data["my_contribution"] == 7
    assert len(member_data["journal"]) == 7
    assert option_ids[0] not in str(member_data)


def test_windows_membership_trust_and_category_are_all_required(community):
    factory, people, operation_id = setup_operation(community, "field_hospital")
    user_id = people[0][0]
    with factory() as db:
        verified(db, user_id, 0, category="SUPPORT")  # only eligible one
        verified(db, user_id, 1, category="COMBAT")
        verified(db, user_id, 2, category="SUPPORT", gep=True)
        verified(db, user_id, 3, category="SUPPORT", reward=False)
        verified(db, user_id, 4, category="SUPPORT", signed=utcnow() - timedelta(days=4))
        verified(db, user_id, 5, category="SUPPORT", ended=utcnow() + timedelta(days=4))
        option = verified(db, user_id, 6, category="SUPPORT")
        db.get(Evaluation, option.final_evaluation_id).status = "FAILED"
        option = verified(db, people[1][0], 7, category="SUPPORT")
        period = db.scalar(select(BureauMembershipPeriod).where(BureauMembershipPeriod.user_id == people[1][0]))
        period.joined_at = utcnow() - timedelta(minutes=30)
        db.commit()
    result = recalculate(factory, operation_id)
    assert result.progress == 1 and result.contributors == 1 and result.status == "ACTIVE"


def test_minimum_people_and_distinct_contributor_goal(community):
    factory, people, operation_id = setup_operation(community, "five_witnesses")
    with factory() as db:
        for i in range(5):
            verified(db, people[0][0], i)
        db.commit()
    assert recalculate(factory, operation_id).progress == 1
    with factory() as db:
        for user_id, _ in people[1:]:
            verified(db, user_id)
        db.commit()
    assert recalculate(factory, operation_id).status == "COMPLETED"
    assert all(team_items(client)["team_five_witnesses"]["earned"] for _, client in people)
    saved = people[0][1].put("/api/profile/public", json={"slug": "team-profile", "is_public": True,
        "featured_achievement": "team_five_witnesses"})
    assert saved.status_code == 200, saved.text
    assert people[0][1].get("/api/public/profiles/team-profile").json()["profile"]["featured_achievement"] == "team_five_witnesses"


def test_late_verification_survives_leaving_and_rejoining_without_duplicate_credit(community):
    factory, people, operation_id = setup_operation(community)
    user_id, client = people[1]
    with factory() as db:
        option = verified(db, user_id)
        option_id = option.id
        option.status = "REVIEW_REQUIRED"
        db.commit()
    assert client.post("/api/bureaus/deadlock-night/leave").status_code == 200
    assert client.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True}).status_code == 200
    with factory() as db:
        operation = db.get(BureauOperation, operation_id)
        operation.ends_at = utcnow() - timedelta(minutes=30)
        db.get(BoardOption, option_id).status = "COMPLETED"
        db.commit()
    assert recalculate(factory, operation_id).progress == 1
    assert recalculate(factory, operation_id).progress == 1
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(BureauMembershipPeriod).where(BureauMembershipPeriod.user_id == user_id)) == 2


def test_operation_access_start_overlap_cancel_and_csrf(community):
    factory, people, operation_id = setup_operation(community)
    _, outsider = community[1]()
    url = "/api/bureaus/deadlock-night/operations"
    assert outsider.get(url).status_code == 403
    assert people[1][1].post(url, json={"template": "city_cases"}).status_code == 403
    assert people[0][1].post(url, json={"template": "city_cases"}).status_code == 409
    assert people[0][1].post(url, json={"template": "city_cases", "target": 1}).status_code == 422
    assert people[0][1].post(url, json={"template": "city_cases"}, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    cancel_url = f"{url}/{operation_id}/cancel"
    assert people[1][1].post(cancel_url, json={"reason": "Stop please"}).status_code == 403
    assert people[0][1].post(cancel_url, json={"reason": "Change of plans"}).status_code == 200
    assert people[0][1].post(url, json={"template": "city_cases", "days": 1}).status_code == 200


def test_ban_rejoining_appeal_privacy_totp_and_lift(community):
    factory, player = community
    owner_id, owner = player("Director")
    user_id, client = player("Private complainant")
    staff_id, staff = player("Site moderator")
    create_bureau(owner, recruitment="OPEN")
    result = client.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True}).json()["bureau"]
    member = next(item for item in result["members"] if item["is_me"])
    url = "/api/bureaus/deadlock-night"
    assert owner.post(f"{url}/members/{member['id']}", json={"action": "BAN", "reason": "Repeated spam"}).status_code == 200
    assert client.post(f"{url}/join", json={"agree_rules": True}).status_code == 403
    assert client.get(url).json()["bureau"]["my_ban"]["reason"] == "Repeated spam"
    with factory() as db:
        bureau = db.scalar(select(PlayerBureau).where(PlayerBureau.slug == "deadlock-night"))
        application = BureauApplication(bureau_id=bureau.id, user_id=user_id, message="Pending before ban")
        db.add(application); db.flush(); application_id = application.id; db.commit()
    assert owner.post(f"{url}/applications/{application_id}", json={"decision": "ACCEPT"}).status_code == 403
    report = client.post(f"{url}/reports", json={"kind": "BAN_APPEAL", "message": "Private appeal message"}).json()["report"]
    assert "Private appeal message" not in owner.get(url).text
    assert owner.get("/api/bureau-reports").json()["items"] == []
    assert owner.get("/api/admin/bureau-reports").status_code == 403
    elevate(factory, staff_id, staff, elevated=False)
    assert staff.get("/api/admin/bureau-reports").status_code == 403
    elevate(factory, staff_id, staff)
    assert staff.get("/api/admin/bureau-reports").json()["items"][0]["message"] == "Private appeal message"
    decision_url = f"/api/admin/bureau-reports/{report['id']}/decision"
    payload = {"revision": 1, "action": "LIFT_BAN", "note": "Evidence supports lifting this ban."}
    assert staff.post(decision_url, json=payload, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert staff.post(decision_url, json=payload).status_code == 200
    assert staff.post(decision_url, json=payload).status_code == 409
    assert client.get("/api/bureau-reports").json()["items"][0]["decision"] == "LIFT_BAN"
    assert client.post(f"{url}/join", json={"agree_rules": True}).status_code == 200
    elevate(factory, owner_id, owner)
    own_report = owner.post(f"{url}/reports", json={"message": "Self report test message"}).json()["report"]
    assert owner.post(f"/api/admin/bureau-reports/{own_report['id']}/decision", json={**payload, "action": "DISMISS"}).status_code == 403


def test_freeze_appeal_restore_hides_directory_and_cancels_operations(community):
    factory, people, operation_id = setup_operation(community)
    outsider_id, outsider = community[1]()
    staff_id, staff = community[1]()
    elevate(factory, staff_id, staff)
    url = "/api/bureaus/deadlock-night"
    report = outsider.post(url + "/reports", json={"message": "Please review these bureau rules"}).json()["report"]
    result = staff.post(f"/api/admin/bureau-reports/{report['id']}/decision", json={"revision": 1, "action": "FREEZE", "note": "Please revise the bureau rules."})
    assert result.status_code == 200, result.text
    assert outsider.get("/api/bureaus").json()["items"] == []
    assert outsider.get(url).status_code == 404
    assert people[0][1].get("/api/bureaus").json()["my_bureau"]["status"] == "FROZEN"
    assert outsider.post(url + "/join", json={"agree_rules": True}).status_code == 409
    assert people[0][1].post(url + "/operations", json={"template": "city_cases"}).status_code == 409
    leaving = people[1][1].post(url + "/leave")
    assert leaving.status_code == 200 and leaving.json()["left"] is True
    with factory() as db:
        assert db.get(BureauOperation, operation_id).status == "CANCELLED"
    appeal = people[0][1].post(url + "/reports", json={"kind": "BUREAU_APPEAL", "message": "We have revised our bureau rules"}).json()["report"]
    assert staff.post(f"/api/admin/bureau-reports/{appeal['id']}/decision", json={"revision": 1, "action": "RESTORE", "note": "Changes reviewed and accepted."}).status_code == 200
    assert outsider.get("/api/bureaus").json()["total"] == 1


def test_deleting_account_anonymizes_credit_and_disband_preserves_completed_seal(community):
    factory, people, operation_id = setup_operation(community, "five_witnesses")
    with factory() as db:
        for user_id, _ in people:
            verified(db, user_id)
        db.commit()
    recalculate(factory, operation_id)
    # Exercise the same bureau lifecycle called before deleting an account.
    from app.services.bureaus import leave_for_account_deletion
    with factory() as db:
        leave_for_account_deletion(db, people[1][0])
        db.execute(delete(User).where(User.id == people[1][0])); db.commit()
        assert db.scalar(select(BureauOperationParticipant).where(BureauOperationParticipant.user_id.is_(None)))
    assert recalculate(factory, operation_id).progress == 5
    assert people[0][1].request("DELETE", "/api/bureaus/deadlock-night", json={"confirmation": "deadlock-night"}).status_code == 200
    assert team_items(people[0][1])["team_five_witnesses"]["earned"]
    with factory() as db:
        assert db.get(BureauOperation, operation_id).bureau_id is None
        participant = db.scalar(select(BureauOperationParticipant).where(BureauOperationParticipant.user_id == people[0][0]))
        contribution = db.scalar(select(BureauContribution).where(BureauContribution.participant_id == participant.id))
        db.get(BoardOption, contribution.source_option_id).status = "FAILED"
        db.commit()
    operations.maintenance(factory)
    assert not team_items(people[0][1])["team_five_witnesses"]["earned"]


def test_report_duplicate_rate_limit_and_lift_cannot_target_new_ban(community):
    factory, player = community
    _, owner = player(); user_id, client = player(); staff_id, staff = player()
    create_bureau(owner, recruitment="OPEN")
    client.post("/api/bureaus/deadlock-night/join", json={"agree_rules": True})
    bureau = owner.get("/api/bureaus/deadlock-night").json()["bureau"]
    member = next(m for m in bureau["members"] if not m["is_me"])
    owner.post(f"/api/bureaus/deadlock-night/members/{member['id']}", json={"action": "BAN", "reason": "Repeated spam"})
    report_url = "/api/bureaus/deadlock-night/reports"
    body = {"kind": "BAN_APPEAL", "message": "Please review my membership ban"}
    first = client.post(report_url, json=body).json()["report"]
    assert client.post(report_url, json=body).json()["report"]["id"] == first["id"]
    with factory() as db:
        ban = db.scalar(select(BureauBan).where(BureauBan.user_id == user_id))
        ban.created_at = utcnow() + timedelta(seconds=1); db.commit()
    elevate(factory, staff_id, staff)
    assert staff.post(f"/api/admin/bureau-reports/{first['id']}/decision", json={"revision": 1, "action": "LIFT_BAN", "note": "Review of the original incident"}).status_code == 409
    # Closed reports still count toward the rolling daily quota.
    for index in range(4):
        response = client.post(report_url, json={"message": f"Report message number {index}"})
        assert response.status_code == 200
        report_id = response.json()["report"]["id"]
        assert staff.post(f"/api/admin/bureau-reports/{report_id}/decision", json={"revision": 1, "action": "DISMISS", "note": "Reviewed: no action needed."}).status_code == 200
    assert client.post(report_url, json={"message": "Sixth report for this day"}).status_code == 429
