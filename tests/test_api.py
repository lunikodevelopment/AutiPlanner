"""Tests for the pure HTTP API helpers.

``api.py`` has no Home Assistant imports, so the request validation and payload
shaping are covered here without the HA test harness.
"""

from __future__ import annotations

import unittest

from tests import install_package

install_package()

from autiplanner.api import (  # noqa: E402
    ApiError,
    agenda_payload,
    command_payload,
    error_for,
    error_payload,
    normalize_date,
    normalize_entity_ids,
    normalize_limit,
    parse_command,
)
from autiplanner.model import RoutineItem  # noqa: E402


def sample_item() -> RoutineItem:
    return RoutineItem(
        uid="exercise-20260811@autiplanner.local",
        title="Exercise",
        date="2026-08-11",
        day_part="afternoon",
        status="missed",
        start="2026-08-11T13:30:00Z",
        order=10,
        revision=2,
    )


class LimitTest(unittest.TestCase):
    def test_defaults_and_bounds(self) -> None:
        self.assertEqual(normalize_limit(None), 14)
        self.assertEqual(normalize_limit(1), 1)
        self.assertEqual(normalize_limit(90), 90)
        with self.assertRaises(ApiError):
            normalize_limit(0)
        with self.assertRaises(ApiError):
            normalize_limit(91)

    def test_rejects_non_integers(self) -> None:
        for value in ("14", 1.5, True):
            with self.assertRaises(ApiError):
                normalize_limit(value)


class EntityIdTest(unittest.TestCase):
    def test_accepts_a_string_or_list(self) -> None:
        self.assertEqual(normalize_entity_ids(None), [])
        self.assertEqual(normalize_entity_ids("calendar.routine"), ["calendar.routine"])
        self.assertEqual(
            normalize_entity_ids(["sensor.a", "", "sensor.b"]),
            ["sensor.a", "sensor.b"],
        )

    def test_rejects_other_types(self) -> None:
        with self.assertRaises(ApiError):
            normalize_entity_ids({"entity": "x"})


class DateTest(unittest.TestCase):
    def test_requires_iso_date(self) -> None:
        self.assertIsNone(normalize_date(None, "from"))
        self.assertEqual(normalize_date("2026-08-11", "from"), "2026-08-11")
        for bad in ("11-08-2026", "2026-13-01", "today"):
            with self.assertRaises(ApiError):
                normalize_date(bad, "from")


class CommandTest(unittest.TestCase):
    def test_parses_an_outcome_command(self) -> None:
        request = parse_command(
            {
                "command": "complete",
                "uid": "a@x",
                "completed_at": "2026-08-11T09:05:00Z",
                "expected_revision": 3,
            }
        )
        self.assertEqual(request.command, "complete")
        self.assertEqual(request.uid, "a@x")
        self.assertEqual(request.expected_revision, 3)
        self.assertEqual(request.completed_at, "2026-08-11T09:05:00Z")

    def test_rejects_unknown_commands(self) -> None:
        with self.assertRaises(ApiError):
            parse_command({"command": "destroy", "uid": "a@x"})

    def test_requires_a_uid_for_targeted_commands(self) -> None:
        for command in ("complete", "mark_missed", "skip", "reset", "update", "delete"):
            with self.assertRaises(ApiError):
                parse_command({"command": command})

    def test_create_does_not_require_a_uid(self) -> None:
        request = parse_command({"command": "create", "item": {"uid": "a@x"}})
        self.assertIsNone(request.uid)
        self.assertEqual(request.item, {"uid": "a@x"})

    def test_rejects_a_non_utc_completion(self) -> None:
        with self.assertRaises(ApiError):
            parse_command(
                {
                    "command": "complete",
                    "uid": "a@x",
                    "completed_at": "2026-08-11T09:05:00+02:00",
                }
            )

    def test_rejects_a_negative_revision(self) -> None:
        with self.assertRaises(ApiError):
            parse_command({"command": "reset", "uid": "a@x", "expected_revision": -1})


class PayloadTest(unittest.TestCase):
    def test_item_payload_keeps_the_outcome_and_day_part(self) -> None:
        payload = agenda_payload([sample_item()], revision=4, issues=["x: y"])["items"][0]
        self.assertEqual(payload["status"], "missed")
        self.assertEqual(payload["dayPart"], "afternoon")
        # A missed item never carries a completion timestamp.
        self.assertNotIn("completedAt", payload)
        self.assertNotIn("routineId", payload)
        self.assertEqual(payload["revision"], 2)
        self.assertEqual(payload["start"], "2026-08-11T13:30:00Z")

    def test_agenda_payload_includes_window_and_issues(self) -> None:
        payload = agenda_payload([], revision=0, issues=[], window_start="2026-08-01", window_end="2026-08-15")
        self.assertEqual(payload["items"], [])
        self.assertEqual(payload["windowStart"], "2026-08-01")
        self.assertEqual(payload["windowEnd"], "2026-08-15")

    def test_command_payload_returns_the_item(self) -> None:
        payload = command_payload(sample_item())
        self.assertTrue(payload["success"])
        self.assertEqual(payload["item"]["uid"], "exercise-20260811@autiplanner.local")

    def test_error_mapping(self) -> None:
        self.assertEqual(error_for("not-found", "x")[0], 404)
        self.assertEqual(error_for("conflict", "x")[0], 409)
        self.assertEqual(error_for("conflict", "x")[1]["error"]["code"], "autiplanner_conflict")
        self.assertTrue(error_for("conflict", "x")[1]["success"] is False)
        self.assertEqual(error_for("unknown-code", "x")[0], 500)
        self.assertEqual(
            error_payload("autiplanner_invalid", "bad")["error"]["message"],
            "bad",
        )


if __name__ == "__main__":
    unittest.main()
