"""Command dispatch tests.

These exercise the command layer the services and the websocket API both use,
including the four-state outcomes, revisions, and the create/update/delete
vocabulary from `docs/ARCHITECTURE.md`.
"""

from __future__ import annotations

import asyncio
import unittest

from tests import install_package

install_package()

from autiplanner.model import RecurrenceRule, RoutineItem, RoutineTemplate  # noqa: E402
from autiplanner.store import RoutineError, RoutineStore  # noqa: E402

import tempfile  # noqa: E402
from pathlib import Path  # noqa: E402


def run(coro: object) -> object:
    return asyncio.run(coro)  # type: ignore[arg-type]


def new_item(**overrides: object) -> RoutineItem:
    base = {
        "uid": "new@autiplanner.local",
        "title": "Morning walk",
        "date": "2026-08-11",
        "day_part": "morning",
        "status": "pending",
    }
    base.update(overrides)
    return RoutineItem(**base)  # type: ignore[arg-type]


class DispatchTest(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.path = Path(self._dir.name) / "routine.ics"
        self.store = RoutineStore(self.path)
        self.store.load()

    def tearDown(self) -> None:
        self._dir.cleanup()

    def test_create_starts_at_revision_zero(self) -> None:
        created = run(self.store.create(new_item()))
        self.assertEqual(created.revision, 0)
        self.assertEqual(created.status, "pending")
        self.assertEqual(self.store.get("new@autiplanner.local").title, "Morning walk")

    def test_create_rejects_an_unknown_day_part(self) -> None:
        with self.assertRaises(RoutineError) as caught:
            run(self.store.create(new_item(day_part="midday")))
        self.assertEqual(caught.exception.code, "invalid-item")

    def test_update_bumps_revision_and_clears_optional_fields(self) -> None:
        created = run(self.store.create(new_item(start="2026-08-11T09:00:00Z", order=10)))
        updated = run(
            self.store.update(
                "new@autiplanner.local",
                {"title": "Evening walk", "start": None, "order": None},
            )
        )
        self.assertEqual(updated.title, "Evening walk")
        self.assertIsNone(updated.start)
        self.assertIsNone(updated.order)
        self.assertEqual(updated.revision, 1)
        self.assertEqual(created.revision, 0)

    def test_update_cannot_change_uid(self) -> None:
        run(self.store.create(new_item()))
        with self.assertRaises(RoutineError):
            run(self.store.update("new@autiplanner.local", {"uid": "other@x"}))

    def test_update_rejects_an_unknown_field(self) -> None:
        run(self.store.create(new_item()))
        with self.assertRaises(RoutineError):
            run(self.store.update("new@autiplanner.local", {"routine_id": "x"}))

    def test_update_cannot_clear_a_required_field(self) -> None:
        run(self.store.create(new_item()))
        with self.assertRaises(RoutineError):
            run(self.store.update("new@autiplanner.local", {"title": None}))

    def test_outcome_cycle_returns_to_pending(self) -> None:
        run(self.store.create(new_item()))
        uid = "new@autiplanner.local"
        run(self.store.complete(uid, "2026-08-11T09:05:00Z"))
        self.assertEqual(self.store.get(uid).status, "completed")
        run(self.store.mark_missed(uid))
        self.assertEqual(self.store.get(uid).status, "missed")
        self.assertIsNone(self.store.get(uid).completed_at)
        run(self.store.skip(uid))
        self.assertEqual(self.store.get(uid).status, "skipped")
        run(self.store.reset(uid))
        self.assertEqual(self.store.get(uid).status, "pending")
        self.assertEqual(self.store.get(uid).revision, 4)

    def test_repeating_an_outcome_does_not_bump_revision(self) -> None:
        run(self.store.create(new_item()))
        uid = "new@autiplanner.local"
        first = run(self.store.mark_missed(uid))
        again = run(self.store.mark_missed(uid))
        self.assertEqual(first.revision, 1)
        self.assertEqual(again.revision, 1)

    def test_delete_removes_the_item_and_the_record(self) -> None:
        run(self.store.create(new_item()))
        run(self.store.delete("new@autiplanner.local"))
        with self.assertRaises(RoutineError):
            self.store.get("new@autiplanner.local")
        self.assertNotIn("new@autiplanner.local", self.path.read_text(encoding="utf-8"))

    def test_add_series_persists_and_expands(self) -> None:
        run(
            self.store.add_series(
                RoutineTemplate(
                    uid="walk@x",
                    title="Morning walk",
                    day_part="morning",
                    date="2026-08-10",
                    start="2026-08-10T09:00:00Z",
                    recurrence=RecurrenceRule(freq="weekly", by_day=("MO", "WE", "FR")),
                )
            )
        )
        self.assertIn("RRULE", self.path.read_text(encoding="utf-8"))
        window = self.store.items_for_range("2026-08-10", "2026-08-13")
        self.assertEqual([entry.date for entry in window], ["2026-08-10", "2026-08-12"])

    def test_duplicate_series_uid_is_rejected(self) -> None:
        template = RoutineTemplate(
            uid="walk@x",
            title="Walk",
            day_part="morning",
            date="2026-08-10",
            recurrence=RecurrenceRule(freq="daily"),
        )
        run(self.store.add_series(template))
        with self.assertRaises(RoutineError):
            run(self.store.add_series(template))

    def test_occurrence_is_materialized_on_first_write_only(self) -> None:
        run(
            self.store.add_series(
                RoutineTemplate(
                    uid="meds@x",
                    title="Take medication",
                    day_part="morning",
                    date="2026-08-11",
                    start="2026-08-11T08:00:00Z",
                    recurrence=RecurrenceRule(freq="daily"),
                )
            )
        )
        uid = "meds@x:2026-08-12"
        run(self.store.complete(uid, "2026-08-12T08:05:00Z"))
        stored = self.store.get(uid)
        self.assertEqual(stored.status, "completed")
        self.assertEqual(stored.day_part, "morning")
        self.assertEqual(stored.routine_id, "meds@x")
        # Only that occurrence was written.
        self.assertEqual(len(self.store.snapshot()), 1)
        # The next occurrence is still generated as pending.
        later = self.store.items_for_range("2026-08-13", "2026-08-14")
        self.assertEqual([entry.status for entry in later], ["pending"])

    def test_occurrence_outside_the_rule_cannot_be_written(self) -> None:
        run(
            self.store.add_series(
                RoutineTemplate(
                    uid="meds@x",
                    title="Take medication",
                    day_part="morning",
                    date="2026-08-10",
                    start="2026-08-10T08:00:00Z",
                    recurrence=RecurrenceRule(freq="weekly", by_day=("MO",)),
                    exdates=("2026-08-17",),
                )
            )
        )
        with self.assertRaises(RoutineError):
            run(self.store.mark_missed("meds@x:2026-08-17"))

    def test_completion_requires_a_timestamp(self) -> None:
        run(self.store.create(new_item()))
        with self.assertRaises(RoutineError):
            run(self.store.complete("new@autiplanner.local", None))

    def test_conflict_leaves_the_stored_value_untouched(self) -> None:
        run(self.store.create(new_item()))
        uid = "new@autiplanner.local"
        run(self.store.mark_missed(uid))
        with self.assertRaises(RoutineError) as caught:
            run(self.store.complete(uid, "2026-08-11T09:05:00Z", expected_revision=0))
        self.assertEqual(caught.exception.code, "conflict")
        self.assertEqual(self.store.get(uid).status, "missed")
        # A correct revision succeeds.
        run(self.store.complete(uid, "2026-08-11T09:05:00Z", expected_revision=1))
        self.assertEqual(self.store.get(uid).status, "completed")

    def test_duplicate_uid_is_rejected_across_items_and_series(self) -> None:
        run(self.store.create(new_item(uid="shared@autiplanner.local")))
        with self.assertRaises(RoutineError) as caught:
            run(
                self.store.add_series(
                    RoutineTemplate(
                        uid="shared@autiplanner.local",
                        title="Walk",
                        day_part="morning",
                        date="2026-08-10",
                        recurrence=RecurrenceRule(freq="daily"),
                    )
                )
            )
        self.assertEqual(caught.exception.code, "duplicate-uid")

        run(
            self.store.add_series(
                RoutineTemplate(
                    uid="series@autiplanner.local",
                    title="Walk",
                    day_part="morning",
                    date="2026-08-10",
                    recurrence=RecurrenceRule(freq="daily"),
                )
            )
        )
        with self.assertRaises(RoutineError):
            run(self.store.create(new_item(uid="series@autiplanner.local")))

    def test_malformed_file_is_reported_and_writable(self) -> None:
        self.path.write_text("not a calendar", encoding="utf-8")
        store = RoutineStore(self.path)
        store.load()
        self.assertTrue(store.issues)
        run(store.create(new_item()))
        reloaded = RoutineStore(self.path)
        reloaded.load()
        self.assertEqual(len(reloaded.snapshot()), 1)


if __name__ == "__main__":
    unittest.main()
