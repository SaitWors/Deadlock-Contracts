from __future__ import annotations

import base64
from dataclasses import dataclass
from uuid import UUID

CALLBACK_PREFIX = "dc5"
_CALLBACK_MAX_BYTES = 64
_STATUS_TO_CODE = {"COMPLETED": "c", "FAILED": "f", "VOID": "v"}
_CODE_TO_STATUS = {value: key for key, value in _STATUS_TO_CODE.items()}


class TelegramCallbackCodecError(ValueError):
    pass


@dataclass(frozen=True)
class TelegramCallbackCommand:
    action: str
    review_id: str
    option_id: str | None = None
    status: str | None = None


def _pack_uuid(value: str) -> str:
    try:
        raw = UUID(str(value)).bytes
    except (ValueError, AttributeError, TypeError) as exc:
        raise TelegramCallbackCodecError("invalid UUID") from exc
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unpack_uuid(value: str) -> str:
    if len(value) != 22:
        raise TelegramCallbackCodecError("invalid compact UUID")
    try:
        raw = base64.urlsafe_b64decode(value + "==")
        return str(UUID(bytes=raw))
    except (ValueError, TypeError) as exc:
        raise TelegramCallbackCodecError("invalid compact UUID") from exc


def _bounded(value: str) -> str:
    size = len(value.encode("utf-8"))
    if size < 1 or size > _CALLBACK_MAX_BYTES:
        raise TelegramCallbackCodecError("callback_data exceeds Telegram limit")
    return value


def encode_claim(review_id: str) -> str:
    return _bounded(f"{CALLBACK_PREFIX}:c:{_pack_uuid(review_id)}")


def encode_verdict(review_id: str, option_id: str, status: str) -> str:
    normalized = str(status or "").strip().upper()
    code = _STATUS_TO_CODE.get(normalized)
    if code is None:
        raise TelegramCallbackCodecError("invalid verdict status")
    return _bounded(
        f"{CALLBACK_PREFIX}:v:{_pack_uuid(review_id)}:{_pack_uuid(option_id)}:{code}"
    )


def decode_callback_data(value: str | None) -> TelegramCallbackCommand:
    raw = str(value or "")
    _bounded(raw)
    parts = raw.split(":")
    if len(parts) == 3 and parts[0] == CALLBACK_PREFIX and parts[1] == "c":
        return TelegramCallbackCommand("claim", _unpack_uuid(parts[2]))
    if len(parts) == 5 and parts[0] == CALLBACK_PREFIX and parts[1] == "v":
        status = _CODE_TO_STATUS.get(parts[4])
        if status is None:
            raise TelegramCallbackCodecError("invalid verdict code")
        return TelegramCallbackCommand(
            "verdict",
            _unpack_uuid(parts[2]),
            _unpack_uuid(parts[3]),
            status,
        )
    raise TelegramCallbackCodecError("unsupported callback_data")
