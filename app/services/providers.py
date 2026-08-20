from __future__ import annotations

from dataclasses import dataclass
import json
from datetime import datetime, timezone
from typing import Any

import httpx

from ..config import settings
from .normalization import _find_player, classify_mode, normalize_deadlock_match


class ProviderError(RuntimeError):
    pass


@dataclass
class ProviderRateLimited(ProviderError):
    retry_after: int
    message: str = "Превышен лимит запросов к поставщику данных"

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class ProviderResponse:
    payload: Any
    status_code: int
    headers: dict[str, str]


@dataclass(frozen=True)
class HistoryResult:
    matches: list[dict[str, Any]]
    called_steam: bool
    status_code: int
    retry_after: int | None


@dataclass(frozen=True)
class DiscoveryResult:
    match: dict[str, Any] | None
    reason: str
    called_steam: bool
    latest_match_id: int | None
    latest_start_time: int | None


class DeadlockApiProvider:
    def __init__(self) -> None:
        headers = {
            "User-Agent": f"Deadlock-Contracts/{settings.app_version}",
            "Accept": "application/json",
        }
        if settings.deadlock_api_key:
            headers[settings.deadlock_api_key_header] = settings.deadlock_api_key
        timeout = httpx.Timeout(
            settings.request_timeout_seconds,
            connect=settings.request_connect_timeout_seconds,
        )
        self.client = httpx.Client(
            base_url=settings.deadlock_api_base_url,
            headers=headers,
            timeout=timeout,
            follow_redirects=False,
            limits=httpx.Limits(max_connections=5, max_keepalive_connections=2),
        )

    def __enter__(self) -> "DeadlockApiProvider":
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.client.close()

    def _get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        accept_429_fallback: bool = False,
    ) -> ProviderResponse:
        if not path.startswith("/v1/") or ".." in path:
            raise ProviderError("Запрос к недопустимому адресу поставщика данных")
        try:
            with self.client.stream("GET", path, params=params) as response:
                if 300 <= response.status_code < 400:
                    raise ProviderError("Deadlock API вернул неожиданное перенаправление")

                advertised = response.headers.get("Content-Length")
                if advertised:
                    try:
                        if int(advertised) > settings.max_provider_response_bytes:
                            raise ProviderError("Ответ Deadlock API превысил допустимый размер")
                    except ValueError:
                        pass

                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > settings.max_provider_response_bytes:
                        raise ProviderError("Ответ Deadlock API превысил допустимый размер")
                    chunks.append(chunk)
                raw = b"".join(chunks)
                headers = {key.lower(): value for key, value in response.headers.items()}
                status_code = response.status_code
        except ProviderError:
            raise
        except httpx.HTTPError as exc:
            raise ProviderError("Сетевая ошибка при обращении к Deadlock API") from exc

        if status_code == 404:
            return ProviderResponse(None, status_code, headers)

        if status_code == 429 and not accept_429_fallback:
            try:
                retry_after = max(1, min(3600, int(headers.get("retry-after", "60") or 60)))
            except ValueError:
                retry_after = 60
            raise ProviderRateLimited(retry_after=retry_after)

        if status_code >= 400 and not (status_code == 429 and accept_429_fallback):
            raise ProviderError(f"Deadlock API вернул HTTP {status_code}")

        try:
            payload = json.loads(raw) if raw else None
        except (ValueError, TypeError) as exc:
            raise ProviderError("Deadlock API вернул некорректный JSON") from exc
        return ProviderResponse(payload, status_code, headers)

    def history(self, account_id: int, *, force_refetch: bool = False) -> HistoryResult:
        if not 0 <= account_id <= 2**32 - 1:
            raise ProviderError("Некорректный account_id")
        params = {"force_refetch": "true"} if force_refetch else None
        response = self._get(
            f"/v1/players/{account_id}/match-history",
            params=params,
            accept_429_fallback=not force_refetch,
        )
        payload = response.payload
        items: list[dict[str, Any]]
        if payload is None:
            items = []
        elif isinstance(payload, list):
            items = [item for item in payload[:250] if isinstance(item, dict)]
        elif isinstance(payload, dict):
            items = []
            for key in ("matches", "history", "data"):
                value = payload.get(key)
                if isinstance(value, list):
                    items = [item for item in value[:250] if isinstance(item, dict)]
                    break
            else:
                raise ProviderError("Неожиданный формат истории матчей")
        else:
            raise ProviderError("Неожиданный формат истории матчей")

        retry_after: int | None = None
        if response.status_code == 429:
            try:
                retry_after = max(1, min(3600, int(response.headers.get("retry-after", "60") or 60)))
            except ValueError:
                retry_after = 60
        return HistoryResult(
            matches=items,
            called_steam=response.headers.get("called-steam", "false").lower() == "true",
            status_code=response.status_code,
            retry_after=retry_after,
        )

    def rank(self, account_id: int) -> dict[str, Any]:
        """Return the official Valve rank reported by Deadlock API.

        The upstream endpoint reads the badge from the player's latest ranked
        match. It is intentionally separate from Deadlock Contracts XP/levels.
        """
        if not 0 <= account_id <= 2**32 - 1:
            raise ProviderError("Некорректный account_id")
        response = self._get(f"/v1/players/{account_id}/rank")
        if not isinstance(response.payload, dict):
            raise ProviderError("Неожиданный формат ранга Deadlock")
        return response.payload

    def rank_asset(self, tier: int) -> dict[str, Any] | None:
        if not 0 <= tier <= 11:
            return None
        response = self._get(f"/v1/assets/ranks/{tier}")
        return response.payload if isinstance(response.payload, dict) else None

    def rank_image(self, account_id: int, *, image_format: str = "webp") -> tuple[bytes, str] | None:
        if not 0 <= account_id <= 2**32 - 1:
            raise ProviderError("Некорректный account_id")
        if image_format not in {"png", "webp"}:
            raise ProviderError("Некорректный формат изображения ранга")
        path = f"/v1/players/{account_id}/rank/image"
        try:
            with self.client.stream("GET", path, params={"format": image_format}) as response:
                if response.status_code == 404:
                    return None
                if response.status_code >= 400:
                    raise ProviderError(f"Deadlock API вернул HTTP {response.status_code}")
                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                if content_type not in {"image/png", "image/webp"}:
                    raise ProviderError("Deadlock API вернул неожиданный формат изображения ранга")
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > min(settings.max_provider_response_bytes, 2 * 1024 * 1024):
                        raise ProviderError("Изображение ранга превысило допустимый размер")
                    chunks.append(chunk)
                return b"".join(chunks), content_type
        except ProviderError:
            raise
        except httpx.HTTPError as exc:
            raise ProviderError("Сетевая ошибка при получении изображения ранга") from exc

    def metadata(
        self,
        match_id: int,
        *,
        disable_steam: bool = False,
    ) -> dict[str, Any] | None:
        if match_id <= 0:
            raise ProviderError("Некорректный match_id")

        params = (
            {"disable_steam": "true"}
            if disable_steam
            else None
        )

        response = self._get(
            f"/v1/matches/{match_id}/metadata",
            params=params,
        )

        return (
            response.payload
            if isinstance(response.payload, dict)
            else None
        )

    def fetch_match_by_id(
        self,
        account_id: int,
        match_id: int,
        *,
        disable_steam: bool = False,
        consult_history: bool = True,
    ) -> dict[str, Any] | None:
        """Fetch one exact match identified by the local Companion.

        The Match ID is authoritative for candidate selection. Metadata is the
        primary post-match source; the player's stored history is consulted only
        when needed to prove membership or fill basic time/summary fields.
        """
        if not 0 <= account_id <= 2**32 - 1:
            raise ProviderError("Некорректный account_id")
        if match_id <= 0:
            raise ProviderError("Некорректный match_id")
        metadata = self.metadata(
            match_id,
            disable_steam=disable_steam,
        )
        if metadata is None:
            return None

        history_entry: dict[str, Any] = {"match_id": match_id}
        metadata_player = _find_player(metadata, account_id)
        normalized = normalize_deadlock_match(account_id, history_entry, metadata)

        # Newer Deadlock metadata exposes the authoritative match duration
        # directly as match_info.duration_s. The old normalizer mainly relied
        # on player match-history for this value, but exact Companion matches
        # must not be blocked by stale history.
        if normalized.get("duration_s") is None:
            match_info = metadata.get("match_info")

            if isinstance(match_info, dict):
                raw_duration = match_info.get("duration_s")

                try:
                    duration_s = int(raw_duration)
                except (TypeError, ValueError):
                    duration_s = 0

                if 0 < duration_s <= 10000:
                    normalized["duration_s"] = duration_s

        need_history = (
            metadata_player is None
            or normalized.get("started_at") is None
            or normalized.get("duration_s") is None
        )
        history_found = False
        if need_history and consult_history:
            history_result = self.history(account_id, force_refetch=False)
            for entry in history_result.matches:
                try:
                    candidate = int(entry.get("match_id") or entry.get("matchId") or 0)
                except (TypeError, ValueError):
                    continue
                if candidate == match_id:
                    history_entry = entry
                    history_found = True
                    normalized = normalize_deadlock_match(account_id, history_entry, metadata)
                    break
        # Do not bind an arbitrary Match ID unless either metadata contains the
        # player or the player's own history confirms this exact match.
        if metadata_player is None and not history_found:
            return None
        return normalized

    def discover_after(
        self,
        account_id: int,
        locked_at: datetime,
        baseline_match_id: int | None,
        *,
        required_capabilities: set[str] | None = None,
        required_mode: str = "STANDARD",
        force_refetch: bool = False,
    ) -> DiscoveryResult:
        locked = locked_at if locked_at.tzinfo else locked_at.replace(tzinfo=timezone.utc)
        history_result = self.history(account_id, force_refetch=force_refetch)
        required = required_capabilities or set()

        def safe_int(value: Any, default: int = 0) -> int:
            try:
                return int(value)
            except (TypeError, ValueError):
                return default

        history = sorted(
            history_result.matches,
            key=lambda item: (
                safe_int(item.get("start_time") or item.get("startTime")),
                safe_int(item.get("match_id") or item.get("matchId")),
            ),
            reverse=True,
        )
        latest = history[0] if history else None
        latest_match_id = safe_int(latest.get("match_id") or latest.get("matchId")) if latest else None
        latest_start = safe_int(latest.get("start_time") or latest.get("startTime")) if latest else None

        candidates: list[dict[str, Any]] = []
        post_lock_candidates = 0
        for entry in history:
            match_id = safe_int(entry.get("match_id") or entry.get("matchId"))
            start_time = safe_int(entry.get("start_time") or entry.get("startTime"))
            if match_id <= 0 or start_time <= 0:
                continue
            if baseline_match_id is not None and match_id <= baseline_match_id:
                continue
            started = datetime.fromtimestamp(start_time, tz=timezone.utc)
            if started <= locked:
                continue
            post_lock_candidates += 1
            mode, _, _ = classify_mode(entry.get("match_mode"), entry.get("game_mode"))
            if mode == required_mode:
                candidates.append(entry)
                continue
            # Street Brawl has had live-GEP gaps in the field. If Valve changes
            # its numeric enums, an UNKNOWN history row is still worth probing
            # through final metadata for strong brawl markers.
            if required_mode == "STREET_BRAWL" and mode == "UNKNOWN":
                candidates.append(entry)

        candidates.sort(key=lambda item: (safe_int(item.get("start_time")), safe_int(item.get("match_id"))))
        for entry in candidates:
            match_id = safe_int(entry.get("match_id") or entry.get("matchId"))
            # History already carries result, K/D/A, net worth and duration. Normalize it
            # first so contracts that only need those fields do not wait for metadata.
            normalized = normalize_deadlock_match(account_id, entry, None)
            metadata: dict[str, Any] | None = None
            if normalized.get("game_match_mode") != required_mode:
                metadata = self.metadata(match_id)
                if metadata is None:
                    continue
                normalized = normalize_deadlock_match(account_id, entry, metadata)
                if normalized.get("game_match_mode") != required_mode:
                    continue

            missing = required - set(normalized.get("capabilities") or [])
            if missing:
                # Try richer metadata once, but never keep an already identified
                # final match in "waiting" forever just because one metric is
                # absent. Missing facts are handled per-contract by the evaluator
                # and automatically routed to internal review.
                if metadata is None:
                    metadata = self.metadata(match_id)
                if metadata is not None:
                    normalized = normalize_deadlock_match(account_id, entry, metadata)
                    if normalized.get("game_match_mode") != required_mode:
                        continue
                    missing = required - set(normalized.get("capabilities") or [])
            if not normalized["is_final"]:
                continue
            reason = "eligible_match_found" if not missing else "eligible_match_found_with_missing_data:" + ",".join(sorted(missing))
            return DiscoveryResult(normalized, reason, history_result.called_steam, latest_match_id, latest_start)

        if history_result.status_code == 429:
            reason = "Достигнут лимит поставщика: сохранённая история проверена, повторная попытка запланирована"
        elif post_lock_candidates and required_mode == "STREET_BRAWL":
            suffix = " (история кэширована)" if not history_result.called_steam else ""
            reason = "Новые матчи после фиксации уже видны, но Уличная стычка пока не подтверждена по итоговым данным" + suffix
        elif not history_result.called_steam:
            reason = "Поставщик вернул сохранённую историю; новых подходящих матчей после фиксации пока нет"
        else:
            reason = f"Поставщик пока не видит завершённый матч {required_mode} после фиксации контрактов"
        return DiscoveryResult(None, reason, history_result.called_steam, latest_match_id, latest_start)
