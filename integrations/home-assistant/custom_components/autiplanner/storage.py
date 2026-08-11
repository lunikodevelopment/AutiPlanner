"""Locked, atomic persistence for the AutiPlanner ICS store."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime
import os
from pathlib import Path
import tempfile
from typing import Callable, Iterable

from .ics import IcsWarning, parse_calendar, serialize_calendar
from .model import DAY_PARTS, DayPart, MutationResult, RoutineItem, RoutineStatus, validate_item


class StoreItemNotFound(LookupError):
    """Raised when a mutation references an unknown UID."""


class StoreDuplicateUid(ValueError):
    """Raised when a new item would reuse an existing UID."""


class StoreValidationError(ValueError):
    """Raised when a mutation would persist an invalid item."""


@dataclass(frozen=True, slots=True)
class StoreSnapshot:
    items: tuple[RoutineItem, ...]
    warnings: tuple[IcsWarning, ...]


class RoutineStore:
    """Single-writer store shared by the Home Assistant entities and services."""

    def __init__(self, path: Path, *, default_day_part: str = "morning") -> None:
        if default_day_part not in DAY_PARTS:
            raise ValueError(f"Unsupported default day part: {default_day_part}")
        self.path = path
        self.default_day_part: DayPart = default_day_part  # type: ignore[assignment]
        self._lock = asyncio.Lock()
        self._items: tuple[RoutineItem, ...] = ()
        self._warnings: tuple[IcsWarning, ...] = ()
        self._loaded = False
        self._listeners: list[Callable[[StoreSnapshot], None]] = []

    @property
    def snapshot(self) -> StoreSnapshot:
        """Return the current in-memory snapshot without file I/O."""
        return StoreSnapshot(self._items, self._warnings)

    @property
    def items(self) -> tuple[RoutineItem, ...]:
        """Return the ordered in-memory items."""
        return self._items

    def add_listener(self, listener: Callable[[StoreSnapshot], None]) -> Callable[[], None]:
        """Register a synchronous event-loop callback and return its remover."""
        self._listeners.append(listener)

        def remove() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return remove

    async def async_load(self) -> StoreSnapshot:
        """Load the calendar once and create an empty calendar if absent."""
        async with self._lock:
            if self._loaded:
                return self.snapshot
            snapshot, missing = await asyncio.to_thread(self._read_sync)
            self._items = snapshot.items
            self._warnings = snapshot.warnings
            self._loaded = True
            if missing:
                await asyncio.to_thread(self._write_sync, self._items)
            return self.snapshot

    async def async_set_status(
        self,
        uid: str,
        status: RoutineStatus,
        completed_at: datetime | None,
    ) -> MutationResult:
        """Set an outcome atomically and return the resulting item."""
        if status not in ("pending", "completed", "missed", "skipped"):
            raise StoreValidationError(f"Unsupported routine status: {status}")
        async with self._lock:
            await self._async_ensure_loaded()
            index, current = self._find(uid)
            desired_completed_at = completed_at if status == "completed" else None
            if current.status == status and current.completed_at == desired_completed_at:
                return MutationResult(current, False)
            updated = current.with_changes(
                status=status,
                completed_at=desired_completed_at,
                revision=(current.revision or 0) + 1,
            )
            self._validate(updated)
            items = list(self._items)
            items[index] = updated
            await self._async_commit(tuple(items))
            return MutationResult(updated, True)

    async def async_create_item(self, item: RoutineItem) -> MutationResult:
        """Create an item atomically."""
        self._validate(item)
        async with self._lock:
            await self._async_ensure_loaded()
            if any(existing.uid == item.uid for existing in self._items):
                raise StoreDuplicateUid(f"Routine UID already exists: {item.uid}")
            await self._async_commit((*self._items, item))
            return MutationResult(item, True)

    async def async_update_item(self, item: RoutineItem) -> MutationResult:
        """Replace an existing item while retaining its UID and incrementing revision."""
        async with self._lock:
            await self._async_ensure_loaded()
            index, current = self._find(item.uid)
            updated = item.with_changes(revision=(current.revision or 0) + 1)
            self._validate(updated)
            if updated == current:
                return MutationResult(current, False)
            items = list(self._items)
            items[index] = updated
            await self._async_commit(tuple(items))
            return MutationResult(updated, True)

    async def async_delete_items(self, uids: Iterable[str]) -> tuple[str, ...]:
        """Delete one or more items atomically."""
        requested = tuple(dict.fromkeys(uids))
        async with self._lock:
            await self._async_ensure_loaded()
            existing = {item.uid for item in self._items}
            missing = [uid for uid in requested if uid not in existing]
            if missing:
                raise StoreItemNotFound(f"Routine UID not found: {missing[0]}")
            if not requested:
                return ()
            remaining = tuple(item for item in self._items if item.uid not in requested)
            await self._async_commit(remaining)
            return requested

    async def async_move_item(self, uid: str, previous_uid: str | None = None) -> MutationResult:
        """Move an item and persist deterministic display order values."""
        async with self._lock:
            await self._async_ensure_loaded()
            _, current = self._find(uid)
            if previous_uid == uid:
                raise StoreValidationError("An item cannot be moved after itself")
            items = [item for item in self._items if item.uid != uid]
            if previous_uid is None:
                insert_at = 0
            else:
                try:
                    insert_at = next(index for index, item in enumerate(items) if item.uid == previous_uid) + 1
                except StopIteration as err:
                    raise StoreItemNotFound(f"Routine UID not found: {previous_uid}") from err
            items.insert(insert_at, current)
            reordered = tuple(
                item.with_changes(order=(index + 1) * 10, revision=(item.revision or 0) + (1 if item.uid == uid else 0))
                for index, item in enumerate(items)
            )
            if reordered == self._items:
                return MutationResult(current, False)
            await self._async_commit(reordered)
            moved = next(item for item in reordered if item.uid == uid)
            return MutationResult(moved, True)

    async def _async_ensure_loaded(self) -> None:
        if not self._loaded:
            snapshot, missing = await asyncio.to_thread(self._read_sync)
            self._items = snapshot.items
            self._warnings = snapshot.warnings
            self._loaded = True
            if missing:
                await asyncio.to_thread(self._write_sync, self._items)

    async def _async_commit(self, items: tuple[RoutineItem, ...]) -> None:
        await asyncio.to_thread(self._write_sync, items)
        self._items = items
        self._notify()

    def _find(self, uid: str) -> tuple[int, RoutineItem]:
        for index, item in enumerate(self._items):
            if item.uid == uid:
                return index, item
        raise StoreItemNotFound(f"Routine UID not found: {uid}")

    def _validate(self, item: RoutineItem) -> None:
        errors = validate_item(item)
        if errors:
            raise StoreValidationError(f"Invalid routine {item.uid}: {'; '.join(errors)}")

    def _notify(self) -> None:
        snapshot = self.snapshot
        for listener in tuple(self._listeners):
            listener(snapshot)

    def _read_sync(self) -> tuple[StoreSnapshot, bool]:
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return StoreSnapshot((), ()), True
        snapshot = parse_calendar(text, default_day_part=self.default_day_part)
        return StoreSnapshot(snapshot.items, snapshot.warnings), False

    def _write_sync(self, items: Iterable[RoutineItem]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        text = serialize_calendar(items)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{self.path.name}.",
            suffix=".tmp",
            dir=self.path.parent,
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as temporary:
                temporary.write(text)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.chmod(temporary_name, 0o600)
            os.replace(temporary_name, self.path)
        except BaseException:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
            raise
