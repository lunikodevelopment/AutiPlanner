"""Pure request and response helpers for the AutiPlanner HTTP API.

This module deliberately imports no Home Assistant and no aiohttp code, so the
request validation and payload shaping can be unit tested without the Home
Assistant test harness. ``http.py`` is the thin aiohttp layer on top.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

DEFAULT_LIMIT = 14
MIN_LIMIT = 1
MAX_LIMIT = 90

#: Commands a client may send. Mirrors docs/ARCHITECTURE.md section 7.
COMMANDS = (
    "complete",
    "mark_missed",
    "skip",
    "reset",
    "create",
    "update",
    "delete",
)

#: RoutineError.code -> (HTTP status, client-facing code).
ERROR_CODES: dict[str, tuple[int, str]] = {
    "not-found": (404, "autiplanner_not_found"),
    "conflict": (409, "autiplanner_conflict"),
    "duplicate-uid": (409, "autiplanner_duplicate_uid"),
    "series-completion": (409, "autiplanner_series_completion"),
    "invalid-item": (400, "autiplanner_invalid"),
    "invalid-patch": (400, "autiplanner_invalid"),
}


class ApiError(ValueError):
    """A client-visible request error."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def normalize_entity_ids(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, (list, tuple)):
        return [entry for entry in value if isinstance(entry, str) and entry]
    raise ApiError("entity_id must be a string or a list of strings")


def normalize_limit(value: Any) -> int:
    if value is None:
        return DEFAULT_LIMIT
    if isinstance(value, bool) or not isinstance(value, int):
        raise ApiError("limit must be an integer")
    if not MIN_LIMIT <= value <= MAX_LIMIT:
        raise ApiError(f"limit must be between {MIN_LIMIT} and {MAX_LIMIT}")
    return value


def normalize_date(value: Any, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ApiError(f"{field_name} must be a date")
    try:
        dt.date.fromisoformat(value)
    except ValueError as error:
        raise ApiError(f"{field_name} must be a date in YYYY-MM-DD form") from error
    return value


@dataclass
class CommandRequest:
    command: str
    uid: str | None
    expected_revision: int | None
    completed_at: str | None
    item: dict[str, Any] = field(default_factory=dict)
    patch: dict[str, Any] = field(default_factory=dict)


def parse_command(payload: dict[str, Any]) -> CommandRequest:
    command = payload.get("command")
    if command not in COMMANDS:
        raise ApiError(f"command must be one of {', '.join(COMMANDS)}")

    uid = payload.get("uid")
    if uid is not None and not isinstance(uid, str):
        raise ApiError("uid must be a string")

    expected = payload.get("expected_revision")
    if expected is not None:
        if isinstance(expected, bool) or not isinstance(expected, int):
            raise ApiError("expected_revision must be an integer")
        if expected < 0:
            raise ApiError("expected_revision must not be negative")

    completed_at = payload.get("completed_at")
    if completed_at is not None and not isinstance(completed_at, str):
        raise ApiError("completed_at must be a string")

    item = payload.get("item") or {}
    patch = payload.get("patch") or {}
    if not isinstance(item, dict):
        raise ApiError("item must be an object")
    if not isinstance(patch, dict):
        raise ApiError("patch must be an object")

    needs_uid = command in ("complete", "mark_missed", "skip", "reset", "update", "delete")
    if needs_uid and not uid:
        raise ApiError(f"{command} requires a uid")

    if command == "complete" and completed_at is not None and not _is_utc(completed_at):
        raise ApiError("completed_at must be an ISO-8601 UTC timestamp ending in Z")

    return CommandRequest(
        command=command,
        uid=uid,
        expected_revision=expected,
        completed_at=completed_at,
        item=item,
        patch=patch,
    )


def item_payload(item: Any) -> dict[str, Any]:
    """The client-facing item shape.

    ``dayPart`` and ``status`` are passed through verbatim so a missed or
    skipped routine is never reduced to a boolean by the API.
    """
    payload: dict[str, Any] = {
        "uid": item.uid,
        "title": item.title,
        "date": item.date,
        "dayPart": item.day_part,
        "status": item.status,
    }
    optional = {
        "description": item.description,
        "start": item.start,
        "due": item.due,
        "timezone": item.timezone,
        "completedAt": item.completed_at,
        "order": item.order,
        "routineId": item.routine_id,
        "revision": item.revision,
    }
    for key, value in optional.items():
        if value is not None:
            payload[key] = value
    return payload


def agenda_payload(
    items: list[Any],
    revision: int | None,
    issues: list[str] | None = None,
    window_start: str | None = None,
    window_end: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "items": [item_payload(item) for item in items],
        "revision": revision,
        "issues": list(issues or []),
    }
    if window_start is not None:
        payload["windowStart"] = window_start
    if window_end is not None:
        payload["windowEnd"] = window_end
    return payload


def command_payload(item: Any = None, changed: bool = True) -> dict[str, Any]:
    """A command result returns the resulting item, never a bare boolean."""
    payload: dict[str, Any] = {"success": True, "changed": changed}
    if item is not None and hasattr(item, "uid"):
        payload["item"] = item_payload(item)
    return payload


def error_payload(code: str, message: str) -> dict[str, Any]:
    return {"success": False, "error": {"code": code, "message": message}}


def error_for(code: str, message: str) -> tuple[int, dict[str, Any]]:
    status, client_code = ERROR_CODES.get(code, (500, "autiplanner_error"))
    return status, error_payload(client_code, message)


def _is_utc(value: str) -> bool:
    if not value.endswith("Z"):
        return False
    try:
        dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True
