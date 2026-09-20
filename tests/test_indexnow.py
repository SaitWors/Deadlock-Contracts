"""No live search submissions: exercise the CLI with bounded HTTP responses."""
import importlib.util
import json
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError

import pytest


@pytest.fixture
def command():
    path = Path(__file__).resolve().parents[1] / "scripts" / "submit_indexnow.py"
    spec = importlib.util.spec_from_file_location("indexnow_command", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASE = "https://deadlock-contracts.online"
KEY = "0123456789abcdef0123456789abcdef"


def test_default_dry_run_performs_no_network_io(command, monkeypatch, capsys):
    def forbidden(*args, **kwargs):
        raise AssertionError("A dry run cannot send or fetch anything")
    monkeypatch.setattr(command, "urlopen", forbidden)
    assert command.main(["--base-url", BASE, "--key", KEY]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["host"] == "deadlock-contracts.online"
    assert result["keyLocation"] == f"{BASE}/{KEY}.txt"
    assert len(result["urlList"]) == 24
    assert BASE + "/en/contracts" in result["urlList"]


@pytest.mark.parametrize("base,key", [("http://deadlock-contracts.online", KEY), (BASE + "/path", KEY), (BASE + "?evil=1", KEY), ("https://name:password@deadlock-contracts.online", KEY), (BASE, "bad/key")])
def test_invalid_origin_or_key_fails_before_network(command, base, key, monkeypatch):
    monkeypatch.setattr(command, "urlopen", lambda *args, **kwargs: pytest.fail("unexpected network request"))
    assert command.main(["--base-url", base, "--key", key, "--submit"]) == 2


@pytest.mark.parametrize("url", [BASE + "/api/me", BASE + "/ru/try", "https://attacker.invalid/ru/", BASE + "/ru/cards?junk=1"])
def test_changed_url_must_be_a_canonical_indexable_document(command, url):
    assert command.main(["--base-url", BASE, "--key", KEY, "--url", url]) == 2


class Reply(BytesIO):
    status = 200


def network(monkeypatch, command, *, key=KEY, status=200, sitemap=None):
    requests = []
    def fetch(request, timeout):
        requests.append(request)
        assert 0 < timeout <= 15
        if request.full_url == f"{BASE}/{KEY}.txt":
            return Reply(key.encode())
        if request.full_url == BASE + "/sitemap.xml":
            return Reply((sitemap or f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>{BASE}/en/cards</loc></url></urlset>').encode())
        assert request.full_url == "https://api.indexnow.org/indexnow"
        assert request.get_method() == "POST"
        data = json.loads(request.data)
        assert data["urlList"] == [BASE + "/en/cards"]
        if status >= 400:
            raise HTTPError(request.full_url, status, "Request rejected", {}, None)
        response = Reply(b"")
        response.status = status
        return response
    monkeypatch.setattr(command, "urlopen", fetch)
    return requests


@pytest.mark.parametrize("status", [200, 202])
def test_submit_verifies_key_and_live_sitemap_before_one_post(command, monkeypatch, status, capsys):
    requests = network(monkeypatch, command, status=status)
    assert command.main(["--base-url", BASE, "--key", KEY, "--url", BASE + "/en/cards", "--submit"]) == 0
    assert [request.get_method() for request in requests] == ["GET", "GET", "POST"]
    assert "index" in capsys.readouterr().out.lower()


@pytest.mark.parametrize("status", [403, 422, 429])
def test_failed_submission_is_not_retried(command, monkeypatch, status):
    requests = network(monkeypatch, command, status=status)
    assert command.main(["--base-url", BASE, "--key", KEY, "--url", BASE + "/en/cards", "--submit"]) == 1
    assert len([request for request in requests if request.get_method() == "POST"]) == 1


def test_wrong_key_prevents_submission(command, monkeypatch):
    requests = network(monkeypatch, command, key="wrong-key")
    assert command.main(["--base-url", BASE, "--key", KEY, "--submit"]) == 1
    assert len(requests) == 1


def test_undeployed_document_prevents_submission(command, monkeypatch):
    requests = network(monkeypatch, command)
    assert command.main(["--base-url", BASE, "--key", KEY, "--url", BASE + "/en/contracts", "--submit"]) == 1
    assert len(requests) == 2
