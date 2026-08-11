"""Small RFC 5545 VTODO codec for the Home Assistant integration.

This intentionally mirrors only the documented AutiPlanner VTODO profile. It
does not attempt to become a general-purpose iCalendar implementation.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import re
from typing import Iterable, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .model import DAY_PARTS, ROUTINE_STATUSES, DayPart, RoutineItem, RoutineStatus, validate_item

PRODID = "-//AutiPlanner//Routine Calendar//EN"
DAY_PART_PROPERTY = "X-AUTIPLANNER-DAYPART"
OUTCOME_PROPERTY = "X-AUTIPLANNER-OUTCOME"
ORDER_PROPERTY = "X-AUTIPLANNER-ORDER"
ROUTINE_ID_PROPERTY = "X-AUTIPLANNER-ROUTINE-ID"
REVISION_PROPERTY = "X-AUTIPLANNER-REVISION"
KNOWN_PROPERTIES = {
    DAY_PART_PROPERTY,
    OUTCOME_PROPERTY,
    ORDER_PROPERTY,
    ROUTINE_ID_PROPERTY,
    REVISION_PROPERTY,
}


@dataclass(frozen=True, slots=True)
class IcsWarning:
    code: str
    message: str
    line_number: int | None = None
    uid: str | None = None


@dataclass(frozen=True, slots=True)
class ParseResult:
    items: tuple[RoutineItem, ...]
    warnings: tuple[IcsWarning, ...]


class IcsParseError(ValueError):
    """Raised in strict mode for malformed input."""

    def __init__(self, warning: IcsWarning) -> None:
        super().__init__(warning.message)
        self.warning = warning


class IcsSerializationError(ValueError):
    """Raised when a domain item cannot be represented by the profile."""


def unfold_lines(value: str) -> list[str]:
    """Unfold physical RFC 5545 lines."""
    physical = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    logical: list[str] = []
    for line in physical:
        if line.startswith((" ", "\t")) and logical:
            logical[-1] += line[1:]
        else:
            logical.append(line)
    if logical and logical[-1] == "":
        logical.pop()
    return logical


def escape_text(value: str) -> str:
    """Escape an iCalendar TEXT value."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
    )


def unescape_text(value: str) -> str:
    """Unescape an iCalendar TEXT value."""
    result: list[str] = []
    index = 0
    while index < len(value):
        character = value[index]
        if character != "\\" or index + 1 >= len(value):
            result.append(character)
            index += 1
            continue
        escaped = value[index + 1]
        if escaped in ("n", "N"):
            result.append("\n")
        elif escaped in ("\\", ";", ","):
            result.append(escaped)
        else:
            result.extend(("\\", escaped))
        index += 2
    return "".join(result)


def fold_line(value: str) -> str:
    """Fold a content line at 75 UTF-8 octets."""
    if len(value.encode("utf-8")) <= 75:
        return value
    parts: list[str] = []
    remaining = value
    first = True
    while remaining:
        limit = 75 if first else 74
        current: list[str] = []
        size = 0
        for character in remaining:
            character_size = len(character.encode("utf-8"))
            if size + character_size > limit:
                break
            current.append(character)
            size += character_size
        if not current:
            raise IcsSerializationError("Unable to fold iCalendar line")
        part = "".join(current)
        parts.append(part)
        remaining = remaining[len(part) :]
        first = False
    return "\r\n ".join(parts)


def parse_calendar(value: str, *, default_day_part: DayPart = "morning", strict: bool = False) -> ParseResult:
    """Parse valid AutiPlanner VTODO records from a calendar."""
    warnings: list[IcsWarning] = []
    items: list[RoutineItem] = []
    stack: list[str] = []
    current: list[tuple[str, dict[str, str], str, int]] | None = None
    nested_depth = 0
    saw_calendar = False
    saw_todo = False

    for line_number, line in enumerate(unfold_lines(value), start=1):
        if not line.strip():
            _warn(warnings, strict, IcsWarning("invalid-line", "Blank lines are not valid content lines", line_number))
            continue
        parsed = _parse_property(line, line_number)
        if parsed is None:
            _warn(warnings, strict, IcsWarning("invalid-line", f"Invalid content line: {line}", line_number))
            continue
        name, params, raw_value, text_value, _ = parsed

        if name == "BEGIN":
            component = text_value.strip().upper()
            stack.append(component)
            if component == "VCALENDAR":
                saw_calendar = True
            elif component == "VTODO":
                if current is not None:
                    _warn(warnings, strict, IcsWarning("invalid-component", "Nested VTODO component", line_number))
                else:
                    current = []
                    saw_todo = True
            elif current is not None:
                nested_depth += 1
            elif component != "VCALENDAR":
                _warn(warnings, strict, IcsWarning("unsupported-component", f"Ignoring {component}", line_number))
            continue

        if name == "END":
            component = text_value.strip().upper()
            expected = stack[-1] if stack else None
            if expected != component:
                _warn(
                    warnings,
                    strict,
                    IcsWarning("invalid-component", f"Unexpected END:{component}; expected {expected or '(none)'}", line_number),
                )
            if component == "VTODO" and current is not None and nested_depth == 0:
                item = _item_from_properties(current, default_day_part, warnings, strict)
                if item is not None:
                    items.append(item)
                current = None
                saw_todo = True
            elif current is not None and nested_depth > 0:
                nested_depth -= 1
            if stack:
                stack.pop()
            continue

        if current is not None and nested_depth == 0:
            current.append((name, params, raw_value, text_value, line_number))

    if current is not None:
        _warn(warnings, strict, IcsWarning("missing-component-end", "VTODO is missing END:VTODO"))
        item = _item_from_properties(current, default_day_part, warnings, strict)
        if item is not None:
            items.append(item)
    if stack:
        _warn(warnings, strict, IcsWarning("missing-component-end", f"Missing END:{stack[-1]}"))
    if saw_todo and not saw_calendar:
        _warn(warnings, strict, IcsWarning("missing-calendar-envelope", "VTODO records were outside VCALENDAR"))
    return ParseResult(tuple(items), tuple(warnings))


def serialize_calendar(items: Iterable[RoutineItem], *, dtstamp: datetime | None = None, prodid: str = PRODID) -> str:
    """Serialize routine items into a complete VCALENDAR document."""
    stamp = dtstamp or datetime.now(timezone.utc)
    stamp = _ensure_aware(stamp).astimezone(timezone.utc)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{escape_text(prodid)}",
        "CALSCALE:GREGORIAN",
    ]
    for item in items:
        errors = validate_item(item)
        if errors:
            raise IcsSerializationError(f"Cannot serialize {item.uid}: {'; '.join(errors)}")
        lines.extend(_serialize_item(item, stamp))
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold_line(line) for line in lines) + "\r\n"


def _serialize_item(item: RoutineItem, stamp: datetime) -> list[str]:
    lines = [
        "BEGIN:VTODO",
        f"UID:{escape_text(item.uid)}",
        f"DTSTAMP:{_format_datetime(stamp, utc=True)}",
    ]
    if item.start is not None:
        lines.append(_format_schedule("DTSTART", item.start, item.timezone))
    else:
        lines.append(f"DTSTART;VALUE=DATE:{item.date.replace('-', '')}")
    if item.due is not None:
        lines.append(_format_schedule("DUE", item.due, item.timezone))
    if item.end is not None:
        lines.append(_format_schedule("DTEND", item.end, item.timezone))
    if item.rrule is not None:
        lines.append(f"RRULE:{item.rrule}")
    if item.rdate:
        lines.append(_format_recurrence_list("RDATE", item.rdate, item.timezone))
    if item.exdate:
        lines.append(_format_recurrence_list("EXDATE", item.exdate, item.timezone))
    if item.recurrence_id is not None:
        lines.append(_format_recurrence_value("RECURRENCE-ID", item.recurrence_id, item.timezone))
    lines.append(f"SUMMARY:{escape_text(item.title)}")
    if item.description is not None:
        lines.append(f"DESCRIPTION:{escape_text(item.description)}")
    lines.append(f"STATUS:{'COMPLETED' if item.status == 'completed' else 'NEEDS-ACTION'}")
    if item.status == "completed":
        if item.completed_at is None:
            raise IcsSerializationError(f"Completed item {item.uid} is missing completed_at")
        lines.append(f"COMPLETED:{_format_datetime(item.completed_at, utc=True)}")
    lines.extend((f"{DAY_PART_PROPERTY}:{item.day_part.upper()}", f"{OUTCOME_PROPERTY}:{item.status.upper()}"))
    if item.order is not None:
        lines.append(f"{ORDER_PROPERTY}:{item.order}")
    if item.routine_id is not None:
        lines.append(f"{ROUTINE_ID_PROPERTY}:{escape_text(item.routine_id)}")
    if item.revision is not None:
        lines.append(f"{REVISION_PROPERTY}:{item.revision}")
    if item.tags:
        lines.append(f"CATEGORIES:{','.join(escape_text(tag) for tag in item.tags)}")
    for name, extension_value in sorted(item.extensions.items()):
        normalized = name.upper()
        if not re.fullmatch(r"X-AUTIPLANNER-[A-Z0-9-]+", normalized):
            raise IcsSerializationError(f"Invalid AutiPlanner extension property {name}")
        if normalized not in KNOWN_PROPERTIES:
            lines.append(f"{normalized}:{escape_text(extension_value)}")
    lines.append("END:VTODO")
    return lines


def _item_from_properties(
    properties: list[tuple[str, dict[str, str], str, str, int]],
    default_day_part: DayPart,
    warnings: list[IcsWarning],
    strict: bool,
) -> RoutineItem | None:
    def first(name: str) -> tuple[str, dict[str, str], str, str, int] | None:
        return next((prop for prop in properties if prop[0] == name), None)

    uid_prop = first("UID")
    summary_prop = first("SUMMARY")
    uid = uid_prop[3].strip() if uid_prop else ""
    if not uid:
        _warn(warnings, strict, IcsWarning("missing-required-property", "VTODO is missing UID"))
        return None
    if summary_prop is None or not summary_prop[3].strip():
        _warn(warnings, strict, IcsWarning("missing-required-property", f"VTODO {uid} is missing SUMMARY", uid=uid))
        return None

    schedules: dict[str, tuple[datetime | date, str | None]] = {}
    for field, property_name in (("start", "DTSTART"), ("due", "DUE"), ("end", "DTEND")):
        prop = first(property_name)
        if prop is None:
            continue
        parsed = _parse_datetime(prop[3], prop[1])
        if parsed is None:
            _warn(warnings, strict, IcsWarning("invalid-date-time", f"VTODO {uid} has invalid {property_name}", prop[4], uid))
        else:
            schedules[field] = parsed
    date_source = schedules.get("start") or schedules.get("due") or schedules.get("end")
    if date_source is None:
        _warn(warnings, strict, IcsWarning("missing-required-property", f"VTODO {uid} has no usable schedule", uid=uid))
        return None

    day_prop = first(DAY_PART_PROPERTY)
    day_part = day_prop[3].strip().lower() if day_prop else default_day_part
    if day_part not in DAY_PARTS:
        _warn(warnings, strict, IcsWarning("invalid-day-part", f"VTODO {uid} has invalid day part", uid=uid))
        return None
    if day_prop is None:
        _warn(warnings, strict, IcsWarning("missing-required-property", f"VTODO {uid} used default day part", uid=uid))

    outcome_prop = first(OUTCOME_PROPERTY)
    status_prop = first("STATUS")
    outcome = outcome_prop[3].strip().lower() if outcome_prop else None
    status: RoutineStatus | None = outcome if outcome in ROUTINE_STATUSES else None  # type: ignore[assignment]
    if outcome_prop is not None and status is None:
        _warn(warnings, strict, IcsWarning("invalid-outcome", f"VTODO {uid} has invalid outcome", outcome_prop[4], uid))
    if status is None:
        standard_status = status_prop[3].strip().upper() if status_prop else "NEEDS-ACTION"
        if standard_status == "COMPLETED":
            status = "completed"
        elif standard_status in ("NEEDS-ACTION", ""):
            status = "pending"
        else:
            _warn(warnings, strict, IcsWarning("invalid-status", f"VTODO {uid} has unsupported status", uid=uid))
            return None
    if outcome_prop is None:
        _warn(warnings, strict, IcsWarning("missing-required-property", f"VTODO {uid} derived outcome from STATUS", uid=uid))

    completed_at: datetime | None = None
    completed_prop = first("COMPLETED")
    if completed_prop is not None:
        parsed_completed = _parse_datetime(completed_prop[3], completed_prop[1])
        if isinstance(parsed_completed, tuple):
            completed_at = parsed_completed[0] if isinstance(parsed_completed[0], datetime) else None
        if status != "completed":
            completed_at = None
    if status == "completed" and completed_at is None:
        _warn(warnings, strict, IcsWarning("missing-required-property", f"Completed VTODO {uid} has no COMPLETED timestamp", uid=uid))
        return None

    recurrence_rule = first("RRULE")
    recurrence_id = first("RECURRENCE-ID")
    rdate = _parse_recurrence_values(properties, "RDATE", uid, warnings, strict)
    exdate = _parse_recurrence_values(properties, "EXDATE", uid, warnings, strict)

    start_value = schedules.get("start")
    due_value = schedules.get("due")
    end_value = schedules.get("end")
    item = RoutineItem(
        uid=uid,
        title=summary_prop[3],
        date=(date_source[0].date() if isinstance(date_source[0], datetime) else date_source[0]).isoformat(),
        day_part=day_part,  # type: ignore[arg-type]
        status=status,
        description=first("DESCRIPTION")[3] if first("DESCRIPTION") else None,
        start=start_value[0] if start_value and isinstance(start_value[0], datetime) else None,
        due=due_value[0] if due_value else None,
        end=end_value[0] if end_value and isinstance(end_value[0], datetime) else None,
        timezone=next((value[1] for value in (start_value, due_value, end_value) if value and value[1]), None),
        completed_at=completed_at,
        order=_parse_int(first(ORDER_PROPERTY), uid, warnings, strict),
        routine_id=first(ROUTINE_ID_PROPERTY)[3] if first(ROUTINE_ID_PROPERTY) else None,
        revision=_parse_non_negative_int(first(REVISION_PROPERTY), uid, warnings, strict),
        rrule=recurrence_rule[3].strip() if recurrence_rule and recurrence_rule[3].strip() else None,
        rdate=tuple(rdate),
        exdate=tuple(exdate),
        recurrence_id=_parse_recurrence_value(recurrence_id, uid, warnings, strict) if recurrence_id else None,
        tags=tuple(dict.fromkeys(_parse_categories(properties))),
        extensions={
            name: text
            for name, _, _, text, _ in properties
            if name.startswith("X-AUTIPLANNER-") and name not in KNOWN_PROPERTIES
        },
    )
    if validate_item(item):
        _warn(warnings, strict, IcsWarning("invalid-property", f"VTODO {uid} failed validation", uid=uid))
        return None
    return item


def _parse_property(line: str, line_number: int) -> tuple[str, dict[str, str], str, str, int] | None:
    colon = _find_unquoted(line, ":")
    if colon <= 0:
        return None
    left = line[:colon]
    raw_value = line[colon + 1 :]
    parts = _split_unquoted(left, ";")
    name = parts.pop(0).strip().upper()
    if not re.fullmatch(r"[A-Z0-9-]+", name):
        return None
    params: dict[str, str] = {}
    for part in parts:
        if "=" not in part:
            return None
        key, value = part.split("=", 1)
        value = value.strip()
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        params[key.strip().upper()] = unescape_text(value)
    return name, params, raw_value, unescape_text(raw_value), line_number


def _parse_datetime(value: str, params: Mapping[str, str]) -> tuple[datetime | date, str | None] | None:
    date_match = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", value.strip())
    if date_match:
        try:
            return date(int(date_match[1]), int(date_match[2]), int(date_match[3])), None
        except ValueError:
            return None
    date_time = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?", value.strip())
    if not date_time:
        return None
    try:
        parsed = datetime(
            int(date_time[1]),
            int(date_time[2]),
            int(date_time[3]),
            int(date_time[4]),
            int(date_time[5]),
            int(date_time[6]),
            tzinfo=timezone.utc if date_time[7] else None,
        )
    except ValueError:
        return None
    tzid = params.get("TZID")
    if date_time[7] is None and tzid:
        try:
            parsed = parsed.replace(tzinfo=ZoneInfo(tzid))
        except ZoneInfoNotFoundError:
            return None
    return parsed, tzid if date_time[7] is None else None


def _format_schedule(name: str, value: datetime | date, tzid: str | None) -> str:
    if isinstance(value, date) and not isinstance(value, datetime):
        return f"{name};VALUE=DATE:{value.strftime('%Y%m%d')}"
    if not isinstance(value, datetime):
        raise IcsSerializationError(f"Invalid {name} value")
    if tzid is not None:
        try:
            zone = ZoneInfo(tzid)
        except ZoneInfoNotFoundError as err:
            raise IcsSerializationError(f"Unknown timezone {tzid}") from err
        local_value = value.astimezone(zone).replace(tzinfo=None) if value.tzinfo is not None else value
        return f"{name}{_tzid_parameter(tzid, value)}:{_format_datetime(local_value, utc=False)}"
    if value.tzinfo is not None:
        return f"{name}:{_format_datetime(value, utc=True)}"
    return f"{name}:{_format_datetime(value, utc=False)}"


def _format_recurrence_value(name: str, value: str, tzid: str | None) -> str:
    parsed = _parse_iso_value(value)
    if parsed is None:
        raise IcsSerializationError(f"Invalid {name} value")
    return _format_schedule(name, parsed, tzid)


def _format_recurrence_list(name: str, values: tuple[str, ...], tzid: str | None) -> str:
    parsed = [_parse_iso_value(value) for value in values]
    if any(value is None for value in parsed):
        raise IcsSerializationError(f"Invalid {name} value")
    concrete = [value for value in parsed if value is not None]
    if all(isinstance(value, date) and not isinstance(value, datetime) for value in concrete):
        return f"{name};VALUE=DATE:{','.join(value.strftime('%Y%m%d') for value in concrete)}"
    if any(isinstance(value, date) and not isinstance(value, datetime) for value in concrete):
        raise IcsSerializationError(f"{name} values must use one date/time shape")
    if not all(isinstance(value, datetime) for value in concrete):
        raise IcsSerializationError(f"Invalid {name} value")
    if any(value.tzinfo is not None for value in concrete):
        return f"{name}:{','.join(_format_datetime(value, utc=True) for value in concrete)}"
    tz_parameter = _tzid_parameter(tzid, concrete[0]) if tzid else ""
    return f"{name}{tz_parameter}:{','.join(_format_datetime(value, utc=False) for value in concrete)}"


def _parse_iso_value(value: str) -> datetime | date | None:
    date_match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", value)
    if date_match:
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_recurrence_values(
    properties: list[tuple[str, dict[str, str], str, str, int]],
    name: str,
    uid: str,
    warnings: list[IcsWarning],
    strict: bool,
) -> list[str]:
    values: list[str] = []
    for prop in (property for property in properties if property[0] == name):
        for raw_value in prop[3].split(","):
            parsed = _parse_datetime(raw_value, prop[1])
            if parsed is None:
                _warn(warnings, strict, IcsWarning("invalid-date-time", f"VTODO {uid} has invalid {name}", prop[4], uid))
            else:
                values.append(parsed[0].isoformat())
    return values


def _parse_recurrence_value(
    prop: tuple[str, dict[str, str], str, str, int],
    uid: str,
    warnings: list[IcsWarning],
    strict: bool,
) -> str | None:
    parsed = _parse_datetime(prop[3], prop[1])
    if parsed is None:
        _warn(warnings, strict, IcsWarning("invalid-date-time", f"VTODO {uid} has invalid RECURRENCE-ID", prop[4], uid))
        return None
    return parsed[0].isoformat()


def _format_datetime(value: datetime, *, utc: bool) -> str:
    value = _ensure_aware(value) if utc else value
    if utc:
        value = value.astimezone(timezone.utc)
        return value.strftime("%Y%m%dT%H%M%SZ")
    return value.strftime("%Y%m%dT%H%M%S")


def _tzid_parameter(tzid: str | None, value: datetime) -> str:
    if tzid is None:
        return ""
    safe = tzid.replace("\\", "\\\\").replace('"', '\\"')
    return f";TZID=\"{safe}\""


def _parse_categories(properties: list[tuple[str, dict[str, str], str, str, int]]) -> list[str]:
    tags: list[str] = []
    for name, _, raw_value, _, _ in properties:
        if name != "CATEGORIES":
            continue
        tags.extend(unescape_text(part) for part in _split_escaped(raw_value, ","))
    return [tag for tag in tags if tag]


def _parse_int(prop: tuple[str, dict[str, str], str, str, int] | None, uid: str, warnings: list[IcsWarning], strict: bool) -> int | None:
    if prop is None:
        return None
    try:
        return int(prop[3])
    except ValueError:
        _warn(warnings, strict, IcsWarning("invalid-number", f"VTODO {uid} has invalid number", prop[4], uid))
        return None


def _parse_non_negative_int(prop: tuple[str, dict[str, str], str, str, int] | None, uid: str, warnings: list[IcsWarning], strict: bool) -> int | None:
    value = _parse_int(prop, uid, warnings, strict)
    if value is not None and value < 0:
        _warn(warnings, strict, IcsWarning("invalid-number", f"VTODO {uid} has negative revision", prop[4] if prop else None, uid))
        return None
    return value


def _find_unquoted(value: str, target: str) -> int:
    quoted = False
    for index, character in enumerate(value):
        if character == '"':
            quoted = not quoted
        elif character == target and not quoted:
            return index
    return -1


def _split_unquoted(value: str, delimiter: str) -> list[str]:
    parts: list[str] = []
    start = 0
    quoted = False
    for index, character in enumerate(value):
        if character == '"':
            quoted = not quoted
        elif character == delimiter and not quoted:
            parts.append(value[start:index])
            start = index + 1
    parts.append(value[start:])
    return parts


def _split_escaped(value: str, delimiter: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    index = 0
    while index < len(value):
        if value[index] == "\\" and index + 1 < len(value):
            current.extend((value[index], value[index + 1]))
            index += 2
        elif value[index] == delimiter:
            parts.append("".join(current))
            current = []
            index += 1
        else:
            current.append(value[index])
            index += 1
    parts.append("".join(current))
    return parts


def _ensure_aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _warn(warnings: list[IcsWarning], strict: bool, entry: IcsWarning) -> None:
    if strict:
        raise IcsParseError(entry)
    warnings.append(entry)
