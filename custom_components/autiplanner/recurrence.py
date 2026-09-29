from __future__ import annotations

import datetime as dt

from .model import RoutineItem, RoutineTemplate, occurrence_uid

MAX_WINDOW_DAYS = 366
MAX_STEPS = 10000
WEEKDAY_FROM_CODE = {"SU": 0, "MO": 1, "TU": 2, "WE": 3, "TH": 4, "FR": 5, "SA": 6}


class RecurrenceError(ValueError):
    pass


def expand_series(
    template: RoutineTemplate,
    range_start: str,
    range_end: str,
    overrides: list[RoutineItem] | None = None,
) -> list[RoutineItem]:
    _assert_window(range_start, range_end)
    dates = _occurrence_dates(template, range_start, range_end)
    extras = [date for date in template.rdates if range_start <= date < range_end]
    unique = sorted(set(dates + extras))
    found = overrides or []
    return [_override_for(template, date, found) or _synthesize(template, date) for date in unique]


def materialize_occurrence(
    template: RoutineTemplate,
    date: str,
    status: str = "pending",
    completed_at: str | None = None,
) -> RoutineItem:
    item = _synthesize(template, date)
    item.status = status
    item.completed_at = completed_at
    return item


def _occurrence_dates(template: RoutineTemplate, range_start: str, range_end: str) -> list[str]:
    rule = template.recurrence
    if rule.interval < 1:
        raise RecurrenceError("recurrence interval must be a positive integer")
    excluded = set(template.exdates)
    dates: list[str] = []
    generated = 0
    steps = 0
    cursor = template.date
    while cursor < range_end and steps < MAX_STEPS:
        steps += 1
        if rule.count is not None and generated >= rule.count:
            break
        if rule.until is not None and cursor > rule.until:
            break
        for date in _dates_matching(template, cursor):
            if rule.count is not None and generated >= rule.count:
                break
            if rule.until is not None and date > rule.until:
                continue
            if date < template.date:
                continue
            generated += 1
            if range_start <= date < range_end and date not in excluded:
                dates.append(date)
        cursor = _advance(template, cursor)
    if steps >= MAX_STEPS:
        raise RecurrenceError("recurrence exceeded the safety step limit")
    return dates


def _dates_matching(template: RoutineTemplate, cursor: str) -> list[str]:
    rule = template.recurrence
    if rule.freq == "daily":
        return [cursor]
    if rule.freq == "monthly":
        return [cursor] if _day(cursor) == _day(template.date) else []
    codes = rule.by_day or (_weekday_code(template.date),)
    # Sunday-start week, matching the TypeScript expander.
    week_start = _add_days(cursor, -_utc_weekday(cursor))
    dates = []
    for code in dict.fromkeys(codes):
        date = _add_days(week_start, WEEKDAY_FROM_CODE[code])
        if date >= template.date:
            dates.append(date)
    return sorted(dates)


def _advance(template: RoutineTemplate, cursor: str) -> str:
    interval = template.recurrence.interval
    if template.recurrence.freq == "daily":
        return _add_days(cursor, interval)
    if template.recurrence.freq == "weekly":
        week_start = _add_days(cursor, -_utc_weekday(cursor))
        return _add_days(week_start, 7 * interval)
    return _add_months(cursor, interval, _day(template.date))


def _override_for(template: RoutineTemplate, date: str, overrides: list[RoutineItem]) -> RoutineItem | None:
    uid = occurrence_uid(template.uid, date)
    for item in overrides:
        if item.uid == uid or (item.routine_id == template.uid and item.date == date):
            return item
    return None


def _synthesize(template: RoutineTemplate, date: str) -> RoutineItem:
    return RoutineItem(
        uid=occurrence_uid(template.uid, date),
        title=template.title,
        date=date,
        day_part=template.day_part,
        status="pending",
        description=template.description,
        start=_shift_clock(template.start, date),
        due=_shift_clock(template.due, date),
        timezone=template.timezone,
        routine_id=template.uid,
        order=template.order,
        extensions=dict(template.extensions),
    )


def _shift_clock(timestamp: str | None, date: str) -> str | None:
    if timestamp is None or "T" not in timestamp:
        return None
    clock = timestamp.split("T", 1)[1]
    return f"{date}T{clock}"


def _assert_window(start: str, end: str) -> None:
    if end < start:
        raise RecurrenceError("range end is before start")
    days = (_utc(end) - _utc(start)).days
    if days > MAX_WINDOW_DAYS:
        raise RecurrenceError(f"range is {days} days; expansion is limited to {MAX_WINDOW_DAYS} days")


def _weekday_code(date: str) -> str:
    return ("MO", "TU", "WE", "TH", "FR", "SA", "SU")[_utc(date).weekday()]


def _utc_weekday(date: str) -> int:
    """Day of week with Sunday as 0, matching the TypeScript expander."""
    return (_utc(date).weekday() + 1) % 7


def _day(date: str) -> int:
    return int(date[8:10])


def _utc(date: str) -> dt.datetime:
    return dt.datetime(int(date[0:4]), int(date[5:7]), int(date[8:10]), tzinfo=dt.UTC)


def _add_days(date: str, days: int) -> str:
    return (_utc(date) + dt.timedelta(days=days)).date().isoformat()


def _add_months(date: str, months: int, day: int) -> str:
    current = _utc(date)
    month_index = current.month - 1 + months
    year = current.year + month_index // 12
    month = month_index % 12 + 1
    last = _last_day(year, month)
    if day > last:
        if month == 12:
            return dt.date(year + 1, 1, 1).isoformat()
        return dt.date(year, month + 1, 1).isoformat()
    return dt.date(year, month, day).isoformat()


def _last_day(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (dt.date(year, month + 1, 1) - dt.timedelta(days=1)).day
