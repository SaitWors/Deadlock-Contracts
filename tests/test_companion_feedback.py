from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app
from app.models import AuditLog


def test_uninstall_survey_accepts_only_known_anonymous_feedback(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'feedback.db'}")
    AuditLog.__table__.create(engine)

    def database():
        with Session(engine) as session:
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_db, database)
    try:
        client = TestClient(app)
        survey = client.get("/companion/uninstall")
        assert survey.status_code == 200
        assert 'name="reason"' in survey.text
        assert "noindex" in survey.headers["x-robots-tag"]

        url = "/api/feedback/companion-uninstall"
        assert client.post(url, data={"reason": "unknown"}).status_code == 422
        assert client.post(url, data={"reason": "setup"}, headers={"Origin": "https://example.org"}).status_code == 403
        response = client.post(url, data={"reason": "setup"})
        assert response.history[0].status_code == 303
        assert "Thanks for your feedback" in response.text
        with Session(engine) as session:
            entry = session.scalars(select(AuditLog)).one()
            assert entry.action == "companion.uninstall_feedback"
            assert entry.user_id is None and entry.data == {"reason": "setup"}
    finally:
        engine.dispose()
