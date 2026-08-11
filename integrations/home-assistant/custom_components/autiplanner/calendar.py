"""Home Assistant calendar projection for AutiPlanner routines."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback

from .const import CONF_NAME, DOMAIN
from .model import RoutineItem
from .storage import RoutineStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities,
) -> None:
    """Set up the AutiPlanner calendar entity."""
    store: RoutineStore = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([AutiPlannerCalendarEntity(store, entry)])


class AutiPlannerCalendarEntity(CalendarEntity):
    """Expose routine schedule data to standard calendar consumers."""

    _attr_should_poll = False

    def __init__(self, store: RoutineStore, entry: ConfigEntry) -> None:
        self._store = store
        self._remove_listener = None
        self._attr_name = f"{entry.data.get(CONF_NAME, 'AutiPlanner')} Agenda"
        self._attr_unique_id = f"{entry.entry_id}_calendar"
        self._event: CalendarEvent | None = None

    @property
    def event(self) -> CalendarEvent | None:
        """Return the cached current/next event without I/O."""
        return self._event

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

    async def async_update(self) -> None:
        """Refresh the cached next event from memory."""
        now = datetime.now(timezone.utc)
        events = self._events_between(now, now + timedelta(days=366))
        self._event = next((event for event in events if _event_end(event) > now), None)

    async def async_get_events(
        self,
        hass: HomeAssistant,
        start_date: datetime,
        end_date: datetime,
    ) -> list[CalendarEvent]:
        """Return ordered events in the requested Home Assistant window."""
        return self._events_between(start_date, end_date)

    def _events_between(self, start_date: datetime, end_date: datetime) -> list[CalendarEvent]:
        events: list[CalendarEvent] = []
        for item in self._store.items:
            event = self._to_event(item)
            if _event_intersects(event, start_date, end_date):
                events.append(event)
        return sorted(events, key=_event_sort_key)

    def _to_event(self, item: RoutineItem) -> CalendarEvent:
        zone = self._zone(item.timezone)
        if item.start is None and item.due is None and item.end is None:
            start_day = date.fromisoformat(item.date)
            return CalendarEvent(
                start=start_day,
                end=start_day + timedelta(days=1),
                summary=item.title,
                description=item.description,
                uid=item.uid,
            )

        start = _aware(item.start or item.due, zone)
        if start is None:
            start = datetime.combine(date.fromisoformat(item.date), datetime.min.time(), tzinfo=zone)
        end = _aware(item.end, zone) or _aware(item.due, zone)
        if end is None or end <= start:
            end = start + timedelta(hours=1)
        return CalendarEvent(
            start=start,
            end=end,
            summary=item.title,
            description=item.description,
            uid=item.uid,
        )

    def _zone(self, timezone_name: str | None):
        try:
            return ZoneInfo(timezone_name or self.hass.config.time_zone)
        except ZoneInfoNotFoundError:
            return timezone.utc


def _aware(value: datetime | date | None, zone) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return datetime.combine(value, datetime.min.time(), tzinfo=zone)
    return value if value.tzinfo is not None else value.replace(tzinfo=zone)


def _event_intersects(event: CalendarEvent, start: datetime, end: datetime) -> bool:
    event_start = _event_datetime(event.start, start.tzinfo)
    event_end = _event_datetime(event.end, start.tzinfo)
    return event_end > start and event_start < end


def _event_datetime(value: date | datetime, zone) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.combine(value, datetime.min.time(), tzinfo=zone)


def _event_end(event: CalendarEvent) -> datetime:
    if isinstance(event.end, datetime):
        return event.end
    return datetime.combine(event.end, datetime.min.time(), tzinfo=timezone.utc)


def _event_sort_key(event: CalendarEvent):
    if isinstance(event.start, datetime):
        return event.start
    return datetime.combine(event.start, datetime.min.time(), tzinfo=timezone.utc)
