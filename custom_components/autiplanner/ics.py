"""AutiPlanner iCalendar profile for the Home Assistant integration.

The rules here mirror ``packages/ics`` in the TypeScript packages. Day part is
never inferred from a clock, a missed or skipped outcome is never rewritten as
completed, and unmodeled components are preserved instead of deleted.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .model import (
    DAY_PARTS,
    STATUSES,
    RecurrenceRule,
    RoutineItem,
    RoutineTemplate,
    WEEKDAY_CODES,
)

PRODID = "-//AutiPlanner//Routine Calendar//EN"
PROP_DAY_PART = "X-AUTIPLANNER-DAYPART"
PROP_OUTCOME = "X-AUTIPLANNER-OUTCOME"
PROP_ORDER = "X-AUTIPLANNER-ORDER"
PROP_REVISION = "X-AUTIPLANNER-REVISION"
PROP_ROUTINE_ID = "X-AUTIPLANNER-ROUTINE-ID"
PROP_DATE = "X-AUTIPLANNER-DATE"
MAPPED_PROPERTIES = (
    PROP_DAY_PART,
    PROP_OUTCOME,
    PROP_ORDER,
    PROP_REVISION,
    PROP_ROUTINE_ID,
    PROP_DATE,
)

STATUS_TO_OUTCOME = {status: status.upper() for status in STATUSES}
OUTCOME_TO_STATUS = {value: key for key, value in STATUS_TO_OUTCOME.items()}
STATUS_TO_VTODO = {
    "pending": "NEEDS-ACTION",
    "completed": "COMPLETED",
    "missed": "NEEDS-ACTION",
    "skipped": "NEEDS-ACTION",
}
DAY_PART_TO_ICS = {part: part.upper() for part in DAY_PARTS}
ICS_TO_DAY_PART = {value: key for key, value in DAY_PART_TO_ICS.items()}

_BASIC_DATE = re.compile(r"^(\d{4})(\d{2})(\d{2})$")
_BASIC_DATE_TIME = re.compile(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$")
_INTEGER = re.compile(r"^-?\d+$")


class IcsError(ValueError):
    pass


@dataclass
class ContentLine:
    name: str
    value: str
    params: dict[str, str] = field(default_factory=dict)
    line: int = 0


@dataclass
class ParsedCalendar:
    items: list[RoutineItem]
    series: list[RoutineTemplate]
    preserved: list[str]
    issues: list[tuple[str, str]]
    prodid: str | None = None


# --------------------------------------------------------------------------- text


def escape_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
        .replace(";", "\\;")
        .replace(",", "\\,")
    )


def unescape_text(value: str) -> str:
    out: list[str] = []
    index = 0
    while index < len(value):
        char = value[index]
        if char != "\\":
            out.append(char)
            index += 1
            continue
        nxt = value[index + 1] if index + 1 < len(value) else None
        if nxt is None:
            out.append("\\")
            break
        if nxt in ("n", "N"):
            out.append("\n")
        elif nxt == "\\":
            out.append("\\")
        elif nxt == ";":
            out.append(";")
        elif nxt == ",":
            out.append(",")
        else:
            out.append(nxt)
        index += 2
    return "".join(out)


def unfold(text: str) -> list[tuple[str, int]]:
    physical = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    logical: list[tuple[str, int]] = []
    for index, raw in enumerate(physical):
        if raw.startswith(" ") or raw.startswith("\t"):
            if logical:
                previous, number = logical[-1]
                logical[-1] = (previous + raw[1:], number)
            continue
        if raw:
            logical.append((raw, index + 1))
    return logical


def fold_line(line: str) -> str:
    data = line.encode("utf-8")
    if len(data) <= 75:
        return line
    chunks: list[bytes] = []
    offset = 0
    budget = 75
    while offset < len(data):
        end = min(offset + budget, len(data))
        while end < len(data) and data[end] & 0xC0 == 0x80:
            end -= 1
        if end == offset:
            end = min(offset + 1, len(data))
        chunks.append(data[offset:end])
        offset = end
        budget = 74
    return "\r\n ".join(chunk.decode("utf-8") for chunk in chunks)


# --------------------------------------------------------------------------- time


def _valid_date(date: str) -> bool:
    try:
        import datetime as dt

        dt.date(int(date[0:4]), int(date[5:7]), int(date[8:10]))
    except (ValueError, IndexError):
        return False
    return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", date))


@dataclass
class ParsedTime:
    date: str
    timestamp: str | None
    timezone: str | None
    form: str  # date | utc | zoned | floating


def parse_time(value: str, params: dict[str, str]) -> ParsedTime | None:
    text = value.strip()
    timezone = params.get("TZID", "").strip() or None
    value_type = params.get("VALUE", "").upper()
    if "T" in text:
        if value_type == "DATE":
            return None
        return _parse_date_time(text, timezone)
    if value_type == "DATE-TIME":
        return None
    if timezone:
        return None
    match = _BASIC_DATE.fullmatch(text)
    if not match:
        return None
    date = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    return ParsedTime(date=date, timestamp=None, timezone=None, form="date") if _valid_date(date) else None


def _parse_date_time(value: str, timezone: str | None) -> ParsedTime | None:
    match = _BASIC_DATE_TIME.fullmatch(value)
    if not match:
        return None
    date = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    if not _valid_date(date):
        return None
    if int(match.group(4)) > 23 or int(match.group(5)) > 59 or int(match.group(6)) > 60:
        return None
    clock = f"{match.group(4)}:{match.group(5)}:{match.group(6)}"
    if match.group(7) == "Z":
        if timezone:
            return None
        return ParsedTime(date, f"{date}T{clock}Z", None, "utc")
    if timezone:
        if any(char in timezone for char in '\r\n";,'):
            return None
        return ParsedTime(date, f"{date}T{clock}", timezone, "zoned")
    return ParsedTime(date, f"{date}T{clock}", None, "floating")


# --------------------------------------------------------------------------- parse


def parse_calendar(text: str) -> ParsedCalendar:
    issues: list[tuple[str, str]] = []
    if text.startswith("\ufeff"):
        text = text[1:]
    lines = unfold(text)
    if not lines:
        return ParsedCalendar([], [], [], [("empty-calendar", "calendar is empty")])

    items: list[RoutineItem] = []
    series: list[RoutineTemplate] = []
    preserved: list[str] = []

    _absorb_range(lines, 0, len(lines), items, series, preserved, issues)
    return ParsedCalendar(items, series, preserved, issues)


def _absorb_range(
    lines: list[tuple[str, int]],
    start: int,
    stop: int,
    items: list[RoutineItem],
    series: list[RoutineTemplate],
    preserved: list[str],
    issues: list[tuple[str, str]],
) -> None:
    """Walks a component range, recursing into nested components."""
    index = start
    while index < stop:
        raw = lines[index][0]
        if not raw.upper().startswith("BEGIN:"):
            if _parse_content_line(raw) is None:
                issues.append(("malformed-line", f"malformed line: {raw[:40]}"))
            index += 1
            continue
        name, body, index, inner_start, inner_stop = _read_component(lines, index, stop)
        if name == "VTODO":
            _absorb_vtodo(body, items, series, preserved, issues)
        elif name in ("VCALENDAR", "VJOURNAL", "VFREEBUSY", "VTIMEZONE", "DAYLIGHT", "STANDARD"):
            _absorb_range(lines, inner_start, inner_stop, items, series, preserved, issues)
        else:
            preserved.append("\r\n".join(["BEGIN:" + name, *body, "END:" + name]))


def _read_component(
    lines: list[tuple[str, int]], start: int, stop: int
) -> tuple[str, list[str], int, int, int]:
    """Returns the component name, its inner lines, the next index, and the
    index range of its inner lines."""
    name = lines[start][0][6:].strip().upper()
    inner: list[str] = []
    depth = 1
    index = start + 1
    closed = False
    while index < stop and depth > 0:
        raw = lines[index][0]
        upper = raw.upper()
        if upper.startswith("BEGIN:"):
            depth += 1
        elif upper.startswith("END:"):
            depth -= 1
            if depth == 0:
                closed = True
                index += 1
                break
        inner.append(raw)
        index += 1
    inner_stop = index - 1 if closed else index
    return name, inner, index, start + 1, inner_stop


def _absorb_vtodo(
    body: list[str],
    items: list[RoutineItem],
    series: list[RoutineTemplate],
    preserved: list[str],
    issues: list[tuple[str, str]],
) -> None:
    raw = "\r\n".join(["BEGIN:VTODO", *body, "END:VTODO"])
    properties: list[ContentLine] = []
    for raw_line in body:
        if raw_line.upper().startswith("BEGIN:"):
            continue
        parsed = _parse_content_line(raw_line)
        if parsed is not None:
            properties.append(parsed)

    has_rrule = any(prop.name == "RRULE" for prop in properties)
    has_recurrence_id = any(prop.name == "RECURRENCE-ID" for prop in properties)
    if has_rrule and has_recurrence_id:
        issues.append(("unsupported-recurrence", "series master is also an occurrence override"))
        preserved.append(raw)
        return
    if has_rrule:
        template = _parse_series(properties, issues)
        if template is None:
            preserved.append(raw)
        else:
            series.append(template)
        return
    if any(prop.name in ("EXDATE", "RDATE") for prop in properties):
        issues.append(("unsupported-recurrence", "EXDATE and RDATE belong on a series master"))
        preserved.append(raw)
        return
    item = _parse_item(properties, issues)
    if item is None:
        preserved.append(raw)
    else:
        items.append(item)


def _parse_content_line(raw: str) -> ContentLine | None:
    quoted = False
    for position, char in enumerate(raw):
        if char == "\\":
            continue
        if char == '"':
            quoted = not quoted
            continue
        if char == ":" and not quoted:
            left, value = raw[:position], raw[position + 1 :]
            break
    else:
        return None
    pieces = _split_semicolons(left)
    name = pieces[0].strip().upper()
    if not name:
        return None
    params: dict[str, str] = {}
    for piece in pieces[1:]:
        if "=" not in piece:
            return None
        key, _, param_value = piece.partition("=")
        key = key.strip().upper()
        param_value = param_value.strip()
        if len(param_value) >= 2 and param_value[0] == param_value[-1] == '"':
            param_value = param_value[1:-1]
        if not key:
            return None
        params[key] = param_value
    return ContentLine(name=name, value=value, params=params)


def _split_semicolons(value: str) -> list[str]:
    pieces: list[str] = []
    current: list[str] = []
    quoted = False
    for char in value:
        if char == '"':
            quoted = not quoted
            current.append(char)
        elif char == ";" and not quoted:
            pieces.append("".join(current))
            current = []
        else:
            current.append(char)
    pieces.append("".join(current))
    return pieces


def _first(properties: list[ContentLine], name: str) -> ContentLine | None:
    return next((prop for prop in properties if prop.name == name), None)


def _text(properties: list[ContentLine], name: str) -> str | None:
    prop = _first(properties, name)
    return unescape_text(prop.value) if prop else None


def _day_part(properties: list[ContentLine]) -> str | None:
    prop = _first(properties, PROP_DAY_PART)
    if not prop:
        return None
    return ICS_TO_DAY_PART.get(prop.value.strip().upper())


def _schedule(properties: list[ContentLine]) -> tuple[str | None, dict[str, str | None], bool]:
    explicit = None
    prop = _first(properties, PROP_DATE)
    if prop:
        raw = prop.value.strip()
        match = _BASIC_DATE.fullmatch(raw)
        candidate = (
            f"{match.group(1)}-{match.group(2)}-{match.group(3)}" if match else raw
        )
        if not _valid_date(candidate):
            return None, {}, True
        explicit = candidate

    values: dict[str, ParsedTime | None] = {}
    invalid = False
    for name in ("DTSTART", "DUE", "DTEND"):
        found = _first(properties, name)
        if not found:
            values[name] = None
            continue
        parsed = parse_time(found.value, found.params)
        if parsed is None:
            invalid = True
        values[name] = parsed

    if invalid:
        return None, {}, True

    timed = [value for value in values.values() if value is not None and value.form != "date"]
    zones = {value.timezone for value in timed if value.timezone}
    floating = any(value.form == "floating" for value in timed)
    if len(zones) > 1 or (floating and zones):
        return None, {}, True

    derived = None
    for name in ("DTSTART", "DUE", "DTEND"):
        value = values[name]
        if value is not None:
            derived = value.date
            break
    date = explicit or derived
    if date is None:
        return None, {}, True

    out: dict[str, str | None] = {"start": None, "due": None, "end": None, "timezone": None}
    start = values["DTSTART"]
    due = values["DUE"]
    end = values["DTEND"]
    if start is not None and start.form != "date" and start.timestamp:
        out["start"] = start.timestamp
    if due is not None and due.timestamp:
        out["due"] = due.timestamp
    if end is not None and end.timestamp:
        out["end"] = end.timestamp
    if zones:
        out["timezone"] = next(iter(zones))
    return date, out, False


def _outcome(properties: list[ContentLine], issues: list[tuple[str, str]]) -> tuple[str | None, str | None, bool]:
    outcome_prop = _first(properties, PROP_OUTCOME)
    status_prop = _first(properties, "STATUS")
    completed_prop = _first(properties, "COMPLETED")

    completed = None
    if completed_prop is not None:
        parsed = parse_time(completed_prop.value, completed_prop.params)
        if parsed is None or parsed.form != "utc" or parsed.timestamp is None:
            issues.append(("invalid-datetime", "COMPLETED must be a UTC date-time"))
        else:
            completed = parsed.timestamp

    outcome = outcome_prop.value.strip().upper() if outcome_prop else None
    status = status_prop.value.strip().upper() if status_prop else None

    if outcome:
        if outcome not in OUTCOME_TO_STATUS:
            issues.append(("invalid-outcome", f"unknown outcome {outcome}"))
            return None, None, True
        resolved = OUTCOME_TO_STATUS[outcome]
        expected = STATUS_TO_VTODO[resolved]
        if status and status != expected:
            issues.append(("outcome-status-conflict", "conflicting STATUS was ignored"))
        if resolved == "completed":
            if completed is None:
                issues.append(("completed-without-timestamp", "completed outcome needs COMPLETED"))
                return None, None, True
            return resolved, completed, False
        if completed_prop is not None:
            issues.append(("timestamp-without-completed", "COMPLETED ignored for non-completed outcome"))
        return resolved, None, False

    if status == "COMPLETED":
        issues.append(("inferred-outcome", "outcome inferred as completed from STATUS"))
        if completed is None:
            issues.append(("completed-without-timestamp", "STATUS:COMPLETED needs COMPLETED"))
            return None, None, True
        return "completed", completed, False

    if status in (None, "NEEDS-ACTION"):
        issues.append(("inferred-outcome", "outcome inferred as pending"))
        if completed_prop is not None:
            issues.append(("timestamp-without-completed", "COMPLETED ignored for non-completed outcome"))
        return "pending", None, False

    issues.append(("unsupported-status", f"STATUS {status} is not an AutiPlanner outcome"))
    return None, None, True


def _parse_item(properties: list[ContentLine], issues: list[tuple[str, str]]) -> RoutineItem | None:
    uid_prop = _first(properties, "UID")
    uid = unescape_text(uid_prop.value).strip() if uid_prop else ""
    if not uid:
        issues.append(("missing-uid", "VTODO is missing UID"))
    title = _text(properties, "SUMMARY")
    if not title or not title.strip():
        issues.append(("missing-summary", "VTODO is missing SUMMARY"))
    day_part = _day_part(properties)
    if day_part is None:
        issues.append(("missing-daypart", "day part missing and not inferred"))
    date, schedule, invalid = _schedule(properties)
    if invalid:
        issues.append(("invalid-datetime", "scheduling fields could not be interpreted"))
    status, completed_at, bad = _outcome(properties, issues)

    if not uid or not title or not title.strip() or day_part is None or not date or bad:
        return None

    item = RoutineItem(
        uid=uid,
        title=title,
        date=date,
        day_part=day_part,
        status=status or "pending",
        description=_text(properties, "DESCRIPTION") or None,
        start=schedule.get("start"),
        due=schedule.get("due"),
        end=schedule.get("end"),
        timezone=schedule.get("timezone"),
        completed_at=completed_at,
        order=_integer(properties, PROP_ORDER),
        routine_id=_text(properties, PROP_ROUTINE_ID) or None,
        revision=_integer(properties, PROP_REVISION),
        tags=_tags(properties),
        extensions=_extensions(properties),
    )
    return item


def _parse_series(properties: list[ContentLine], issues: list[tuple[str, str]]) -> RoutineTemplate | None:
    uid_prop = _first(properties, "UID")
    uid = unescape_text(uid_prop.value).strip() if uid_prop else ""
    title = _text(properties, "SUMMARY")
    day_part = _day_part(properties)
    date, schedule, invalid = _schedule(properties)
    recurrence = _parse_rrule(properties)
    if not uid or not title or not title.strip() or day_part is None or not date or invalid:
        return None
    if recurrence is None:
        issues.append(("unsupported-recurrence", "RRULE outside the supported subset"))
        return None
    return RoutineTemplate(
        uid=uid,
        title=title,
        day_part=day_part,
        date=date,
        recurrence=recurrence,
        description=_text(properties, "DESCRIPTION") or None,
        start=schedule.get("start"),
        due=schedule.get("due"),
        timezone=schedule.get("timezone"),
        order=_integer(properties, PROP_ORDER),
        exdates=tuple(_date_list(properties, "EXDATE")),
        rdates=tuple(_date_list(properties, "RDATE")),
        extensions=_extensions(properties),
    )


_FREQ = {"DAILY": "daily", "WEEKLY": "weekly", "MONTHLY": "monthly"}


def _parse_rrule(properties: list[ContentLine]) -> RecurrenceRule | None:
    prop = _first(properties, "RRULE")
    if not prop:
        return None
    parts: dict[str, str] = {}
    for piece in prop.value.split(";"):
        if "=" not in piece:
            return None
        key, _, value = piece.partition("=")
        parts[key.strip().upper()] = value.strip()
    freq = _FREQ.get(parts.get("FREQ", ""))
    if freq is None or ("COUNT" in parts and "UNTIL" in parts):
        return None
    interval = 1
    if "INTERVAL" in parts:
        if not _INTEGER.fullmatch(parts["INTERVAL"]) or int(parts["INTERVAL"]) < 1:
            return None
        interval = int(parts["INTERVAL"])
    count = None
    if "COUNT" in parts:
        if not _INTEGER.fullmatch(parts["COUNT"]) or int(parts["COUNT"]) < 1:
            return None
        count = int(parts["COUNT"])
    until = None
    if "UNTIL" in parts:
        raw = parts["UNTIL"]
        match = _BASIC_DATE.fullmatch(raw) or re.fullmatch(r"(\d{4})(\d{2})(\d{2})T\d{6}Z?", raw)
        if not match:
            return None
        until = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
        if not _valid_date(until):
            return None
    by_day: tuple[str, ...] = ()
    if "BYDAY" in parts:
        if freq == "monthly":
            return None
        days = tuple(piece.strip().upper() for piece in parts["BYDAY"].split(","))
        if any(day not in WEEKDAY_CODES for day in days):
            return None
        by_day = days
    return RecurrenceRule(freq=freq, interval=interval, count=count, until=until, by_day=by_day)


def _date_list(properties: list[ContentLine], name: str) -> list[str]:
    dates: list[str] = []
    for prop in properties:
        if prop.name != name:
            continue
        for piece in prop.value.split(","):
            parsed = parse_time(piece.strip(), prop.params)
            if parsed is not None:
                dates.append(parsed.date)
    return dates


def _integer(properties: list[ContentLine], name: str) -> int | None:
    prop = _first(properties, name)
    if not prop:
        return None
    raw = prop.value.strip()
    if not _INTEGER.fullmatch(raw):
        return None
    return int(raw)


def _tags(properties: list[ContentLine]) -> tuple[str, ...]:
    prop = _first(properties, "CATEGORIES")
    if not prop:
        return ()
    tags = [unescape_text(piece).strip() for piece in _split_unescaped(prop.value, ",")]
    return tuple(tag for tag in tags if tag)


def _split_unescaped(value: str, separator: str) -> list[str]:
    pieces: list[str] = []
    current: list[str] = []
    index = 0
    while index < len(value):
        char = value[index]
        if char == "\\" and index + 1 < len(value):
            current.append(char)
            current.append(value[index + 1])
            index += 2
            continue
        if char == separator:
            pieces.append("".join(current))
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    pieces.append("".join(current))
    return pieces


def _extensions(properties: list[ContentLine]) -> dict[str, str]:
    found: dict[str, str] = {}
    for prop in properties:
        if not prop.name.startswith("X-AUTIPLANNER-") or prop.name in MAPPED_PROPERTIES:
            continue
        found[prop.name] = unescape_text(prop.value)
    return found


# --------------------------------------------------------------------------- serialize


def serialize_calendar(
    items: list[RoutineItem],
    series: list[RoutineTemplate] | None = None,
    preserved: list[str] | None = None,
) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        _line("PRODID", escape_text(PRODID)),
        "CALSCALE:GREGORIAN",
    ]
    for template in series or []:
        lines.extend(_serialize_series(template))
    for item in items:
        lines.extend(_serialize_item(item))
    for block in preserved or []:
        lines.append(block)
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _line(name: str, value: str, params: str = "") -> str:
    prefix = f"{name}{';' + params if params else ''}"
    return fold_line(f"{prefix}:{value}")


def _serialize_item(item: RoutineItem) -> list[str]:
    if item.status not in STATUSES:
        raise IcsError(f"unknown outcome {item.status}")
    if item.status == "completed" and not item.completed_at:
        raise IcsError("completed items require completedAt")
    if item.status != "completed" and item.completed_at:
        raise IcsError("only completed items may carry completedAt")

    lines = [
        "BEGIN:VTODO",
        _line("UID", escape_text(item.uid)),
        _line("DTSTAMP", _stamp()),
    ]
    if item.start:
        lines.append(_time_line("DTSTART", item.start, item.timezone))
    elif not item.due and not item.end:
        lines.append(_line("DTSTART", item.date.replace("-", ""), "VALUE=DATE"))
    if item.due:
        lines.append(_time_line("DUE", item.due, item.timezone))
    if item.end:
        lines.append(_time_line("DTEND", item.end, item.timezone))
    lines.append(_line("SUMMARY", escape_text(item.title)))
    if item.description:
        lines.append(_line("DESCRIPTION", escape_text(item.description)))
    lines.append(_line("STATUS", STATUS_TO_VTODO[item.status]))
    if item.status == "completed":
        lines.append(_line("COMPLETED", _basic_utc(item.completed_at or "")))
    if item.tags:
        lines.append(_line("CATEGORIES", ",".join(escape_text(tag) for tag in item.tags)))
    lines.append(_line(PROP_DATE, item.date))
    if item.routine_id and item.uid == f"{item.routine_id}:{item.date}":
        lines.append(_line("RECURRENCE-ID", item.date.replace("-", ""), "VALUE=DATE"))
    lines.append(_line(PROP_DAY_PART, DAY_PART_TO_ICS[item.day_part]))
    lines.append(_line(PROP_OUTCOME, STATUS_TO_OUTCOME[item.status]))
    if item.order is not None:
        lines.append(_line(PROP_ORDER, str(item.order)))
    if item.routine_id:
        lines.append(_line(PROP_ROUTINE_ID, escape_text(item.routine_id)))
    if item.revision is not None:
        lines.append(_line(PROP_REVISION, str(item.revision)))
    for key in sorted(item.extensions):
        if key in MAPPED_PROPERTIES:
            continue
        lines.append(_line(key, escape_text(item.extensions[key])))
    lines.append("END:VTODO")
    return lines


def _serialize_series(template: RoutineTemplate) -> list[str]:
    lines = [
        "BEGIN:VTODO",
        _line("UID", escape_text(template.uid)),
        _line("DTSTAMP", _stamp()),
    ]
    if template.start:
        lines.append(_time_line("DTSTART", template.start, template.timezone))
    else:
        lines.append(_line("DTSTART", template.date.replace("-", ""), "VALUE=DATE"))
    if template.due:
        lines.append(_time_line("DUE", template.due, template.timezone))
    lines.append(_line("RRULE", _format_rrule(template.recurrence)))
    if template.exdates:
        lines.append(
            _line("EXDATE", ",".join(date.replace("-", "") for date in template.exdates), "VALUE=DATE")
        )
    if template.rdates:
        lines.append(
            _line("RDATE", ",".join(date.replace("-", "") for date in template.rdates), "VALUE=DATE")
        )
    lines.append(_line("SUMMARY", escape_text(template.title)))
    if template.description:
        lines.append(_line("DESCRIPTION", escape_text(template.description)))
    lines.append(_line("STATUS", "NEEDS-ACTION"))
    lines.append(_line(PROP_DATE, template.date))
    lines.append(_line(PROP_DAY_PART, DAY_PART_TO_ICS[template.day_part]))
    lines.append(_line(PROP_OUTCOME, "PENDING"))
    if template.order is not None:
        lines.append(_line(PROP_ORDER, str(template.order)))
    lines.append("END:VTODO")
    return lines


def _format_rrule(rule: RecurrenceRule) -> str:
    parts = [f"FREQ={rule.freq.upper()}"]
    if rule.interval != 1:
        parts.append(f"INTERVAL={rule.interval}")
    if rule.count is not None:
        parts.append(f"COUNT={rule.count}")
    if rule.until is not None:
        parts.append(f"UNTIL={rule.until.replace('-', '')}")
    if rule.by_day:
        parts.append(f"BYDAY={','.join(rule.by_day)}")
    return ";".join(parts)


def _time_line(name: str, timestamp: str, timezone: str | None) -> str:
    if timestamp.endswith("Z"):
        return _line(name, _basic_utc(timestamp))
    if re.search(r"[+-]\d{2}:\d{2}$", timestamp):
        return _line(name, _basic_utc(_to_utc(timestamp) or timestamp))
    local = timestamp.replace("-", "").replace(":", "")
    if timezone:
        return _line(name, local, f"TZID={timezone}")
    return _line(name, local)


def _basic_utc(timestamp: str) -> str:
    if not timestamp.endswith("Z"):
        raise IcsError("expected a UTC timestamp")
    return timestamp.replace("-", "").replace(":", "")


def _to_utc(value: str) -> str | None:
    import datetime as dt

    match = re.fullmatch(
        r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})", value
    )
    if not match:
        return None
    sign = -1 if match.group(7) == "-" else 1
    offset = sign * (int(match.group(8)) * 60 + int(match.group(9)))
    base = dt.datetime(
        int(match.group(1)),
        int(match.group(2)),
        int(match.group(3)),
        int(match.group(4)),
        int(match.group(5)) - offset,
        int(match.group(6)),
        tzinfo=dt.UTC,
    )
    return base.isoformat().replace("+00:00", "Z")


def _stamp() -> str:
    import datetime as dt

    now = dt.datetime.now(tz=dt.UTC)
    return now.strftime("%Y%m%dT%H%M%SZ")
