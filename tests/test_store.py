"""Store tests. These run without Home Assistant installed."""

from __future__ import annotations

import asyncio
import datetime as dt
import tempfile
import unittest
from pathlib import Path

from tests import install_package

install_package()

from autiplanner.ics import parse_calendar, serialize_calendar  # noqa: E402
from autiplanner.model import RecurrenceRule, RoutineItem, RoutineTemplate  # noqa: E402
from autiplanner.recurrence import RecurrenceError, expand_series  # noqa: E402
from autiplanner.store import RoutineError, RoutineStore  # noqa: E402

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "autiplanner.ics"
SERIES = Path(__file__).resolve().parents[1] / "examples" / "series.ics"


def item(**overrides: object) -> RoutineItem:
    base = {
        "uid": "item@autiplanner.local",
        "title": "Take medication",
        "date": "2026-08-11",
        "day_part": "morning",
        "status": "pending",
    }
    base.update(overrides)
    return RoutineItem(**base)  # type: ignore[arg-type]


def run(coro: object) -> object:
    return asyncio.run(coro)  # type: ignore[arg-type]


class IcsRoundTripTest(unittest.TestCase):
    def test_example_parses_without_issues(self) -> None:
        parsed = parse_calendar(EXAMPLE.read_text(encoding="utf-8"))
        self.assertEqual(parsed.issues, [])
        self.assertEqual(len(parsed.items), 5)
        self.assertEqual(parsed.items[0].status, "completed")
        self.assertEqual(parsed.items[0].completed_at, "2026-08-11T08:05:00Z")
        self.assertEqual(parsed.items[2].status, "missed")
        self.assertEqual(parsed.items[2].completed_at, None)
        self.assertEqual(parsed.items[3].status, "skipped")
        self.assertEqual(parsed.items[3].day_part, "evening")

    def test_example_round_trips(self) -> None:
        parsed = parse_calendar(EXAMPLE.read_text(encoding="utf-8"))
        again = parse_calendar(serialize_calendar(parsed.items, parsed.series, parsed.preserved))
        self.assertEqual(again.issues, [])
        self.assertEqual(
            [entry.to_dict() for entry in again.items],
            [entry.to_dict() for entry in parsed.items],
        )

    def test_missed_never_becomes_completed(self) -> None:
        parsed = parse_calendar(EXAMPLE.read_text(encoding="utf-8"))
        text = serialize_calendar(parsed.items)
        block = text.split("BEGIN:VTODO")[3]
        self.assertIn("X-AUTIPLANNER-OUTCOME:MISSED", block)
        self.assertIn("STATUS:NEEDS-ACTION", block)
        self.assertNotIn("STATUS:COMPLETED", block)
        self.assertNotIn("\r\nCOMPLETED:", block)

    def test_missing_day_part_is_not_inferred(self) -> None:
        parsed = parse_calendar(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:walk@x\r\n"
            "DTSTAMP:20260811T060000Z\r\nDTSTART:20260811T113000Z\r\nSUMMARY:Walk\r\n"
            "STATUS:NEEDS-ACTION\r\nX-AUTIPLANNER-OUTCOME:PENDING\r\nEND:VTODO\r\nEND:VCALENDAR\r\n"
        )
        self.assertEqual(parsed.items, [])
        self.assertTrue(any(code == "missing-daypart" for code, _ in parsed.issues))

    def test_outcome_wins_over_status(self) -> None:
        parsed = parse_calendar(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:x@y\r\n"
            "DTSTAMP:20260811T060000Z\r\nDTSTART:20260811T080000Z\r\nSUMMARY:Exercise\r\n"
            "STATUS:COMPLETED\r\nCOMPLETED:20260811T090000Z\r\n"
            "X-AUTIPLANNER-DATE:2026-08-11\r\nX-AUTIPLANNER-DAYPART:AFTERNOON\r\n"
            "X-AUTIPLANNER-OUTCOME:MISSED\r\nEND:VTODO\r\nEND:VCALENDAR\r\n"
        )
        self.assertEqual(parsed.items[0].status, "missed")
        self.assertIsNone(parsed.items[0].completed_at)
        self.assertTrue(any(code == "outcome-status-conflict" for code, _ in parsed.issues))

    def test_preserves_unmodeled_components(self) -> None:
        parsed = parse_calendar(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:appt@x\r\n"
            "DTSTAMP:20260811T060000Z\r\nDTSTART:20260811T150000Z\r\nSUMMARY:Appointment\r\n"
            "END:VEVENT\r\nEND:VCALENDAR\r\n"
        )
        self.assertEqual(len(parsed.preserved), 1)
        self.assertIn("BEGIN:VEVENT", serialize_calendar(parsed.items, [], parsed.preserved))

    def test_folds_long_text_without_splitting_utf8(self) -> None:
        title = "\U0001f48a" * 60
        text = serialize_calendar([item(title=title)])
        for line in text.split("\r\n"):
            self.assertLessEqual(len(line.encode("utf-8")), 75, line)
        self.assertEqual(parse_calendar(text).items[0].title, title)


class RecurrenceTest(unittest.TestCase):
    def test_daily_window(self) -> None:
        template = RoutineTemplate(
            uid="meds@x",
            title="Take medication",
            day_part="morning",
            date="2026-08-11",
            start="2026-08-11T08:00:00Z",
            recurrence=RecurrenceRule(freq="daily"),
        )
        items = expand_series(template, "2026-08-11", "2026-08-14")
        self.assertEqual(
            [entry.uid for entry in items],
            ["meds@x:2026-08-11", "meds@x:2026-08-12", "meds@x:2026-08-13"],
        )
        self.assertTrue(all(entry.status == "pending" for entry in items))
        self.assertNotIn("meds@x", [entry.uid for entry in items])
        self.assertEqual(items[1].start, "2026-08-12T08:00:00Z")

    def test_weekly_by_day_and_exdate(self) -> None:
        template = RoutineTemplate(
            uid="walk@x",
            title="Walk",
            day_part="evening",
            date="2026-08-10",
            recurrence=RecurrenceRule(freq="weekly", by_day=("MO", "WE")),
            exdates=("2026-08-12",),
        )
        items = expand_series(template, "2026-08-10", "2026-08-20")
        self.assertEqual([entry.date for entry in items], ["2026-08-10", "2026-08-17", "2026-08-19"])

    def test_window_is_bounded(self) -> None:
        template = RoutineTemplate(
            uid="meds@x",
            title="Take medication",
            day_part="morning",
            date="2026-08-11",
            recurrence=RecurrenceRule(freq="daily"),
        )
        with self.assertRaises(RecurrenceError):
            expand_series(template, "2026-01-01", "2028-01-01")

    def test_occurrence_state_wins(self) -> None:
        template = RoutineTemplate(
            uid="meds@x",
            title="Take medication",
            day_part="morning",
            date="2026-08-11",
            start="2026-08-11T08:00:00Z",
            recurrence=RecurrenceRule(freq="daily"),
        )
        override = item(uid="meds@x:2026-08-12", date="2026-08-12", status="missed", routine_id="meds@x")
        items = expand_series(template, "2026-08-11", "2026-08-13", [override])
        self.assertEqual(items[1].status, "missed")
        self.assertIsNone(items[1].completed_at)


class StoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.path = Path(self._dir.name) / "routine.ics"
        self.path.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
        self.store = RoutineStore(self.path)
        self.store.load()

    def tearDown(self) -> None:
        self._dir.cleanup()

    def test_mutation_survives_restart(self) -> None:
        run(self.store.mark_missed("medication-am-20260811@autiplanner.local"))
        reloaded = RoutineStore(self.path)
        reloaded.load()
        entry = reloaded.get("medication-am-20260811@autiplanner.local")
        self.assertEqual(entry.status, "missed")
        self.assertIsNone(entry.completed_at)
        self.assertEqual((entry.revision or 0) > 0, True)

    def test_two_clients_observe_the_same_state(self) -> None:
        run(self.store.complete("breakfast-20260811@autiplanner.local", "2026-08-11T09:00:00Z"))
        other = RoutineStore(self.path)
        other.load()
        self.assertEqual(other.get("breakfast-20260811@autiplanner.local").status, "completed")

    def test_concurrent_mutations_are_serialized(self) -> None:
        async def scenario() -> None:
            await asyncio.gather(
                self.store.mark_missed("exercise-20260811@autiplanner.local"),
                self.store.skip("journal-20260811@autiplanner.local"),
                self.store.complete("breakfast-20260811@autiplanner.local", "2026-08-11T09:00:00Z"),
            )

        run(scenario())
        reloaded = RoutineStore(self.path)
        reloaded.load()
        self.assertEqual(reloaded.get("exercise-20260811@autiplanner.local").status, "missed")
        self.assertEqual(reloaded.get("journal-20260811@autiplanner.local").status, "skipped")
        self.assertEqual(reloaded.get("breakfast-20260811@autiplanner.local").status, "completed")
        self.assertEqual(len(reloaded.snapshot()), 5)

    def test_revision_conflict_is_rejected(self) -> None:
        first = self.store.get("breakfast-20260811@autiplanner.local")
        self.assertEqual(first.status, "pending")
        with self.assertRaises(RoutineError) as caught:
            run(self.store.mark_missed(first.uid, expected_revision=99))
        self.assertEqual(caught.exception.code, "conflict")
        self.assertEqual(self.store.get(first.uid).status, "pending")

    def test_malformed_file_does_not_crash_setup(self) -> None:
        self.path.write_text("this is not a calendar", encoding="utf-8")
        store = RoutineStore(self.path)
        store.load()
        self.assertEqual(store.snapshot(), [])
        self.assertTrue(store.issues)

    def test_rejected_vtodor_is_preserved_on_rewrite(self) -> None:
        text = (
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AutiPlanner//Routine Calendar//EN\r\n"
            "BEGIN:VTODO\r\nUID:broken@x\r\nDTSTAMP:20260811T060000Z\r\nDTSTART:20260811T080000Z\r\n"
            "SUMMARY:No day part\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n"
        )
        self.path.write_text(text, encoding="utf-8")
        store = RoutineStore(self.path)
        store.load()
        run(store.create(item(uid="new@x", title="Walk")))
        self.assertIn("broken@x", self.path.read_text(encoding="utf-8"))
        self.assertIn("new@x", self.path.read_text(encoding="utf-8"))

    def test_range_query_expands_series(self) -> None:
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
        window = self.store.items_for_range("2026-08-12", "2026-08-14")
        self.assertIn("meds@x:2026-08-12", [entry.uid for entry in window])
        self.assertIn("meds@x:2026-08-13", [entry.uid for entry in window])
        run(self.store.mark_missed("meds@x:2026-08-12", expected_revision=0))
        window = self.store.items_for_range("2026-08-12", "2026-08-14")
        entry = next(entry for entry in window if entry.uid == "meds@x:2026-08-12")
        self.assertEqual(entry.status, "missed")
        self.assertEqual(entry.day_part, "morning")

    def test_series_example_file_round_trips(self) -> None:
        parsed = parse_calendar(SERIES.read_text(encoding="utf-8"))
        self.assertEqual(parsed.issues, [])
        self.assertEqual(len(parsed.series), 1)
        self.assertEqual(parsed.series[0].uid, "meds-am-series@autiplanner.local")
        self.assertEqual(parsed.series[0].recurrence.freq, "weekly")
        self.assertEqual(parsed.series[0].recurrence.by_day, ("MO", "WE", "FR"))
        self.assertEqual(len(parsed.items), 1)
        self.assertEqual(parsed.items[0].uid, "meds-am-series@autiplanner.local:2026-08-12")
        self.assertEqual(parsed.items[0].status, "missed")
        self.assertEqual(parsed.items[0].routine_id, "meds-am-series@autiplanner.local")

        again = parse_calendar(serialize_calendar(parsed.items, parsed.series, parsed.preserved))
        self.assertEqual(again.issues, [])
        self.assertEqual(
            [entry.to_dict() for entry in again.items],
            [entry.to_dict() for entry in parsed.items],
        )
        self.assertEqual(again.series[0].recurrence.by_day, ("MO", "WE", "FR"))
        # The occurrence override is not rewritten as completed.
        block = serialize_calendar(parsed.items, parsed.series).split("BEGIN:VTODO")[2]
        self.assertIn("X-AUTIPLANNER-OUTCOME:MISSED", block)
        self.assertNotIn("STATUS:COMPLETED", block)

    def test_series_occurrence_marks_only_that_occurrence(self) -> None:
        self.path.write_text(SERIES.read_text(encoding="utf-8"), encoding="utf-8")
        store = RoutineStore(self.path)
        store.load()
        # BYDAY is MO,WE,FR and the anchor is Tuesday 11 August, so the first
        # occurrence is Wednesday 12 August. Nothing is generated for the 11th.
        window = store.items_for_range("2026-08-11", "2026-08-14")
        self.assertEqual(
            [entry.uid for entry in window],
            ["meds-am-series@autiplanner.local:2026-08-12"],
        )
        self.assertEqual(window[0].status, "missed")
        self.assertIsNone(window[0].completed_at)
        # Friday 14 and Monday 17 follow, and both stay pending.
        later = store.items_for_range("2026-08-14", "2026-08-18")
        self.assertEqual(
            [entry.date for entry in later],
            ["2026-08-14", "2026-08-17"],
        )
        self.assertEqual([entry.status for entry in later], ["pending", "pending"])
        # The master still exists and stays pending.
        self.assertEqual(store._series[0].uid, "meds-am-series@autiplanner.local")
        self.assertEqual(len(self.path.read_text(encoding="utf-8").split("BEGIN:VTODO")), 3)

    def test_series_master_completion_is_rejected(self) -> None:
        run(
            self.store.add_series(
                RoutineTemplate(
                    uid="meds@series",
                    title="Take medication",
                    day_part="morning",
                    date="2026-08-11",
                    recurrence=RecurrenceRule(freq="daily"),
                )
            )
        )
        with self.assertRaises(RoutineError) as caught:
            run(self.store.complete("meds@series", "2026-08-11T08:05:00Z"))
        self.assertEqual(caught.exception.code, "series-completion")

    def test_empty_file_is_reported(self) -> None:
        self.path.write_text("", encoding="utf-8")
        store = RoutineStore(self.path)
        store.load()
        self.assertTrue(any(code == "empty-calendar" for code, _ in store.issues))

    def test_created_item_requires_valid_state(self) -> None:
        with self.assertRaises(RoutineError):
            run(self.store.create(item(uid="bad@x", status="missed", completed_at="2026-08-11T08:00:00Z")))

    def test_utc_stamp_is_used_for_completion(self) -> None:
        stamp = dt.datetime.now(tz=dt.UTC).isoformat().replace("+00:00", "Z")
        entry = run(self.store.complete("breakfast-20260811@autiplanner.local", stamp))
        self.assertTrue(entry.completed_at.endswith("Z"))
        self.assertIn("COMPLETED:", self.path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
