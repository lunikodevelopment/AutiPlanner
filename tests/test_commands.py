"""Tests for the command translation layer.

`apply_command` is the single entry point shared by the Home Assistant services,
the websocket API, and the HTTP API. It is exercised here against a real
`RoutineStore`, which needs no Home Assistant.
"""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from tests import install_package

install_package()

from autiplanner.commands import apply_command  # noqa: E402
from autiplanner.store import RoutineError, RoutineStore  # noqa: E402


def run(coro: object) -> object:
    return asyncio.run(coro)  # type: ignore[arg-type]


class ApplyCommandTest(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.path = Path(self._dir.name) / "routine.ics"
        self.store = RoutineStore(self.path)
        self.store.load()

    def tearDown(self) -> None:
        self._dir.cleanup()

    def _create(self, **payload: object) -> object:
        body = {"uid": "walk@autiplanner.local", "title": "Morning walk", "date": "2026-08-11"}
        body.update(payload)
        return run(apply_command(self.store, "create", body, None, None))

    def test_create_accepts_snake_case(self) -> None:
        item = self._create(day_part="morning", status="pending")
        self.assertEqual(item.day_part, "morning")
        self.assertEqual(item.status, "pending")
        self.assertEqual(item.revision, 0)

    def test_create_accepts_camel_case_from_the_app(self) -> None:
        # The Android app sends the domain model, which is camelCased.
        item = self._create(dayPart="evening", status="pending")
        self.assertEqual(item.day_part, "evening")

    def test_create_defaults_a_missing_status_to_pending(self) -> None:
        item = self._create(day_part="morning")
        self.assertEqual(item.status, "pending")

    def test_create_reports_a_missing_field_as_invalid(self) -> None:
        with self.assertRaises(RoutineError) as caught:
            run(apply_command(self.store, "create", {"uid": "x"}, None, None))
        self.assertEqual(caught.exception.code, "invalid-item")
        self.assertIn("title", str(caught.exception))

    def test_unknown_command_is_an_invalid_item(self) -> None:
        with self.assertRaises(RoutineError) as caught:
            run(apply_command(self.store, "launch", {}, None, None))
        self.assertEqual(caught.exception.code, "invalid-item")

    def test_outcome_commands_target_the_uid(self) -> None:
        self._create(day_part="morning")
        missed = run(
            apply_command(self.store, "mark_missed", {}, "walk@autiplanner.local", None)
        )
        self.assertEqual(missed.status, "missed")
        self.assertIsNone(missed.completed_at)

        completed = run(
            apply_command(
                self.store,
                "complete",
                {"completed_at": "2026-08-11T09:05:00Z"},
                "walk@autiplanner.local",
                None,
            )
        )
        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.completed_at, "2026-08-11T09:05:00Z")

    def test_update_patches_by_uid(self) -> None:
        self._create(day_part="morning")
        updated = run(
            apply_command(
                self.store,
                "update",
                {"title": "Evening walk"},
                "walk@autiplanner.local",
                None,
            )
        )
        self.assertEqual(updated.title, "Evening walk")
        self.assertEqual(updated.status, "pending")

    def test_delete_removes_by_uid(self) -> None:
        self._create(day_part="morning")
        run(apply_command(self.store, "delete", {}, "walk@autiplanner.local", None))
        with self.assertRaises(RoutineError):
            self.store.get("walk@autiplanner.local")

    def test_a_stale_revision_conflicts(self) -> None:
        self._create(day_part="morning")
        run(apply_command(self.store, "mark_missed", {}, "walk@autiplanner.local", None))
        with self.assertRaises(RoutineError) as caught:
            run(
                apply_command(
                    self.store,
                    "complete",
                    {"completed_at": "2026-08-11T09:05:00Z"},
                    "walk@autiplanner.local",
                    0,
                )
            )
        self.assertEqual(caught.exception.code, "conflict")
        self.assertEqual(self.store.get("walk@autiplanner.local").status, "missed")

    def test_add_series(self) -> None:
        run(
            apply_command(
                self.store,
                "add_series",
                {
                    "uid": "meds@autiplanner.local",
                    "title": "Take medication",
                    "date": "2026-08-11",
                    "day_part": "morning",
                    "start": "2026-08-11T08:00:00Z",
                    "recurrence": {"freq": "daily"},
                },
                None,
                None,
            )
        )
        window = self.store.items_for_range("2026-08-11", "2026-08-13")
        self.assertEqual(
            [item.uid for item in window],
            ["meds@autiplanner.local:2026-08-11", "meds@autiplanner.local:2026-08-12"],
        )

    def test_add_series_reports_a_missing_rule(self) -> None:
        with self.assertRaises(RoutineError) as caught:
            run(
                apply_command(
                    self.store,
                    "add_series",
                    {"uid": "x", "title": "t", "date": "2026-08-11", "day_part": "morning"},
                    None,
                    None,
                )
            )
        self.assertEqual(caught.exception.code, "invalid-item")


if __name__ == "__main__":
    unittest.main()
