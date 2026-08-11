"""Provider-neutral Python model used by the Home Assistant boundary."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, datetime
from typing import Mapping, Literal

DayPart = Literal["morning", "afternoon", "evening", "night"]
RoutineStatus = Literal["pending", "completed", "missed", "skipped"]
DAY_PARTS: tuple[DayPart, ...] = ("morning", "afternoon", "evening", "night")
ROUTINE_STATUSES: tuple[RoutineStatus, ...] = ("pending", "completed", "missed", "skipped")


@dataclass(frozen=True, slots=True)
class RoutineItem:
    """A persisted AutiPlanner routine item."""

    uid: str
    title: str
    date: str
    day_part: DayPart
    status: RoutineStatus
    description: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    due: datetime | date | None = None
    timezone: str | None = None
    completed_at: datetime | None = None
    order: int | None = None
    routine_id: str | None = None
    revision: int | None = None
    rrule: str | None = None
    rdate: tuple[str, ...] = ()
    exdate: tuple[str, ...] = ()
    recurrence_id: str | None = None
    tags: tuple[str, ...] = ()
    extensions: Mapping[str, str] = field(default_factory=dict)

    def with_changes(self, **changes: object) -> "RoutineItem":
        """Return a changed item while preserving its stable UID."""
        if "uid" in changes and changes["uid"] != self.uid:
            raise ValueError("A routine UID cannot change")
        return replace(self, **changes)


@dataclass(frozen=True, slots=True)
class MutationResult:
    """The resulting item and whether persistence changed."""

    item: RoutineItem
    changed: bool


def validate_item(item: RoutineItem) -> tuple[str, ...]:
    """Return validation errors without mutating the item."""
    errors: list[str] = []
    if not item.uid.strip():
        errors.append("uid must not be empty")
    if not item.title.strip():
        errors.append("title must not be empty")
    if not _is_valid_date(item.date):
        errors.append("date must use a valid YYYY-MM-DD value")
    if item.day_part not in DAY_PARTS:
        errors.append("day_part must be a supported day part")
    if item.status not in ROUTINE_STATUSES:
        errors.append("status must be a supported routine status")
    if item.status == "completed" and item.completed_at is None:
        errors.append("completed items require completed_at")
    if item.status != "completed" and item.completed_at is not None:
        errors.append("only completed items may carry completed_at")
    if item.revision is not None and item.revision < 0:
        errors.append("revision must be non-negative")
    return tuple(errors)


def _is_valid_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return len(value) == 10
