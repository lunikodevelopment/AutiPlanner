"""Home Assistant to-do entity for AutiPlanner routines."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import CONF_NAME, DOMAIN
from .model import RoutineItem
from .storage import RoutineStore, StoreDuplicateUid, StoreItemNotFound, StoreValidationError


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities,
) -> None:
    """Set up the AutiPlanner to-do entity."""
    store: RoutineStore = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([AutiPlannerTodoEntity(store, entry)])


class AutiPlannerTodoEntity(TodoListEntity):
    """Expose standard to-do semantics while retaining richer item attributes."""

    _attr_should_poll = False

    def __init__(self, store: RoutineStore, entry: ConfigEntry) -> None:
        self._store = store
        self._remove_listener = None
        self._attr_name = entry.data.get(CONF_NAME, "AutiPlanner")
        self._attr_unique_id = f"{entry.entry_id}_todo"

    @property
    def supported_features(self) -> TodoListEntityFeature:
        return (
            TodoListEntityFeature.CREATE_TODO_ITEM
            | TodoListEntityFeature.DELETE_TODO_ITEM
            | TodoListEntityFeature.UPDATE_TODO_ITEM
            | TodoListEntityFeature.MOVE_TODO_ITEM
            | TodoListEntityFeature.SET_DUE_DATE_ON_ITEM
            | TodoListEntityFeature.SET_DUE_DATETIME_ON_ITEM
            | TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM
        )

    @property
    def todo_items(self) -> list[TodoItem]:
        """Return the standard two-state projection from memory only."""
        return [self._to_todo_item(item) for item in self._store.items]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose day parts and four-state outcomes without changing HA's core model."""
        return {
            "autiplanner_items": [
                {
                    "uid": item.uid,
                    "title": item.title,
                    "description": item.description,
                    "date": item.date,
                    "start": item.start,
                    "end": item.end,
                    "due": item.due,
                    "timezone": item.timezone,
                    "day_part": item.day_part,
                    "outcome": item.status,
                    "completed_at": item.completed_at,
                    "order": item.order,
                    "revision": item.revision,
                    "routine_id": item.routine_id,
                    "tags": list(item.tags),
                    "extensions": dict(item.extensions),
                    "rrule": item.rrule,
                    "rdate": list(item.rdate),
                    "exdate": list(item.exdate),
                    "recurrence_id": item.recurrence_id,
                }
                for item in self._store.items
            ],
            "parse_warnings": [warning.message for warning in self._store.snapshot.warnings],
        }

    async def async_added_to_hass(self) -> None:
        """Subscribe to in-process store changes."""
        await super().async_added_to_hass()
        self._remove_listener = self._store.add_listener(self._handle_store_update)

    async def async_will_remove_from_hass(self) -> None:
        if self._remove_listener is not None:
            self._remove_listener()
            self._remove_listener = None
        await super().async_will_remove_from_hass()

    @callback
    def _handle_store_update(self, _snapshot) -> None:
        self.async_schedule_update_ha_state()

    async def async_create_todo_item(self, item: TodoItem) -> None:
        """Create a pending routine through standard HA to-do APIs."""
        uid = item.uid or f"autiplanner-{uuid4()}"
        title = item.summary or ""
        if not title.strip():
            raise HomeAssistantError("A routine title is required")
        due = self._normalize_due(item.due)
        date_value = _date_for_due(due)
        status = "completed" if item.status == TodoItemStatus.COMPLETED else "pending"
        completed_at = item.completed if status == "completed" else None
        routine = RoutineItem(
            uid=uid,
            title=title,
            date=date_value,
            day_part=self._store.default_day_part,
            status=status,
            description=item.description,
            due=due,
            timezone=self._timezone_name(due),
            completed_at=completed_at,
        )
        try:
            await self._store.async_create_item(routine)
        except (StoreDuplicateUid, StoreValidationError) as err:
            raise HomeAssistantError(str(err)) from err

    async def async_update_todo_item(self, item: TodoItem) -> None:
        """Update a standard to-do projection while preserving AutiPlanner metadata."""
        if not item.uid:
            raise HomeAssistantError("A UID is required to update a routine")
        try:
            current = next(existing for existing in self._store.items if existing.uid == item.uid)
        except StopIteration as err:
            raise HomeAssistantError(f"Routine UID not found: {item.uid}") from err

        due = self._normalize_due(item.due)
        status = current.status
        completed_at = current.completed_at
        if item.status == TodoItemStatus.COMPLETED:
            status = "completed"
            completed_at = item.completed or current.completed_at or datetime.now(timezone.utc)
        elif item.status == TodoItemStatus.NEEDS_ACTION:
            status = "pending"
            completed_at = None
        updated = current.with_changes(
            title=item.summary or current.title,
            description=item.description,
            due=due,
            timezone=self._timezone_name(due) or current.timezone,
            date=_date_for_due(due) if due is not None else current.date,
            status=status,
            completed_at=completed_at,
        )
        try:
            await self._store.async_update_item(updated)
        except (StoreItemNotFound, StoreValidationError) as err:
            raise HomeAssistantError(str(err)) from err

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        """Delete one or more routines."""
        try:
            await self._store.async_delete_items(uids)
        except StoreItemNotFound as err:
            raise HomeAssistantError(str(err)) from err

    async def async_move_todo_item(self, uid: str, previous_uid: str | None = None) -> None:
        """Persist the display order requested by Home Assistant."""
        try:
            await self._store.async_move_item(uid, previous_uid)
        except (StoreItemNotFound, StoreValidationError) as err:
            raise HomeAssistantError(str(err)) from err

    def _to_todo_item(self, item: RoutineItem) -> TodoItem:
        status = TodoItemStatus.COMPLETED if item.status == "completed" else TodoItemStatus.NEEDS_ACTION
        return TodoItem(
            uid=item.uid,
            summary=item.title,
            status=status,
            due=self._ha_due(item),
            description=item.description,
            completed=item.completed_at,
        )

    def _ha_due(self, item: RoutineItem) -> date | datetime:
        due = item.due or item.start
        if due is None:
            return date.fromisoformat(item.date)
        if isinstance(due, datetime) and due.tzinfo is None:
            return due.replace(tzinfo=self._local_zone())
        return due

    def _normalize_due(self, value: date | datetime | None) -> date | datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime) and value.tzinfo is None:
            return value.replace(tzinfo=self._local_zone())
        return value

    def _timezone_name(self, value: date | datetime | None) -> str | None:
        if not isinstance(value, datetime) or value.tzinfo is None:
            return None
        return getattr(value.tzinfo, "key", None) or str(value.tzinfo)

    def _local_zone(self):
        try:
            return ZoneInfo(self.hass.config.time_zone)
        except ZoneInfoNotFoundError:
            return timezone.utc


def _date_for_due(value: date | datetime | None) -> str:
    if value is None:
        return date.today().isoformat()
    return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
