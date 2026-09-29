from __future__ import annotations

from dataclasses import dataclass, field

DAY_PARTS = ("morning", "afternoon", "evening", "night")
STATUSES = ("pending", "completed", "missed", "skipped")
WEEKDAY_CODES = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")


@dataclass
class RecurrenceRule:
    freq: str
    interval: int = 1
    count: int | None = None
    until: str | None = None
    by_day: tuple[str, ...] = ()


@dataclass
class RoutineItem:
    uid: str
    title: str
    date: str
    day_part: str
    status: str
    description: str | None = None
    start: str | None = None
    end: str | None = None
    due: str | None = None
    timezone: str | None = None
    completed_at: str | None = None
    order: int | None = None
    routine_id: str | None = None
    revision: int | None = None
    tags: tuple[str, ...] = ()
    extensions: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "uid": self.uid,
            "title": self.title,
            "date": self.date,
            "dayPart": self.day_part,
            "status": self.status,
        }
        if self.description is not None:
            payload["description"] = self.description
        if self.start is not None:
            payload["start"] = self.start
        if self.end is not None:
            payload["end"] = self.end
        if self.due is not None:
            payload["due"] = self.due
        if self.timezone is not None:
            payload["timezone"] = self.timezone
        if self.completed_at is not None:
            payload["completedAt"] = self.completed_at
        if self.order is not None:
            payload["order"] = self.order
        if self.routine_id is not None:
            payload["routineId"] = self.routine_id
        if self.revision is not None:
            payload["revision"] = self.revision
        if self.tags:
            payload["tags"] = list(self.tags)
        if self.extensions:
            payload["extensions"] = dict(self.extensions)
        return payload


@dataclass
class RoutineTemplate:
    uid: str
    title: str
    day_part: str
    date: str
    recurrence: RecurrenceRule
    description: str | None = None
    start: str | None = None
    due: str | None = None
    timezone: str | None = None
    order: int | None = None
    exdates: tuple[str, ...] = ()
    rdates: tuple[str, ...] = ()
    extensions: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "uid": self.uid,
            "title": self.title,
            "dayPart": self.day_part,
            "date": self.date,
            "recurrence": {
                "freq": self.recurrence.freq,
                "interval": self.recurrence.interval,
                "count": self.recurrence.count,
                "until": self.recurrence.until,
                "byDay": list(self.recurrence.by_day),
            },
            "exdates": list(self.exdates),
            "rdates": list(self.rdates),
        }


def occurrence_uid(series_uid: str, date: str) -> str:
    return f"{series_uid}:{date}"
