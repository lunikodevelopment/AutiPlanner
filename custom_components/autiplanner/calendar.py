"""Calendar entity for AutiPlanner routine items.

The entity is read-only. Routine outcomes are not VEVENT semantics, so the
calendar platform never accepts create/update/delete. Mutations go through the
AutiPlanner services, which preserve the four-state outcome.
"""

from __future__ import annotations

import datetime as dt
import logging
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from homeassistant.components.calendar import CalendarEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import data_for
from .const import (
    ATTR_ISSUES,
    ATTR_REVISION_STAMP,
    CONF_CALENDAR_NAME,
    DOMAIN,
)
from .model import RoutineItem

_LOGGER = logging.getLogger(__name__)

_DEFAULT_DURATION = dt.timedelta(minutes=30)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    name = config_entry.data.get(CONF_CALENDAR_NAME) or "Routine"
    async_add_entities([AutiPlannerCalendar(hass, config_entry, name)])


class AutiPlannerCalendar(CalendarEntity):
    """Exposes routine items as calendar events with the full outcome."""

    _attr_has_entity_name = False
    _attr_icon = "mdi:calendar-check"

    def __init__(self, hass: HomeAssistant, config_entry: ConfigEntry, name: str) -> None:
        self.hass = hass
        self._entry = config_entry
        self._attr_name = name
        self._attr_unique_id = f"{config_entry.entry_id}-routine"
        self._store = data_for(hass, config_entry.entry_id)
        self._tz = _zone(hass)
        self._event: dict | None = None
        self._range_start: dt.datetime | None = None
        self._range_end: dt.datetime | None = None
        self.unsub = async_dispatcher_connect(
            hass, f"{DOMAIN}_{config_entry.entry_id}_updated", self._handle_update
        )

    @property
    def event(self):
        return self._event

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        store = self._store
        return {
            ATTR_REVISION_STAMP: store.revision,
            ATTR_ISSUES: "; ".join(f"{code}: {message}" for code, message in store.issues),
        }

    async def async_get_events(
        self, hass: HomeAssistant, start_date: dt.datetime, end_date: dt.datetime
    ) -> list:
        self._range_start = start_date
        self._range_end = end_date
        self._event = self._next_event(start_date, end_date)
        window_start = start_date.astimezone(self._tz).date().isoformat()
        window_end = end_date.astimezone(self._tz).date().isoformat()
        if window_end <= window_start:
            window_end = _plus_day(window_start)
        return [_to_event(item, self._tz) for item in self._store.items_for_range(window_start, window_end)]

    async def async_update(self) -> None:
        if self._range_start is None or self._range_end is None:
            return
        self._event = self._next_event(self._range_start, self._range_end)
        self.async_write_ha_state()

    def _handle_update(self) -> None:
        """A client changed state. Keep the calendar current for subscribers."""
        self.hass.async_create_task(self.async_update())
        self.async_update_event_listeners()

    def _next_event(self, start: dt.datetime, end: dt.datetime) -> dict | None:
        now = dt.datetime.now(tz=self._tz)
        boundary = max(now, start)
        for item in self._store.items_for_range(
            boundary.astimezone(self._tz).date().isoformat(),
            end.astimezone(self._tz).date().isoformat(),
        ):
            if item.status in ("missed", "skipped"):
                continue
            event = _to_event(item, self._tz)
            if event["start"] < end:
                return event
        return None


def _to_event(item: RoutineItem, tz: ZoneInfo) -> dict:
    """Maps one routine item onto a calendar event.

    The AutiPlanner outcome is carried in the description prefix and the event
    `uid`, so a client that only understands standard calendar events still
    receives a coherent event.
    """
    start = _local(item, tz)
    end = start + _DEFAULT_DURATION
    summary = f"{_symbol(item)} {item.title}"
    parts = [
        f"Outcome: {item.status}",
        f"Day part: {item.day_part}",
    ]
    if item.completed_at:
        parts.append(f"Completed: {item.completed_at}")
    if item.description:
        parts.append(item.description)
    return {
        "start": start.date() if item.start is None else start,
        "end": end.date() if item.start is None else end,
        "summary": summary,
        "description": "\n".join(parts),
        "uid": item.uid,
    }


def _symbol(item: RoutineItem) -> str:
    return {
        "pending": "○",
        "completed": "✓",
        "missed": "✕",
        "skipped": "—",
    }.get(item.status, "○")


def _local(item: RoutineItem, tz: ZoneInfo) -> dt.datetime:
    """Resolves the event start without guessing a timezone.

    An all-day item uses the stored local date. A zoned item uses its TZID.
    A UTC or floating timestamp is used as written; a floating timestamp is
    attached to the Home Assistant timezone because it is a local clock.
    """
    if item.start is None:
        return dt.datetime.combine(dt.date.fromisoformat(item.date), dt.time(0, 0), tzinfo=tz)
    day = dt.date.fromisoformat(item.date)
    if item.start.endswith("Z"):
        stamp = dt.datetime.fromisoformat(item.start.replace("Z", "+00:00"))
        return stamp.astimezone(tz)
    clock = dt.time.fromisoformat(item.start.split("T", 1)[1])
    zone = tz
    if item.timezone:
        zone = _zone_from_name(item.timezone) or tz
    return dt.datetime.combine(day, clock, tzinfo=zone)


def _zone(hass: HomeAssistant) -> ZoneInfo:
    try:
        return ZoneInfo(str(hass.config.time_zone))
    except (ZoneInfoNotFoundError, ValueError):  # pragma: no cover - unusual config
        return ZoneInfo("UTC")


def _zone_from_name(name: str) -> ZoneInfo | None:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def _plus_day(date: str) -> str:
    return (dt.date.fromisoformat(date) + dt.timedelta(days=1)).isoformat()
