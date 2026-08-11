"""AutiPlanner Home Assistant integration."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .const import (
    ATTR_COMPLETED_AT,
    ATTR_UID,
    CONF_DEFAULT_DAY_PART,
    CONF_PATH,
    DOMAIN,
    EVENT_ITEM_UPDATED,
    PLATFORMS,
    SERVICE_COMPLETE,
    SERVICE_MARK_MISSED,
    SERVICE_RESET,
    SERVICE_SKIP,
)
from .model import RoutineStatus
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
        for service in SERVICE_STATUS:
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
        hass.bus.async_fire(
            EVENT_ITEM_UPDATED,
            {
                ATTR_UID: result.item.uid,
                "outcome": result.item.status,
                "day_part": result.item.day_part,
                "revision": result.item.revision,
            },
        )
