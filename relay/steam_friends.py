"""Read the Relay account's friend list from the official Steam Web API."""

import json
import re
import ssl
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

from .protocol import NoRedirect, RequestFailed, read_limited, retry_after_seconds


URL = "https://api.steampowered.com/ISteamUser/GetFriendList/v1/"
MAX_RESPONSE = 1024 * 1024


def steam_id64(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{17}", value):
        raise ValueError("invalid SteamID64")
    if not 76561197960265728 < int(value) <= 76561202255233023:
        raise ValueError("expected an individual Steam account")
    return value


class SteamFriends:
    def __init__(self, account: str, key_file: Path):
        self.account = steam_id64(account)
        self.key_file = key_file
        self.opener = build_opener(ProxyHandler({}), NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))

    def friend_ids(self) -> set[str]:
        """An unavailable or malformed list raises, including for private profiles."""
        try:
            key = read_limited(self.key_file, 256).decode("ascii").strip()
            if not re.fullmatch(r"[0-9a-fA-F]{32}", key):
                raise ValueError("invalid Steam Web API key")
            query = urlencode({"steamid": self.account, "relationship": "friend"})
            request = Request(URL + "?" + query, headers={"X-WebAPI-Key": key, "Accept": "application/json"})
            with self.opener.open(request, timeout=10) as response:
                data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise ValueError("Steam friend list exceeds size limit")
            rows = json.loads(data)["friendslist"]["friends"]
            if not isinstance(rows, list):
                raise ValueError("invalid Steam friend list")
            friends = set()
            for row in rows:
                if row["relationship"] != "friend":
                    raise ValueError("unexpected Steam relationship")
                friends.add(steam_id64(row["steamid"]))
            return friends
        except HTTPError as error:
            with error:
                delay = retry_after_seconds(error.headers.get("Retry-After")) if error.headers else 0
            raise RequestFailed(error.code, delay) from None
        except (HTTPException, OSError, KeyError, TypeError, ValueError, RecursionError):
            raise RequestFailed() from None
