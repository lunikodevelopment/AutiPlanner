"""AutiPlanner Home Assistant integration."""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .const import (
    ATTR_COMPLETED_AT,
    ATTR_DATE,
    ATTR_DAY_PART,
    ATTR_DESCRIPTION,
    ATTR_END,
    ATTR_ENTITY_ID,
    ATTR_ICON,
    ATTR_PRIORITY,
    ATTR_START,
    ATTR_DUE,
    ATTR_TITLE,
    ATTR_UID,
    CONF_DEFAULT_DAY_PART,
    CONF_PATH,
    DOMAIN,
    EVENT_ITEM_UPDATED,
    PLATFORMS,
    SERVICE_ADD_ROUTINE,
    SERVICE_COMPLETE,
    SERVICE_MARK_MISSED,
    SERVICE_RESET,
    SERVICE_SKIP,
    SERVICE_UPDATE_ROUTINE,
)
from .model import DAY_PARTS, ROUTINE_PRIORITIES, RoutineItem, RoutineStatus
from .storage import RoutineStore, StoreItemNotFound, StoreValidationError

SERVICE_STATUS: dict[str, RoutineStatus] = {
    SERVICE_COMPLETE: "completed",
    SERVICE_MARK_MISSED: "missed",
    SERVICE_SKIP: "skipped",
    SERVICE_RESET: "pending",
}

async def async_setup_entry(hass: Any, entry: Any) -> bool:
    """Set up AutiPlanner from a config entry."""
    from homeassistant.exceptions import HomeAssistantError

    path = Path(entry.data[CONF_PATH]).expanduser()
    default_day_part = entry.options.get(
        CONF_DEFAULT_DAY_PART,
        entry.data.get(CONF_DEFAULT_DAY_PART, "morning"),
    )
    store = RoutineStore(path, default_day_part=default_day_part)
    try:
        await store.async_load()
    except OSError as err:
        raise HomeAssistantError(f"Unable to open AutiPlanner calendar: {path}") from err

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = store
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _async_register_services(hass)
    return True


async def async_unload_entry(hass: Any, entry: Any) -> bool:
    """Unload an AutiPlanner config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if not unloaded:
        return False

    hass.data[DOMAIN].pop(entry.entry_id, None)
    if not hass.data[DOMAIN]:
        for service in (*SERVICE_STATUS, SERVICE_ADD_ROUTINE, SERVICE_UPDATE_ROUTINE):
            hass.services.async_remove(DOMAIN, service)
        hass.data.pop(DOMAIN, None)
    return True


def _async_register_services(hass: Any) -> None:
    import voluptuous as vol
    from homeassistant.helpers import config_validation as cv

    service_schema = vol.Schema(
        {
            vol.Required(ATTR_UID): cv.string,
            vol.Optional(ATTR_COMPLETED_AT): cv.datetime,
            vol.Optional(ATTR_ENTITY_ID): cv.entity_ids,
        }
    )
    for service in SERVICE_STATUS:
        if hass.services.has_service(DOMAIN, service):
            continue
        hass.services.async_register(
            DOMAIN,
            service,
            _async_handle_status_service,
            schema=service_schema,
        )

    add_schema = vol.Schema(
        {
            vol.Required(ATTR_TITLE): cv.string,
            vol.Required(ATTR_DATE): cv.string,
            vol.Optional(ATTR_DAY_PART): vol.In(DAY_PARTS),
            vol.Optional(ATTR_DESCRIPTION): cv.string,
            vol.Optional(ATTR_ICON): cv.string,
            vol.Optional(ATTR_PRIORITY): vol.In(ROUTINE_PRIORITIES),
            vol.Optional(ATTR_START): cv.datetime,
            vol.Optional(ATTR_END): cv.datetime,
            vol.Optional(ATTR_DUE): cv.datetime,
            vol.Optional(ATTR_ENTITY_ID): cv.entity_ids,
        }
    )
    update_schema = vol.Schema(
        {
            vol.Required(ATTR_UID): cv.string,
            vol.Optional(ATTR_TITLE): cv.string,
            vol.Optional(ATTR_DATE): cv.string,
            vol.Optional(ATTR_DAY_PART): vol.In(DAY_PARTS),
            vol.Optional(ATTR_DESCRIPTION): cv.string,
            vol.Optional(ATTR_ICON): cv.string,
            vol.Optional(ATTR_PRIORITY): vol.In(ROUTINE_PRIORITIES),
            vol.Optional(ATTR_START): cv.datetime,
            vol.Optional(ATTR_END): cv.datetime,
            vol.Optional(ATTR_DUE): cv.datetime,
            vol.Optional(ATTR_ENTITY_ID): cv.entity_ids,
        }
    )
    if not hass.services.has_service(DOMAIN, SERVICE_ADD_ROUTINE):
        hass.services.async_register(DOMAIN, SERVICE_ADD_ROUTINE, _async_handle_add_routine, schema=add_schema)
    if not hass.services.has_service(DOMAIN, SERVICE_UPDATE_ROUTINE):
        hass.services.async_register(DOMAIN, SERVICE_UPDATE_ROUTINE, _async_handle_update_routine, schema=update_schema)


async def _async_handle_status_service(call: Any) -> None:
    """Apply an AutiPlanner-specific outcome mutation."""
    from homeassistant.exceptions import HomeAssistantError

    hass = call.hass
    stores: dict[str, RoutineStore] = hass.data.get(DOMAIN, {})
    if len(stores) != 1:
        raise HomeAssistantError("AutiPlanner requires exactly one configured calendar")

    service = call.service
    status = SERVICE_STATUS[service]
    store = next(iter(stores.values()))
    completed_at = call.data.get(ATTR_COMPLETED_AT)
    if status == "completed":
        completed_at = completed_at or datetime.now(timezone.utc)
    else:
        completed_at = None

    try:
        result = await store.async_set_status(call.data[ATTR_UID], status, completed_at)
    except (StoreItemNotFound, StoreValidationError) as err:
        raise HomeAssistantError(str(err)) from err

    if result.changed:
        _fire_item_updated(hass, result.item)


async def _async_handle_add_routine(call: Any) -> None:
    """Create a routine with explicit day-part and icon metadata."""
    from homeassistant.exceptions import HomeAssistantError

    store = _single_store(call.hass)
    title = call.data[ATTR_TITLE].strip()
    if not title:
        raise HomeAssistantError("A routine title is required")
    try:
        date_value = date.fromisoformat(call.data[ATTR_DATE].strip()).isoformat()
    except ValueError as err:
        raise HomeAssistantError("date must use YYYY-MM-DD") from err
    routine = RoutineItem(
        uid=f"autiplanner-{uuid4()}",
        title=title,
        date=date_value,
        day_part=call.data.get(ATTR_DAY_PART, store.default_day_part),
        status="pending",
        description=_optional_text(call.data, ATTR_DESCRIPTION),
        icon=_optional_text(call.data, ATTR_ICON),
        priority=call.data.get(ATTR_PRIORITY, "preferably"),
        start=call.data.get(ATTR_START),
        end=call.data.get(ATTR_END),
        due=call.data.get(ATTR_DUE),
        timezone=_timezone_name(call.data.get(ATTR_START) or call.data.get(ATTR_DUE) or call.data.get(ATTR_END)),
    )
    try:
        result = await store.async_create_item(routine)
    except StoreValidationError as err:
        raise HomeAssistantError(str(err)) from err
    _fire_item_updated(call.hass, result.item)


async def _async_handle_update_routine(call: Any) -> None:
    """Update routine metadata without forcing callers through generic to-do fields."""
    from homeassistant.exceptions import HomeAssistantError

    store = _single_store(call.hass)
    try:
        current = next(item for item in store.items if item.uid == call.data[ATTR_UID])
    except StopIteration as err:
        raise HomeAssistantError(f"Routine UID not found: {call.data[ATTR_UID]}") from err

    changes: dict[str, object] = {}
    if ATTR_TITLE in call.data:
        changes["title"] = call.data[ATTR_TITLE].strip()
    if ATTR_DATE in call.data:
        try:
            changes["date"] = date.fromisoformat(call.data[ATTR_DATE].strip()).isoformat()
        except ValueError as err:
            raise HomeAssistantError("date must use YYYY-MM-DD") from err
    for field_name, model_name in ((ATTR_DAY_PART, "day_part"), (ATTR_START, "start"), (ATTR_END, "end"), (ATTR_DUE, "due")):
        if field_name in call.data:
            changes[model_name] = call.data[field_name]
    if ATTR_DESCRIPTION in call.data:
        changes["description"] = _optional_text(call.data, ATTR_DESCRIPTION)
    if ATTR_ICON in call.data:
        changes["icon"] = _optional_text(call.data, ATTR_ICON)
    if ATTR_PRIORITY in call.data:
        changes["priority"] = call.data[ATTR_PRIORITY]
    timestamp = call.data.get(ATTR_START) or call.data.get(ATTR_DUE) or call.data.get(ATTR_END)
    if timestamp is not None:
        changes["timezone"] = _timezone_name(timestamp)
    updated = current.with_changes(**changes)
    try:
        result = await store.async_update_item(updated)
    except (StoreItemNotFound, StoreValidationError) as err:
        raise HomeAssistantError(str(err)) from err
    _fire_item_updated(call.hass, result.item)


def _single_store(hass: Any) -> RoutineStore:
    from homeassistant.exceptions import HomeAssistantError

    stores: dict[str, RoutineStore] = hass.data.get(DOMAIN, {})
    if len(stores) != 1:
        raise HomeAssistantError("AutiPlanner requires exactly one configured calendar")
    return next(iter(stores.values()))


def _optional_text(data: dict[str, Any], key: str) -> str | None:
    if key not in data:
        return None
    value = str(data[key]).strip()
    return value or None


def _timezone_name(value: object) -> str | None:
    if not isinstance(value, datetime) or value.tzinfo is None:
        return None
    return getattr(value.tzinfo, "key", None) or str(value.tzinfo)


def _fire_item_updated(hass: Any, item: RoutineItem) -> None:
    hass.bus.async_fire(
        EVENT_ITEM_UPDATED,
        {
            ATTR_UID: item.uid,
            "outcome": item.status,
            "day_part": item.day_part,
            "revision": item.revision,
            "date": item.date,
            "icon": item.icon,
            "priority": item.priority,
        },
    )
