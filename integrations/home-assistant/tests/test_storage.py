from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

import pytest

from custom_components.autiplanner.ics import parse_calendar
from custom_components.autiplanner.model import RoutineItem
from custom_components.autiplanner.storage import (
    RoutineStore,
    StoreItemNotFound,
    StoreValidationError,
)


def _item(uid: str = "routine-1") -> RoutineItem:
    return RoutineItem(
        uid=uid,
        title="Take medication",
        date="2026-08-11",
        start=datetime(2026, 8, 11, 8, tzinfo=timezone.utc),
        day_part="morning",
        status="pending",
    )


def test_missing_file_is_created_and_mutations_survive_reload(tmp_path: Path) -> None:
    path = tmp_path / "calendar.ics"

    async def scenario() -> None:
        store = RoutineStore(path)
        await store.async_load()
        assert path.exists()
        await store.async_create_item(_item())
        await store.async_set_status("routine-1", "completed", datetime(2026, 8, 11, 8, 5, tzinfo=timezone.utc))

        reloaded = RoutineStore(path)
        snapshot = await reloaded.async_load()
        assert snapshot.items[0].status == "completed"
        assert snapshot.items[0].completed_at is not None

    asyncio.run(scenario())


def test_concurrent_mutations_are_serialized_and_file_remains_parseable(tmp_path: Path) -> None:
    path = tmp_path / "calendar.ics"

    async def scenario() -> None:
        store = RoutineStore(path)
        await store.async_create_item(_item())

        async def mark(index: int) -> None:
            if index % 2:
                await store.async_set_status("routine-1", "completed", datetime(2026, 8, 11, 8, index, tzinfo=timezone.utc))
            else:
                await store.async_set_status("routine-1", "pending", None)

        await asyncio.gather(*(mark(index) for index in range(1, 21)))
        parsed = parse_calendar(path.read_text(encoding="utf-8"))
        assert len(parsed.items) == 1
        assert parsed.items[0].revision == 20

    asyncio.run(scenario())


def test_invalid_mutations_and_unknown_uids_fail_without_writing(tmp_path: Path) -> None:
    path = tmp_path / "calendar.ics"

    async def scenario() -> None:
        store = RoutineStore(path)
        await store.async_load()
        with pytest.raises(StoreValidationError):
            await store.async_create_item(_item(""))
        with pytest.raises(StoreItemNotFound):
            await store.async_set_status("missing", "skipped", None)
        assert not store.items

    asyncio.run(scenario())
