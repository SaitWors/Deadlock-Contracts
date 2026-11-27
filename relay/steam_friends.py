"""Read Steam relationships and accept incoming invitations for the Relay account."""

import base64
import json
import logging
import re
import secrets
import ssl
import time
from dataclasses import dataclass
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, unquote, urlencode
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

from .protocol import NoRedirect, RequestFailed, read_limited, retry_after_seconds


URL = "https://api.steampowered.com/ISteamUser/GetFriendList/v1/"
COMMUNITY = "https://steamcommunity.com"
SESSION_FRIENDS_URL = COMMUNITY + "/textfilter/ajaxgetfriendslist"
LOGGER = logging.getLogger(__name__)
STEAM_ID64_BASE = 76561197960265728
MAX_RESPONSE = 1024 * 1024
REQUEST_RECIPIENT = 2
FRIEND = 3
JWT = re.compile(r"[\w-]+\.[\w-]+\.[\w-]+", re.ASCII)


def steam_id64(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{17}", value):
        raise ValueError("invalid SteamID64")
    if not STEAM_ID64_BASE < int(value) < STEAM_ID64_BASE + 2**32:
        raise ValueError("expected an individual Steam account")
    return value


def _opener():
    return build_opener(ProxyHandler({}), NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))


def _json(opener, request: Request) -> dict:
    try:
        with opener.open(request, timeout=10) as response:
            data = response.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE:
            raise ValueError("Steam response exceeds size limit")
        result = json.loads(data)
        if not isinstance(result, dict):
            raise ValueError("invalid Steam response")
        return result
    except HTTPError as error:
        with error:
            delay = retry_after_seconds(error.headers.get("Retry-After")) if error.headers else 0
        raise RequestFailed(error.code, delay) from None
    except (HTTPException, OSError, ValueError, RecursionError):
        raise RequestFailed() from None


class SteamFriends:
    def __init__(self, account: str, key_file: Path):
        self.account = steam_id64(account)
        self.key_file = key_file
        self.opener = _opener()

    def friend_ids(self) -> set[str]:
        """An unavailable or malformed list raises, including for private profiles."""
        try:
            key = read_limited(self.key_file, 256).decode("ascii").strip()
            if not re.fullmatch(r"[0-9a-fA-F]{32}", key):
                raise ValueError("invalid Steam Web API key")
            query = urlencode({"steamid": self.account, "relationship": "friend"})
            request = Request(URL + "?" + query, headers={"X-WebAPI-Key": key, "Accept": "application/json"})
            rows = _json(self.opener, request)["friendslist"]["friends"]
            if not isinstance(rows, list):
                raise ValueError("invalid Steam friend list")
            friends = set()
            for row in rows:
                if row["relationship"] != "friend":
                    raise ValueError("unexpected Steam relationship")
                friends.add(steam_id64(row["steamid"]))
            return friends
        except (OSError, KeyError, TypeError, ValueError):
            raise RequestFailed() from None


@dataclass(frozen=True)
class SteamRelationships:
    friends: frozenset[str]
    incoming: frozenset[str]
    limit_hit: bool = False


class SteamSession:
    """Use a Steam Community web session without opening a second client or GC login."""

    def __init__(self, account: str, cookie_file: Path):
        self.account = steam_id64(account)
        self.cookie_file = cookie_file
        self.session_id = secrets.token_hex(12)
        self.opener = _opener()

    def _community_credential(self) -> tuple[str, bool]:
        try:
            cookie = unquote(read_limited(self.cookie_file, 8192).decode("ascii").strip())
            account, separator, token = cookie.partition("||")
            if account != self.account or not separator or not JWT.fullmatch(token):
                raise ValueError("invalid Steam session credential")
            payload = token.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            audiences = claims["aud"]
            if claims["sub"] != account or not isinstance(audiences, list) or (
                "web" not in audiences and "web:community" not in audiences
            ):
                raise ValueError("expected web access for the Relay account")
            if type(claims["exp"]) is not int or claims["exp"] <= time.time():
                raise RequestFailed(401)
            return token, "web" in audiences
        except (KeyError, OSError, TypeError, ValueError, AttributeError, RecursionError):
            raise RequestFailed(401) from None

    def _cookie(self, token: str) -> str:
        secure = quote(f"{self.account}||{token}", safe="")
        return f"sessionid={self.session_id}; steamLoginSecure={secure}"

    def relationships(self) -> SteamRelationships:
        try:
            token, _ = self._community_credential()
        except RequestFailed:
            LOGGER.warning("Relay Steam: community credential rejected locally")
            raise
        # The Community endpoint uses the existing browser session directly.
        # /chat/clientjstoken returns a client logon nonce, not a Web API access token.
        request = Request(SESSION_FRIENDS_URL, headers={
            "Accept": "application/json", "Cache-Control": "no-cache", "Cookie": self._cookie(token),
        })
        try:
            reply = _json(self.opener, request)
        except RequestFailed:
            LOGGER.warning("Relay Steam: community relationship request failed")
            raise
        try:
            success = reply.get("success")
            if type(success) not in (int, str) or success not in (1, "1"):
                LOGGER.warning("Relay Steam: community relationship request was not successful")
                raise RequestFailed()
            document = reply["friendslist"]
            if document.get("bincremental", False) is not False:
                raise ValueError("expected a complete Steam relationship snapshot")
            limit_hit = document.get("friends_limit_hit", False)
            if type(limit_hit) is not bool:
                raise ValueError("invalid Steam friendship limit")
            rows = document.get("friends")
            # Require an explicit list: missing fields must not disconnect participants.
            if not isinstance(rows, list):
                raise ValueError("invalid Steam relationship snapshot")
            incoming, friends, seen = set(), set(), set()
            for row in rows:
                account, relation = row["ulfriendid"], row["efriendrelationship"]
                if (
                    not isinstance(account, str) or not re.fullmatch(r"[1-9][0-9]{16,19}", account)
                    or not 0 < int(account) < 2**64 or type(relation) is not int
                ):
                    raise ValueError("invalid Steam relationship")
                if not STEAM_ID64_BASE < int(account) < STEAM_ID64_BASE + 2**32 or account == self.account:
                    continue
                if account in seen:
                    raise ValueError("duplicate Steam relationship")
                seen.add(account)
                if relation == REQUEST_RECIPIENT:
                    incoming.add(account)
                elif relation == FRIEND:
                    friends.add(account)
            return SteamRelationships(frozenset(friends), frozenset(incoming), limit_hit)
        except (AttributeError, KeyError, TypeError, ValueError):
            LOGGER.warning("Relay Steam: invalid community relationship snapshot")
            raise RequestFailed() from None

    def accept_incoming(self, account: str) -> None:
        account = steam_id64(account)
        if account == self.account:
            raise ValueError("a Steam account cannot invite itself")
        token, _ = self._community_credential()
        path = f"{COMMUNITY}/profiles/{self.account}/friends"
        body = urlencode({
            "sessionid": self.session_id, "steamid": self.account, "ajax": "1",
            "action": "accept", "steamids[]": account,
        }).encode("ascii")
        request = Request(f"{path}/action", data=body, headers={
            "Accept": "application/json", "Origin": COMMUNITY, "Referer": f"{path}/pending",
            "Cookie": self._cookie(token),
            "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest",
        })
        # The action only handles inbound requests. Its response never proves that friendship exists.
        _json(self.opener, request)
