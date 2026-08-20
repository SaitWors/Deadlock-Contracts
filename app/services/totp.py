from __future__ import annotations

import base64
import hashlib
import hmac
import struct
import time

DEFAULT_STEP_SECONDS = 30
DEFAULT_DIGITS = 6


def decode_base32_secret(value: str) -> bytes:
    normalized = "".join(value.split()).upper()
    if not normalized:
        raise ValueError("empty TOTP secret")
    padding = "=" * ((8 - len(normalized) % 8) % 8)
    try:
        secret = base64.b32decode(normalized + padding, casefold=False)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValueError("invalid Base32 TOTP secret") from exc
    if len(secret) < 20:
        raise ValueError("TOTP secret must contain at least 160 bits")
    return secret


def hotp(secret: bytes, counter: int, *, digits: int = DEFAULT_DIGITS) -> str:
    if counter < 0:
        raise ValueError("counter must be non-negative")
    if digits not in {6, 7, 8}:
        raise ValueError("digits must be 6, 7, or 8")
    digest = hmac.new(secret, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = (
        ((digest[offset] & 0x7F) << 24)
        | ((digest[offset + 1] & 0xFF) << 16)
        | ((digest[offset + 2] & 0xFF) << 8)
        | (digest[offset + 3] & 0xFF)
    )
    return str(binary % (10**digits)).zfill(digits)


def time_step(at_time: float | None = None, *, step_seconds: int = DEFAULT_STEP_SECONDS) -> int:
    if step_seconds <= 0:
        raise ValueError("step_seconds must be positive")
    now = time.time() if at_time is None else float(at_time)
    if now < 0:
        raise ValueError("time must be non-negative")
    return int(now // step_seconds)


def verify_totp(
    secret_base32: str,
    code: str,
    *,
    at_time: float | None = None,
    valid_window: int = 1,
    last_accepted_step: int | None = None,
) -> int | None:
    """Return the accepted RFC 6238 time-step, or None.

    A successful time-step is rejected when it is not newer than
    ``last_accepted_step``. This enforces the RFC 6238 one-time-use rule for a
    browser session instead of allowing the same TOTP value to elevate it twice.
    """
    if not code.isdigit() or len(code) != DEFAULT_DIGITS:
        return None
    if valid_window < 0 or valid_window > 2:
        raise ValueError("valid_window must be between 0 and 2")

    secret = decode_base32_secret(secret_base32)
    current = time_step(at_time)

    # Prefer the current step, then the immediately previous/next step. This
    # keeps normal authentication fast while allowing modest clock skew.
    offsets = [0]
    for distance in range(1, valid_window + 1):
        offsets.extend((-distance, distance))

    for offset in offsets:
        candidate_step = current + offset
        if candidate_step < 0:
            continue
        if last_accepted_step is not None and candidate_step <= last_accepted_step:
            continue
        expected = hotp(secret, candidate_step)
        if hmac.compare_digest(expected, code):
            return candidate_step
    return None
