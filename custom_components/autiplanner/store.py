"""Single-writer calendar store.

Home Assistant owns the ICS file. Clients send commands; they never write it
directly. Mutations are serialized by a lock and persisted with an atomic
replace so a crash cannot leave a truncated calendar behind.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path

from . import ics
from .model import DAY_PARTS, STATUSES, RoutineItem, RoutineTemplate, occurrence_uid
from .recurrence import RecurrenceError, expand_series


class RoutineError(Exception):
    """Raised for client-visible failures."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class RoutineStore:
    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path)
        self._lock = asyncio.Lock()
        self._items: list[RoutineItem] = []
        self._series: list[RoutineTemplate] = []
        self._preserved: list[str] = []
        self._issues: list[tuple[str, str]] = []
        self._revision: int | None = None

    # ------------------------------------------------------------------ load

    def load(self) -> None:
        """Reads the configured file. Missing files start an empty calendar."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write()
            return
        text = self.path.read_text(encoding="utf-8")
        if not text.strip():
            self._items = []
            self._series = []
            self._preserved = []
            self._issues = [("empty-calendar", "calendar file is empty")]
            return
        parsed = ics.parse_calendar(text)
        self._items = parsed.items
        self._series = parsed.series
        self._preserved = parsed.preserved
        self._issues = parsed.issues

    @property
    def issues(self) -> list[tuple[str, str]]:
        return list(self._issues)

    @property
    def revision(self) -> int | None:
        return self._revision

    def snapshot(self) -> list[RoutineItem]:
        return list(self._items)

    def get(self, uid: str) -> RoutineItem:
        for item in self._items:
            if item.uid == uid:
                return item
        raise RoutineError("not-found", f"no routine item with uid {uid}")

    def _find_series(self, uid: str) -> RoutineTemplate | None:
        """Resolves an occurrence uid such as ``series@x:2026-08-12``."""
        for template in self._series:
            if uid == occurrence_uid(template.uid, uid.rsplit(":", 1)[-1]):
                return template
        return None

    def _materialize(self, uid: str) -> RoutineItem | None:
        """Creates a stored occurrence record the first time it is written.

        Only that one occurrence is persisted. The series is never completed
        and no other occurrence is materialized.
        """
        if ":" not in uid:
            return None
        date = uid.rsplit(":", 1)[-1]
        template = self._find_series(uid)
        if template is None:
            return None
        try:
            window = expand_series(template, date, _plus_day(date), self._items)
        except RecurrenceError:
            return None
        for entry in window:
            if entry.uid == uid:
                return entry
        return None

    # ------------------------------------------------------------------ read

    def items_for_range(self, start: str, end: str) -> list[RoutineItem]:
        """Returns occurrences and one-off items overlapping [start, end)."""
        within = [item for item in self._items if start <= item.date < end]
        known = {item.uid for item in within}
        for template in self._series:
            try:
                expanded = expand_series(template, start, end, self._items)
            except RecurrenceError:
                continue
            for item in expanded:
                if item.uid not in known:
                    within.append(item)
                    known.add(item.uid)
        within.sort(key=lambda item: (item.date, item.order if item.order is not None else 0, item.title))
        return within

    # -------------------------------------------------------------- mutation

    async def complete(self, uid: str, completed_at: str, expected_revision: int | None = None) -> RoutineItem:
        return await self._set_outcome(uid, "completed", completed_at, expected_revision)

    async def mark_missed(self, uid: str, expected_revision: int | None = None) -> RoutineItem:
        return await self._set_outcome(uid, "missed", None, expected_revision)

    async def skip(self, uid: str, expected_revision: int | None = None) -> RoutineItem:
        return await self._set_outcome(uid, "skipped", None, expected_revision)

    async def reset(self, uid: str, expected_revision: int | None = None) -> RoutineItem:
        return await self._set_outcome(uid, "pending", None, expected_revision)

    async def create(self, item: RoutineItem, expected_revision: int | None = None) -> RoutineItem:
        async with self._lock:
            if any(existing.uid == item.uid for existing in self._items):
                raise RoutineError("duplicate-uid", f"uid already exists: {item.uid}")
            if any(existing.uid == item.uid for existing in self._series):
                raise RoutineError("duplicate-uid", f"uid already exists: {item.uid}")
            if item.day_part not in DAY_PARTS:
                raise RoutineError("invalid-item", f"unknown day part {item.day_part}")
            if item.status not in STATUSES:
                raise RoutineError("invalid-item", f"unknown outcome {item.status}")
            if item.status == "completed" and not item.completed_at:
                raise RoutineError("invalid-item", "completed items require completedAt")
            if item.status != "completed" and item.completed_at:
                raise RoutineError("invalid-item", "only completed items may carry completedAt")
            stored = _clone(item)
            stored.revision = 0
            self._items.append(stored)
            self._write()
            return stored

    async def update(
        self,
        uid: str,
        patch: dict[str, object],
        expected_revision: int | None = None,
    ) -> RoutineItem:
        async with self._lock:
            current = self._resolve(uid)
            if current is None:
                raise RoutineError("not-found", f"no routine item with uid {uid}")
            self._check_revision(current, expected_revision)
            updated = _clone(current)
            for key, value in patch.items():
                if key == "uid":
                    raise RoutineError("invalid-item", "uid is immutable")
                if key not in {
                    "title",
                    "description",
                    "date",
                    "start",
                    "end",
                    "due",
                    "timezone",
                    "day_part",
                    "status",
                    "completed_at",
                    "order",
                    "tags",
                    "extensions",
                }:
                    raise RoutineError("invalid-item", f"field cannot be patched: {key}")
                if value is None and key not in {
                    "description",
                    "start",
                    "end",
                    "due",
                    "timezone",
                    "completed_at",
                    "order",
                    "tags",
                    "extensions",
                }:
                    raise RoutineError("invalid-item", f"field must not be null: {key}")
                setattr(updated, key, value)
            self._validate(updated)
            updated.revision = (current.revision or 0) + 1
            self._replace(current.uid, updated)
            self._write()
            return updated

    async def delete(self, uid: str, expected_revision: int | None = None) -> RoutineItem:
        async with self._lock:
            current = self._resolve(uid)
            if current is None:
                raise RoutineError("not-found", f"no routine item with uid {uid}")
            self._check_revision(current, expected_revision)
            for template in self._series:
                if template.uid == uid:
                    self._series = [entry for entry in self._series if entry.uid != uid]
                    self._write()
                    return current
            self._items = [item for item in self._items if item.uid != uid]
            self._write()
            return current

    def _resolve(self, uid: str) -> RoutineItem | None:
        """An existing item, or a series occurrence that can be materialized."""
        for item in self._items:
            if item.uid == uid:
                return item
        for template in self._series:
            if template.uid == uid:
                # A series master is never a completable occurrence.
                raise RoutineError(
                    "series-completion",
                    "a series master cannot be completed; target one occurrence",
                )
        materialized = self._materialize(uid)
        if materialized is not None:
            stored = _clone(materialized)
            stored.revision = 0
            self._items.append(stored)
            return stored
        return None

    async def add_series(self, template: RoutineTemplate) -> RoutineTemplate:
        async with self._lock:
            if template.day_part not in DAY_PARTS:
                raise RoutineError("invalid-item", f"unknown day part {template.day_part}")
            # A uid must be unique across items and series: they share one
            # namespace in the calendar, and a collision would make
            # occurrence resolution ambiguous.
            if any(entry.uid == template.uid for entry in self._series) or any(
                entry.uid == template.uid for entry in self._items
            ):
                raise RoutineError("duplicate-uid", f"uid already exists: {template.uid}")
            self._series.append(template)
            self._write()
            return template

    async def _set_outcome(
        self,
        uid: str,
        status: str,
        completed_at: str | None,
        expected_revision: int | None,
    ) -> RoutineItem:
        async with self._lock:
            current = self._resolve(uid)
            if current is None:
                raise RoutineError("not-found", f"no routine item with uid {uid}")
            self._check_revision(current, expected_revision)
            if current.status == status and (
                status != "completed" or current.completed_at == completed_at
            ):
                return current
            updated = _clone(current)
            if status == "completed":
                if not completed_at:
                    raise RoutineError("invalid-item", "completedAt is required")
                updated.status = "completed"
                updated.completed_at = completed_at
            else:
                updated.status = status
                updated.completed_at = None
            self._validate(updated)
            updated.revision = (current.revision or 0) + 1
            self._replace(uid, updated)
            self._write()
            return updated

    def _check_revision(self, item: RoutineItem, expected: int | None) -> None:
        if expected is None:
            return
        actual = item.revision or 0
        if expected != actual:
            raise RoutineError(
                "conflict",
                f"revision conflict for {item.uid}: expected {expected}, actual {actual}",
            )

    def _validate(self, item: RoutineItem) -> None:
        if item.status not in STATUSES:
            raise RoutineError("invalid-item", f"unknown outcome {item.status}")
        if item.day_part not in DAY_PARTS:
            raise RoutineError("invalid-item", f"unknown day part {item.day_part}")
        if not item.title.strip():
            raise RoutineError("invalid-item", "title must not be empty")
        if item.status == "completed" and not item.completed_at:
            raise RoutineError("invalid-item", "completed items require completedAt")
        if item.status != "completed" and item.completed_at:
            raise RoutineError("invalid-item", "only completed items may carry completedAt")

    def _replace(self, uid: str, item: RoutineItem) -> None:
        self._items = [existing for existing in self._items if existing.uid != uid]
        self._items.append(item)

    # ------------------------------------------------------------ persistence

    def _write(self) -> None:
        """Atomic replace on the same filesystem."""
        text = ics.serialize_calendar(self._items, self._series, self._preserved)
        directory = self.path.parent
        handle, temporary = tempfile.mkstemp(dir=str(directory), prefix=".autiplanner-", suffix=".ics")
        try:
            with os.fdopen(handle, "w", encoding="utf-8", newline="") as stream:
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        except Exception:
            Path(temporary).unlink(missing_ok=True)
            raise
        self._revision = (self._revision or 0) + 1


def _plus_day(date: str) -> str:
    import datetime as dt

    return (dt.date.fromisoformat(date) + dt.timedelta(days=1)).isoformat()


def _clone(item: RoutineItem) -> RoutineItem:
    return RoutineItem(
        uid=item.uid,
        title=item.title,
        date=item.date,
        day_part=item.day_part,
        status=item.status,
        description=item.description,
        start=item.start,
        end=item.end,
        due=item.due,
        timezone=item.timezone,
        completed_at=item.completed_at,
        order=item.order,
        routine_id=item.routine_id,
        revision=item.revision,
        tags=item.tags,
        extensions=dict(item.extensions),
    )


__all__ = [
    "DAY_PARTS",
    "STATUSES",
    "RecurrenceError",
    "RoutineError",
    "RoutineItem",
    "RoutineStore",
    "RoutineTemplate",
    "expand_series",
    "occurrence_uid",
]
