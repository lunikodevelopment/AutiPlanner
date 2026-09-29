"""Tests for one-time pairing codes."""

from __future__ import annotations

import unittest

from tests import install_package

install_package()

from autiplanner.pairing import (  # noqa: E402
    MAX_OUTSTANDING,
    PairingError,
    PairingRegistry,
    generate_code,
)


class FakeClock:
    def __init__(self, value: float = 1000.0) -> None:
        self.value = value

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def registry(ttl: int = 600) -> tuple[PairingRegistry, FakeClock]:
    clock = FakeClock()
    return PairingRegistry(ttl_seconds=ttl, clock=clock), clock


class CodeTest(unittest.TestCase):
    def test_codes_are_random_and_url_safe(self) -> None:
        codes = {generate_code() for _ in range(50)}
        self.assertEqual(len(codes), 50)
        for code in codes:
            self.assertGreaterEqual(len(code), 20)
            self.assertNotIn(" ", code)
            self.assertNotIn("/", code.replace("-", "").replace("_", ""))


class RedeemTest(unittest.TestCase):
    def test_a_code_can_be_redeemed_once(self) -> None:
        reg, _ = registry()
        issued = reg.issue(user_id="user-1")
        redeemed = reg.redeem(issued.code, device_name="Pixel")
        self.assertEqual(redeemed.user_id, "user-1")
        self.assertEqual(redeemed.device_name, "Pixel")

        with self.assertRaises(PairingError) as caught:
            reg.redeem(issued.code)
        self.assertEqual(caught.exception.code, "pairing_code_invalid")

    def test_an_expired_code_is_rejected(self) -> None:
        reg, clock = registry(ttl=60)
        issued = reg.issue()
        clock.advance(61)
        with self.assertRaises(PairingError) as caught:
            reg.redeem(issued.code)
        self.assertEqual(caught.exception.code, "pairing_code_expired")

    def test_a_code_is_valid_just_before_it_expires(self) -> None:
        reg, clock = registry(ttl=60)
        issued = reg.issue()
        clock.advance(59)
        self.assertEqual(reg.redeem(issued.code).code, issued.code)

    def test_unknown_and_empty_codes_are_rejected(self) -> None:
        reg, _ = registry()
        reg.issue()
        for value in (None, "", "   ", "not-a-real-code"):
            with self.assertRaises(PairingError):
                reg.redeem(value)

    def test_a_wrong_code_does_not_consume_a_real_one(self) -> None:
        reg, _ = registry()
        issued = reg.issue()
        with self.assertRaises(PairingError):
            reg.redeem("wrong")
        self.assertEqual(reg.redeem(issued.code).code, issued.code)

    def test_surrounding_whitespace_is_tolerated(self) -> None:
        reg, _ = registry()
        issued = reg.issue()
        self.assertEqual(reg.redeem(f"  {issued.code}  ").code, issued.code)

    def test_outstanding_codes_are_capped(self) -> None:
        reg, _ = registry()
        codes = [reg.issue().code for _ in range(MAX_OUTSTANDING + 3)]
        self.assertLessEqual(reg.outstanding(), MAX_OUTSTANDING)
        # The newest codes survive; the oldest is evicted.
        self.assertIsNotNone(reg.redeem(codes[-1]))

    def test_purging_removes_expired_codes(self) -> None:
        reg, clock = registry(ttl=10)
        reg.issue()
        self.assertEqual(reg.outstanding(), 1)
        clock.advance(11)
        self.assertEqual(reg.outstanding(), 0)


if __name__ == "__main__":
    unittest.main()
