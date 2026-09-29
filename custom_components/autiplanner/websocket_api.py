"""WebSocket API for AutiPlanner clients.

A service call returns only success or failure. AutiPlanner clients need the
resulting item so they can confirm the four-state outcome, and they need to
subscribe to a date window so an Android edit shows up on the dashboard.
"""

from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from . import data_for, entry_ids
from .const import (
    ATTR_EXPECTED_REVISION,
    ATTR_UID,
    DOMAIN,
    SERVICE_COMPLETE,
    SERVICE_CREATE,
    SERVICE_DELETE,
    SERVICE_MARK_MISSED,
    SERVICE_RESET,
    SERVICE_SKIP,
    SERVICE_UPDATE,
)

TYPE_AGENDA = f"{DOMAIN}/agenda"
TYPE_SUBSCRIBE = f"{DOMAIN}/agenda/subscribe"
TYPE_COMMAND = f"{DOMAIN}/command"
TYPE_SUBSCRIBE_RESULT = f"{DOMAIN}/agenda/subscribed"

_WINDOW = "limit"
_ENTITY = "entity_id"


def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, _agenda_command)
    websocket_api.async_register_command(hass, _subscribe_command)
    websocket_api.async_register_command(hass, _command_command)


def _resolve(hass: HomeAssistant, message: dict) -> str:
    entity_ids = message.get(_ENTITY)
    if not entity_ids:
        available = entry_ids(hass)
        if not available:
            raise websocket_api.UnknownMethod("no AutiPlanner calendar is configured")
        return available[0]
    from homeassistant.helpers import entity_registry as er

    registry = er.async_get(hass)
    for entity_id in entity_ids:
        entry = registry.async_get(entity_id)
        # `platform` is the integration; `domain` would be `sensor` or `calendar`.
        if entry is not None and entry.platform == DOMAIN and entry.config_entry_id in hass.data.get(DOMAIN, {}):
            return entry.config_entry_id
    raise websocket_api.UnknownMethod(f"{entity_ids[0]} is not an AutiPlanner entity")


@callback
def _agenda(hass: HomeAssistant, entry_id: str, limit: int) -> list[dict]:
    import datetime as dt
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        tz = ZoneInfo(str(hass.config.time_zone))
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("UTC")
    today = dt.datetime.now(tz=tz).date()
    start = (today - dt.timedelta(days=limit)).isoformat()
    end = (today + dt.timedelta(days=limit)).isoformat()
    store = data_for(hass, entry_id)
    return [
        {
            "uid": item.uid,
            "title": item.title,
            "date": item.date,
            "dayPart": item.day_part,
            "status": item.status,
            "start": item.start,
            "due": item.due,
            "timezone": item.timezone,
            "completedAt": item.completed_at,
            "order": item.order,
            "routineId": item.routine_id,
            "revision": item.revision,
        }
        for item in store.items_for_range(start, end)
    ]


@websocket_api.websocket_command(
    {
        "type": TYPE_AGENDA,
        vol.Optional(_ENTITY): [str],
        vol.Optional(_WINDOW, default=14): vol.All(int, vol.Range(min=1, max=90)),
    }
)
@websocket_api.async_response
async def _agenda_command(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    entry_id = _resolve(hass, msg)
    store = data_for(hass, entry_id)
    connection.send_result(
        msg["id"],
        {
            "items": _agenda(hass, entry_id, msg[_WINDOW]),
            "revision": store.revision,
            "issues": [f"{code}: {message}" for code, message in store.issues],
        },
    )


@websocket_api.websocket_command(
    {
        "type": TYPE_SUBSCRIBE,
        vol.Optional(_ENTITY): [str],
        vol.Optional(_WINDOW, default=14): vol.All(int, vol.Range(min=1, max=90)),
    }
)
@websocket_api.subscribe_message
@callback
def _subscribe_command(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    entry_id = _resolve(hass, msg)

    @callback
    def _handle() -> None:
        store = data_for(hass, entry_id)
        connection.send_message(
            websocket_api.event_message(
                msg["id"],
                {
                    "items": _agenda(hass, entry_id, msg[_WINDOW]),
                    "revision": store.revision,
                },
            )
        )

    connection.subscriptions[msg["id"]] = websocket_api.async_subscribe(hass, f"{DOMAIN}_{entry_id}_updated", _handle)
    connection.send_result(msg["id"], {"items": _agenda(hass, entry_id, msg[_WINDOW])})


@websocket_api.websocket_command(
    {
        "type": TYPE_COMMAND,
        vol.Required("command"): vol.In(
            [SERVICE_COMPLETE, SERVICE_MARK_MISSED, SERVICE_SKIP, SERVICE_RESET, SERVICE_CREATE, SERVICE_UPDATE, SERVICE_DELETE]
        ),
        vol.Optional(_ENTITY): [str],
        vol.Optional(ATTR_UID): str,
        vol.Optional("completed_at"): str,
        vol.Optional(ATTR_EXPECTED_REVISION): int,
        vol.Optional("item"): dict,
        vol.Optional("patch"): dict,
    }
)
@websocket_api.async_response
async def _command_command(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    from .commands import apply_command
    from .model import RoutineItem

    entry_id = _resolve(hass, msg)
    store = data_for(hass, entry_id)
    command = msg["command"]
    uid = msg.get(ATTR_UID)
    expected = msg.get(ATTR_EXPECTED_REVISION)
    payload: dict = {}
    if msg.get("item"):
        payload = dict(msg["item"])
    if msg.get("patch"):
        payload.update(msg["patch"])
    if msg.get("completed_at"):
        payload["completed_at"] = msg["completed_at"]

    try:
        item = await apply_command(store, command, payload, uid, expected)
    except Exception as error:  # noqa: BLE001 - surfaced to the client verbatim
        from .store import RoutineError

        if isinstance(error, RoutineError):
            connection.send_error(
                msg["id"],
                websocket_api.const.ERR_NOT_FOUND if error.code == "not-found" else "autiplanner_conflict"
                if error.code == "conflict"
                else "autiplanner_error",
                str(error),
            )
            return
        raise

    from . import notify

    notify(hass, entry_id)
    connection.send_result(
        msg["id"],
        {
            # Clients render the confirmed outcome, so the item is returned.
            "item": item.to_dict() if isinstance(item, RoutineItem) else item,
            "changed": True,
        },
    )
