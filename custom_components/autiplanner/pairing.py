"""One-time pairing codes.

The app cannot create its own Home Assistant token, and asking a household to
copy a long-lived token is the kind of step AutiPlanner is supposed to avoid.
Instead the integration issues a short-lived, single-use code. The app shows it
to Home Assistant, and Home Assistant hands back a token.

This module holds only the code bookkeeping. It imports no Home Assistant code,
so the rules that matter (expiry and single use) are unit tested directly.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field

#: A code is shown to a human and typed into a phone, so keep it short-lived.
DEFAULT_TTL_SECONDS = 600

#: Enough entropy that guessing is not a concern for a 10 minute window.
CODE_BYTES = 16

#: Bound the number of outstanding codes so a loop cannot grow memory.
MAX_OUTSTANDING = 5


class PairingError(RuntimeError):
    """Raised for client-visible pairing failures."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class PairingCode:
    code: str
    issued_at: float
    expires_at: float
    user_id: str | None = None
    device_name: str | None = None
    redeemed_at: float | None = None

    def is_expired(self, now: float) -> bool:
        return now >= self.expires_at

    @property
    def is_redeemed(self) -> bool:
        return self.redeemed_at is not None


def generate_code() -> str:
    """A URL-safe, high-entropy code. Never derived from time or a counter."""
    return secrets.token_urlsafe(CODE_BYTES)


@dataclass
class PairingRegistry:
    """In-memory codes for one config entry.

    Codes live only in memory on purpose: a restart invalidates them, which is
    the right behaviour for a secret that grants account access.
    """

    ttl_seconds: int = DEFAULT_TTL_SECONDS
    clock: object = field(default=time.monotonic)

    def __post_init__(self) -> None:
        self._codes: dict[str, PairingCode] = {}

    def _now(self) -> float:
        return float(self.clock())  # type: ignore[operator]

    def purge(self) -> None:
        now = self._now()
        self._codes = {k: v for k, v in self._codes.items() if not v.is_expired(now)}

    def issue(self, user_id: str | None = None) -> PairingCode:
        """Issues a new code, dropping the oldest when the limit is reached."""
        self.purge()
        while len(self._codes) >= MAX_OUTSTANDING:
            oldest = min(self._codes.values(), key=lambda entry: entry.issued_at)
            self._codes.pop(oldest.code, None)
        now = self._now()
        record = PairingCode(
            code=generate_code(),
            issued_at=now,
            expires_at=now + self.ttl_seconds,
            user_id=user_id,
        )
        self._codes[record.code] = record
        return record

    def redeem(self, code: str | None, device_name: str | None = None) -> PairingCode:
        """Consumes a code. A second attempt with the same code fails."""
        if not code or not isinstance(code, str):
            raise PairingError("pairing_code_invalid", "A pairing code is required")
        now = self._now()
        # Look the code up before purging so an expired code can report expiry
        # instead of looking like a code that never existed.
        record = self._codes.get(code.strip())
        if record is not None and record.is_expired(now):
            self._codes.pop(record.code, None)
            raise PairingError("pairing_code_expired", "That pairing code has expired")
        if record is not None and record.is_redeemed:
            raise PairingError("pairing_code_used", "That pairing code was already used")
        self.purge()
        if record is None:
            raise PairingError("pairing_code_invalid", "That pairing code is not valid")
        record.redeemed_at = now
        record.device_name = device_name
        self._codes.pop(record.code, None)
        return record

    def outstanding(self) -> int:
        self.purge()
        return len(self._codes)
