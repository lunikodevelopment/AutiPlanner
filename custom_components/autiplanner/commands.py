"""Command translation.

This is the single command entry point for the Home Assistant services, the
websocket API, and the HTTP API. It deliberately imports no Home Assistant code
so the vocabulary can be tested on its own.

The command names follow docs/ARCHITECTURE.md section 7. Field names are
accepted in snake_case (services) and camelCase (the Android app serializes the
domain model directly).
"""

from __future__ import annotations

from .const import ATTR_DAY_PART, ATTR_UID
from .model import RecurrenceRule, RoutineItem, RoutineTemplate
from .store import RoutineError, RoutineStore

OUTCOME_COMMANDS = ("complete", "mark_missed", "skip", "reset")
CRUD_COMMANDS = ("create", "update", "delete")
SERIES_COMMANDS = ("add_series",)

ALL_COMMANDS = OUTCOME_COMMANDS + CRUD_COMMANDS + SERIES_COMMANDS


async def apply_command(
    store: RoutineStore,
    command: str,
    payload: dict,
    uid: str | None,
    expected: int | None,
) -> object | None:
    """Applies one command and returns the resulting record."""
    if command == "complete":
        return await store.complete(uid or "", payload.get("completed_at"), expected)
    if command == "mark_missed":
        return await store.mark_missed(uid or "", expected)
    if command == "skip":
        return await store.skip(uid or "", expected)
    if command == "reset":
        return await store.reset(uid or "", expected)
    if command == "create":
        try:
            item = item_from_payload(payload)
        except ValueError as error:
            raise RoutineError("invalid-item", str(error)) from error
        return await store.create(item)
    if command == "update":
        patch = {key: value for key, value in payload.items() if key != ATTR_UID}
        return await store.update(uid or "", patch, expected)
    if command == "delete":
        return await store.delete(uid or "", expected)
    if command == "add_series":
        try:
            template = series_from_payload(payload)
        except ValueError as error:
            raise RoutineError("invalid-item", str(error)) from error
        return await store.add_series(template)
    raise RoutineError("invalid-item", f"unknown command {command}")


def item_from_payload(payload: dict) -> RoutineItem:
    uid = _first_key(payload, ATTR_UID, "uid")
    title = _first_key(payload, "title")
    date = _first_key(payload, "date")
    day_part = _first_key(payload, ATTR_DAY_PART, "dayPart")
    status = _first_key(payload, "status") or "pending"

    missing = [
        name
        for name, value in (
            ("uid", uid),
            ("title", title),
            ("date", date),
            ("day_part", day_part),
        )
        if not value
    ]
    if missing:
        raise ValueError(f"create requires {', '.join(missing)}")

    return RoutineItem(
        uid=str(uid),
        title=str(title),
        date=str(date),
        day_part=str(day_part),
        status=str(status),
        description=_optional(payload, "description"),
        start=_optional(payload, "start"),
        due=_first_key(payload, "due"),
        timezone=_optional(payload, "timezone"),
        order=_optional(payload, "order"),
    )


def series_from_payload(payload: dict) -> RoutineTemplate:
    uid = _first_key(payload, ATTR_UID, "uid")
    title = _first_key(payload, "title")
    date = _first_key(payload, "date")
    day_part = _first_key(payload, ATTR_DAY_PART, "dayPart")
    rule = payload.get("recurrence")
    missing = [
        name
        for name, value in (
            ("uid", uid),
            ("title", title),
            ("date", date),
            ("day_part", day_part),
            ("recurrence", rule),
        )
        if not value
    ]
    if missing:
        raise ValueError(f"add_series requires {', '.join(missing)}")
    if not isinstance(rule, dict) or not rule.get("freq"):
        raise ValueError("recurrence requires a freq")

    return RoutineTemplate(
        uid=str(uid),
        title=str(title),
        date=str(date),
        day_part=str(day_part),
        recurrence=RecurrenceRule(
            freq=str(rule["freq"]),
            interval=int(rule.get("interval", 1)),
            count=rule.get("count"),
            until=rule.get("until"),
            by_day=tuple(rule.get("by_day", ())),
        ),
        description=_optional(payload, "description"),
        start=_optional(payload, "start"),
        due=_first_key(payload, "due"),
        order=_optional(payload, "order"),
    )


def _first_key(payload: dict, *names: str) -> object | None:
    for name in names:
        if name in payload:
            return payload[name]
    return None


def _optional(payload: dict, name: str) -> object | None:
    value = payload.get(name)
    return None if value is None else value
