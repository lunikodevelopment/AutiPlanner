from __future__ import annotations

from pathlib import Path

import pytest

from custom_components.autiplanner.ics import IcsParseError, parse_calendar, serialize_calendar


ROOT = Path(__file__).parents[3]


def test_example_calendar_preserves_all_four_outcomes() -> None:
    result = parse_calendar((ROOT / "examples/autiplanner.ics").read_text(encoding="utf-8"))

    assert not result.warnings
    assert len(result.items) == 5
    assert [item.status for item in result.items] == [
        "completed",
        "pending",
        "missed",
        "skipped",
        "pending",
    ]
    assert result.items[0].completed_at is not None


def test_python_codec_round_trips_escaped_text_and_unknown_extensions() -> None:
    source = "\r\n".join(
        (
            "BEGIN:VCALENDAR",
            "BEGIN:VTODO",
            "UID:edge",
            "DTSTART;TZID=Europe/Amsterdam:20260811T083000",
            "SUMMARY:Prepare\\, pack\\; leave",
            "DESCRIPTION:First line\\nSecond line",
            "STATUS:NEEDS-ACTION",
            "X-AUTIPLANNER-DAYPART:MORNING",
            "X-AUTIPLANNER-OUTCOME:SKIPPED",
            "X-AUTIPLANNER-ICON:coffee",
            "X-AUTIPLANNER-PRIORITY:MUST_DO",
            "CATEGORIES:home\\,care,important",
            "END:VTODO",
            "END:VCALENDAR",
        )
    )
    parsed = parse_calendar(source)

    assert not parsed.warnings
    item = parsed.items[0]
    assert item.title == "Prepare, pack; leave"
    assert item.description == "First line\nSecond line"
    assert item.tags == ("home,care", "important")
    assert item.icon == "coffee"
    assert item.priority == "must_do"
    assert item.extensions == {}
    assert item.timezone == "Europe/Amsterdam"

    round_tripped = parse_calendar(serialize_calendar(parsed.items, dtstamp=item.start))
    assert round_tripped.items == parsed.items


def test_missing_day_part_can_be_explicitly_defaulted_but_strict_mode_rejects_it() -> None:
    source = "\r\n".join(
        (
            "BEGIN:VCALENDAR",
            "BEGIN:VTODO",
            "UID:imported",
            "DTSTART;VALUE=DATE:20260811",
            "SUMMARY:Imported",
            "STATUS:NEEDS-ACTION",
            "END:VTODO",
            "END:VCALENDAR",
        )
    )

    tolerant = parse_calendar(source, default_day_part="afternoon")
    assert tolerant.items[0].day_part == "afternoon"
    assert any(warning.code == "missing-required-property" for warning in tolerant.warnings)
    with pytest.raises(IcsParseError):
        parse_calendar(source, strict=True)


def test_standard_recurrence_properties_round_trip() -> None:
    source = "\r\n".join(
        (
            "BEGIN:VCALENDAR",
            "BEGIN:VTODO",
            "UID:series",
            "DTSTART;VALUE=DATE:20260811",
            "SUMMARY:Medication",
            "STATUS:NEEDS-ACTION",
            "RRULE:FREQ=DAILY;COUNT=3",
            "RDATE;VALUE=DATE:20260820",
            "EXDATE;VALUE=DATE:20260812",
            "RECURRENCE-ID;VALUE=DATE:20260811",
            "X-AUTIPLANNER-DAYPART:MORNING",
            "X-AUTIPLANNER-OUTCOME:PENDING",
            "END:VTODO",
            "END:VCALENDAR",
        )
    )
    parsed = parse_calendar(source)
    assert not parsed.warnings
    assert parsed.items[0].rrule == "FREQ=DAILY;COUNT=3"
    assert parsed.items[0].rdate == ("2026-08-20",)
    assert parsed.items[0].exdate == ("2026-08-12",)
    assert parsed.items[0].recurrence_id == "2026-08-11"
    assert parse_calendar(serialize_calendar(parsed.items, dtstamp=parsed.items[0].start)).items == parsed.items
