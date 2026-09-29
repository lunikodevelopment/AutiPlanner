"""The AutiPlanner custom integration.

Home Assistant is the single writer for the configured ICS file. Android and
dashboard clients send commands through services; they never write the file.
"""

from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import (
    ATTR_DAY_PART,
    ATTR_EXPECTED_REVISION,
    ATTR_UID,
    CONF_FILE_PATH,
    DOMAIN,
    PLATFORMS,
    SERVICE_ADD_SERIES,
    SERVICE_COMPLETE,
    SERVICE_CREATE,
    SERVICE_DELETE,
    SERVICE_MARK_MISSED,
    SERVICE_PAIR,
    SERVICE_RESET,
    SERVICE_SKIP,
    SERVICE_UPDATE,
)
from .commands import apply_command
from .model import DAY_PARTS
from .pairing import PairingRegistry
from .store import RoutineError, RoutineStore

_LOGGER = logging.getLogger(__name__)

_ITEM_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_UID): cv.string,
        vol.Required("title"): cv.string,
        vol.Required("date"): cv.string,
        vol.Required(ATTR_DAY_PART): vol.In(DAY_PARTS),
        vol.Required("status"): vol.In(["pending", "completed", "missed", "skipped"]),
        vol.Optional("description"): cv.string,
        vol.Optional("start"): cv.string,
        vol.Optional("due"): cv.string,
        vol.Optional("timezone"): cv.string,
        vol.Optional("order"): cv.positive_int,
    },
    extra=vol.ALLOW_EXTRA,
)

SERIES_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_UID): cv.string,
        vol.Required("title"): cv.string,
        vol.Required("date"): cv.string,
        vol.Required(ATTR_DAY_PART): vol.In(DAY_PARTS),
        vol.Required("recurrence"): vol.Schema(
            {
                vol.Required("freq"): vol.In(["daily", "weekly", "monthly"]),
                vol.Optional("interval"): vol.All(cv.positive_int, lambda value: value),
                vol.Optional("count"): cv.positive_int,
                vol.Optional("until"): cv.string,
                vol.Optional("by_day"): vol.All(
                    cv.ensure_list, [vol.In(["MO", "TU", "WE", "TH", "FR", "SA", "SU"])]
                ),
            }
        ),
        vol.Optional("description"): cv.string,
        vol.Optional("start"): cv.string,
        vol.Optional("due"): cv.string,
        vol.Optional("order"): cv.positive_int,
    }
)

OUTCOME_SERVICES = {
    SERVICE_COMPLETE: "complete",
    SERVICE_MARK_MISSED: "mark_missed",
    SERVICE_SKIP: "skip",
    SERVICE_RESET: "reset",
}

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Registers services once for the whole integration."""
    hass.data.setdefault(DOMAIN, {})

    async def _complete(call: ServiceCall) -> None:
        await _run(hass, call, "complete")

    async def _mark_missed(call: ServiceCall) -> None:
        await _run(hass, call, "mark_missed")

    async def _skip(call: ServiceCall) -> None:
        await _run(hass, call, "skip")

    async def _reset(call: ServiceCall) -> None:
        await _run(hass, call, "reset")

    async def _create(call: ServiceCall) -> None:
        await _run(hass, call, "create")

    async def _update(call: ServiceCall) -> None:
        await _run(hass, call, "update")

    async def _delete(call: ServiceCall) -> None:
        await _run(hass, call, "delete")

    async def _add_series(call: ServiceCall) -> None:
        await _run(hass, call, "add_series")

    async def _pair(call: ServiceCall) -> dict:
        """Issues a one-time code the app exchanges for a token."""
        return await _issue_pairing_code(hass, call)

    handlers = {
        SERVICE_COMPLETE: _complete,
        SERVICE_MARK_MISSED: _mark_missed,
        SERVICE_SKIP: _skip,
        SERVICE_RESET: _reset,
        SERVICE_CREATE: _create,
        SERVICE_UPDATE: _update,
        SERVICE_DELETE: _delete,
        SERVICE_ADD_SERIES: _add_series,
        SERVICE_PAIR: _pair,
    }
    response_only = (SERVICE_PAIR,)
    for name, handler in handlers.items():
        if hass.services.has_service(DOMAIN, name):
            continue
        kwargs: dict = {"schema": _service_schema(name)}
        if name in response_only:
            # The caller needs the code back, so the service must return data.
            kwargs["supports_response"] = SupportsResponse.ONLY
        hass.services.async_register(DOMAIN, name, handler, **kwargs)
    from .websocket_api import async_register as register_websocket

    register_websocket(hass)
    if "http" in hass.config.components:
        from .http import async_register as register_http
        from .pair_http import async_register as register_pairing

        register_http(hass)
        register_pairing(hass)
    return True


async def _issue_pairing_code(hass: HomeAssistant, call: ServiceCall) -> dict:
    """Creates a one-time code for the app to redeem for a token."""
    targets = _targets(hass, call.data.get("entity_id"))
    if not targets:
        raise HomeAssistantError("AutiPlanner: no configured AutiPlanner calendar was found")
    entry_id = targets[0]
    registry = pairings(hass, entry_id)

    device_name = call.data.get("device_name")
    record = registry.issue(user_id=call.context.user_id)

    base_url = hass.config.external_url or hass.config.internal_url
    return {
        "code": record.code,
        "expires_in": registry.ttl_seconds,
        "device_name": device_name or "AutiPlanner app",
        "base_url": base_url,
        "pair_url": f"{base_url}/api/autiplanner/pair" if base_url else "/api/autiplanner/pair",
    }


def _service_schema(name: str) -> vol.Schema:
    if name in OUTCOME_SERVICES:
        return vol.Schema(
            {
                vol.Optional("entity_id"): cv.entity_ids,
                vol.Required(ATTR_UID): cv.string,
                vol.Optional("completed_at"): cv.string,
                vol.Optional(ATTR_EXPECTED_REVISION): vol.Coerce(int),
            }
        )
    if name == SERVICE_CREATE:
        return _ITEM_SCHEMA.extend({vol.Optional("entity_id"): cv.entity_ids})
    if name == SERVICE_ADD_SERIES:
        return SERIES_SCHEMA.extend({vol.Optional("entity_id"): cv.entity_ids})
    if name == SERVICE_UPDATE:
        return vol.Schema(
            {
                vol.Optional("entity_id"): cv.entity_ids,
                vol.Required(ATTR_UID): cv.string,
                vol.Optional(ATTR_EXPECTED_REVISION): vol.Coerce(int),
            },
            extra=vol.ALLOW_EXTRA,
        )
    if name == SERVICE_PAIR:
        return vol.Schema(
            {
                vol.Optional("entity_id"): cv.entity_ids,
                vol.Optional("device_name"): cv.string,
            }
        )
    return vol.Schema(
        {
            vol.Optional("entity_id"): cv.entity_ids,
            vol.Required(ATTR_UID): cv.string,
            vol.Optional(ATTR_EXPECTED_REVISION): vol.Coerce(int),
        }
    )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = RoutineStore(entry.data[CONF_FILE_PATH])
    try:
        await hass.async_add_executor_job(store.load)
    except OSError as error:  # pragma: no cover - filesystem failure
        _LOGGER.error("AutiPlanner could not read its calendar: %s", error)
        return False

    for code, message in store.issues:
        _LOGGER.warning("AutiPlanner calendar issue [%s]: %s", code, message)

    hass.data[DOMAIN][entry.entry_id] = {
        "store": store,
        "entry": entry,
        "pairing": PairingRegistry(),
    }
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    async_dispatcher_send(hass, f"{DOMAIN}_{entry.entry_id}_loaded")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unloaded


async def async_remove_config_entry_device(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Never deletes the calendar file. The household owns that data."""
    return None


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


def data_for(hass: HomeAssistant, entry_id: str) -> RoutineStore:
    return hass.data[DOMAIN][entry_id]["store"]


def entry_ids(hass: HomeAssistant) -> list[str]:
    return list(hass.data.get(DOMAIN, {}))


def pairings(hass: HomeAssistant, entry_id: str) -> PairingRegistry:
    """The pairing registry for one config entry."""
    return hass.data[DOMAIN][entry_id]["pairing"]


def notify(hass: HomeAssistant, entry_id: str) -> None:
    """Pushes a change to every live client."""
    async_dispatcher_send(hass, f"{DOMAIN}_{entry_id}_updated")


async def _run(hass: HomeAssistant, call: ServiceCall, command: str) -> None:
    """Applies one command to every entry targeted by the call.

    Errors are raised as `HomeAssistantError` so the client sees a real
    failure instead of a silent no-op.
    """
    from homeassistant.exceptions import HomeAssistantError

    payload = dict(call.data)
    targets = _targets(hass, payload.pop("entity_id", None))
    if not targets:
        raise HomeAssistantError("AutiPlanner: no configured AutiPlanner calendar was found")

    uid = payload.get(ATTR_UID)
    expected = payload.get(ATTR_EXPECTED_REVISION)
    for entry_id in targets:
        store = data_for(hass, entry_id)
        try:
            item = await apply_command(store, command, payload, uid, expected)
        except RoutineError as error:
            raise HomeAssistantError(f"AutiPlanner {command} failed: {error}") from error
        if command in ("complete", "mark_missed", "skip", "reset") and item is not None:
            # The confirmed result is what clients render; a boolean is not enough.
            _LOGGER.debug("AutiPlanner %s %s -> %s", command, item.uid, item.status)
        notify(hass, entry_id)


def _targets(hass: HomeAssistant, entity_ids: list[str] | None) -> list[str]:
    if not entity_ids:
        return entry_ids(hass)
    from homeassistant.helpers import entity_registry as er

    registry = er.async_get(hass)
    resolved: list[str] = []
    for entity_id in entity_ids:
        entry = registry.async_get(entity_id)
        # `platform` is the integration; `domain` would be `sensor` or `calendar`.
        if entry is None or entry.platform != DOMAIN:
            continue
        if entry.config_entry_id in hass.data.get(DOMAIN, {}):
            resolved.append(entry.config_entry_id)
    return resolved
