"""Sensors that expose the day-part agenda in normalized form.

Android and the Navet widget need the four-state outcome, day part, and local
date. A generic to-do entity can only express pending vs completed, so the
agenda sensors are the primary read surface for AutiPlanner clients.

Entity names include the calendar name, so the entity ids are predictable:
a calendar named ``Routine`` produces ``sensor.routine_agenda``.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from . import data_for
from .const import ATTR_ISSUES, ATTR_REVISION_STAMP, CONF_CALENDAR_NAME, DOMAIN

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = dt.timedelta(seconds=30)
DEFAULT_WINDOW_DAYS = 14


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    name = config_entry.data.get(CONF_CALENDAR_NAME) or "Routine"
    coordinator = AutiPlannerCoordinator(hass, config_entry)
    await coordinator.async_config_entry_first_refresh()
    entities: list[SensorEntity] = [
        AutiPlannerAgendaSensor(coordinator, name, "today"),
        AutiPlannerAgendaSensor(coordinator, name, "agenda"),
        AutiPlannerIssueSensor(coordinator, name),
    ]
    async_add_entities(entities)


class AutiPlannerCoordinator(DataUpdateCoordinator):
    """Keeps a normalized agenda window in memory for every client."""

    def __init__(self, hass: HomeAssistant, config_entry: ConfigEntry) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{config_entry.entry_id}",
            config_entry=config_entry,
        )
        self.entry_id = config_entry.entry_id
        self._store = data_for(hass, config_entry.entry_id)
        self._tz = _zone(hass)
        self.window_start: str = ""
        self.window_end: str = ""
        self.issues: list[str] = []
        self.revision: int | None = None
        self.unsub = async_dispatcher_connect(
            hass, f"{DOMAIN}_{config_entry.entry_id}_updated", self._handle_update
        )

    async def _async_update_data(self) -> list[dict]:
        today = dt.datetime.now(tz=self._tz).date()
        start = today - dt.timedelta(days=DEFAULT_WINDOW_DAYS)
        end = today + dt.timedelta(days=DEFAULT_WINDOW_DAYS)
        self.window_start = start.isoformat()
        self.window_end = end.isoformat()
        self.issues = [f"{code}: {message}" for code, message in self._store.issues]
        self.revision = self._store.revision
        return [
            _normalized(item)
            for item in self._store.items_for_range(self.window_start, self.window_end)
        ]

    @callback
    def _handle_update(self) -> None:
        """Refresh after another client changed the calendar.

        `@callback` keeps this on the event loop, and the task is created
        through the config entry rather than `hass.async_create_task`.
        """
        self.config_entry.async_create_task(self.hass, self.async_refresh())

    def for_today(self) -> list[dict]:
        today = dt.datetime.now(tz=self._tz).date().isoformat()
        return [item for item in (self.data or []) if item["date"] == today]


class AutiPlannerAgendaSensor(SensorEntity):
    """A JSON agenda that keeps the four outcomes distinct.

    The state is the number of items, which stays short. The full list is in the
    `items` attribute.
    """

    _attr_has_entity_name = False
    _attr_should_poll = False

    def __init__(
        self,
        coordinator: AutiPlannerCoordinator,
        calendar_name: str,
        kind: str,
    ) -> None:
        self.coordinator = coordinator
        self._kind = kind
        self._attr_name = f"{calendar_name} {'Today' if kind == 'today' else 'Agenda'}"
        self._attr_unique_id = f"{coordinator.entry_id}-{kind}"
        self._attr_icon = "mdi:calendar-today" if kind == "today" else "mdi:format-list-checks"

    def _rows(self) -> list[dict]:
        if self._kind == "today":
            return self.coordinator.for_today()
        return list(self.coordinator.data or [])

    @property
    def native_value(self) -> int:
        return len(self._rows())

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        return {
            "items": self._rows(),
            "window_start": self.coordinator.window_start,
            "window_end": self.coordinator.window_end,
            ATTR_REVISION_STAMP: self.coordinator.revision,
            ATTR_ISSUES: self.coordinator.issues,
        }

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self.coordinator.async_add_listener(self._write))
        await self.coordinator.async_request_refresh()

    def _write(self) -> None:
        self.async_write_ha_state()


class AutiPlannerIssueSensor(SensorEntity):
    """Surfaces import problems so a broken file is visible, not silent."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_icon = "mdi:alert-circle-outline"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: AutiPlannerCoordinator, calendar_name: str) -> None:
        self.coordinator = coordinator
        self._attr_name = f"{calendar_name} Calendar issues"
        self._attr_unique_id = f"{coordinator.entry_id}-issues"

    @property
    def native_value(self) -> int:
        return len(self.coordinator.issues)

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        return {
            "issues": self.coordinator.issues,
            ATTR_REVISION_STAMP: self.coordinator.revision,
        }

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self.coordinator.async_add_listener(self._write))
        await self.coordinator.async_request_refresh()

    def _write(self) -> None:
        self.async_write_ha_state()


def _zone(hass: HomeAssistant) -> ZoneInfo:
    try:
        return ZoneInfo(str(hass.config.time_zone))
    except (ZoneInfoNotFoundError, ValueError):  # pragma: no cover - unusual config
        return ZoneInfo("UTC")


def _normalized(item: Any) -> dict:
    """Client-facing shape: camelCase day part and completion keys.

    Absent values are omitted rather than sent as null, matching
    ``api.item_payload`` so the sensor attribute and the HTTP API never
    disagree. A missed or skipped item therefore carries no ``completedAt`` at
    all, which is the point of keeping the four outcomes separate.
    """
    payload: dict = {
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
