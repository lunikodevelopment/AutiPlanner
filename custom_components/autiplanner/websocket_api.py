"""WebSocket API for AutiPlanner clients.

Only long-standing ``websocket_api`` helpers are used here: ``websocket_command``,
``async_response``, ``async_register_command``, ``ActiveConnection``, and
``event_message``. Subscriptions are wired with ``async_dispatcher_connect``
directly, because ``websocket_api`` has no subscription decorator.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from . import data_for, entry_ids, notify
from .api import agenda_payload, item_payload
from .commands import apply_command
from .const import DOMAIN
from .store import RoutineError

TYPE_AGENDA = f"{DOMAIN}/agenda"
TYPE_SUBSCRIBE = f"{DOMAIN}/agenda/subscribe"
TYPE_COMMAND = f"{DOMAIN}/command"

_ENTITY = "entity_id"
_WINDOW = "limit"
_ITEM = "item"
_PATCH = "patch"

#: Codes Home Assistant understands as websocket error codes.
_CODE_NOT_FOUND = "not_found"
_CODE_CONFLICT = "autiplanner_conflict"
_CODE_ERROR = "autoplanner_error"


def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_agenda)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_command)


@callback
def _resolve(hass: HomeAssistant, connection, msg: dict) -> str | None:
    """Resolves the target config entry, or reports an error and returns None."""
    entity_ids = msg.get(_ENTITY)
    if not entity_ids:
        available = entry_ids(hass)
        if not available:
            connection.send_error(
                msg["id"], _CODE_NOT_FOUND, "No AutiPlanner calendar is configured"
            )
            return None
        return available[0]

    # `platform` is the integration; `domain` would be `sensor` or `calendar`.
    from homeassistant.helpers import entity_registry as er

    registry = er.async_get(hass)
    for entity_id in entity_ids:
        entry = registry.async_get(entity_id)
        if (
            entry is not None
            and entry.platform == DOMAIN
            and entry.config_entry_id in hass.data.get(DOMAIN, {})
        ):
            return entry.config_entry_id
    connection.send_error(
        msg["id"], _CODE_NOT_FOUND, f"{entity_ids[0]} is not an AutiPlanner entity"
    )
    return None


def _window(hass: HomeAssistant, limit: int) -> tuple[str, str, list]:
    try:
        tz = ZoneInfo(str(hass.config.time_zone))
    except (ZoneInfoNotFoundError, ValueError):  # pragma: no cover - unusual config
        tz = ZoneInfo("UTC")
    today = dt.datetime.now(tz=tz).date()
    start = (today - dt.timedelta(days=limit)).isoformat()
    end = (today + dt.timedelta(days=limit)).isoformat()
    return start, end, [tz]


def _rows(hass: HomeAssistant, entry_id: str, limit: int) -> dict:
    store = data_for(hass, entry_id)
    start, end, _ = _window(hass, limit)
    return agenda_payload(
        store.items_for_range(start, end),
        store.revision,
        [f"{code}: {message}" for code, message in store.issues],
        start,
        end,
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): TYPE_AGENDA,
        vol.Optional(_ENTITY): [str],
        vol.Optional(_WINDOW, default=14): vol.All(int, vol.Range(min=1, max=90)),
    }
)
@websocket_api.async_response
async def ws_agenda(hass: HomeAssistant, connection, msg: dict) -> None:
    entry_id = _resolve(hass, connection, msg)
    if entry_id is None:
        return
    connection.send_result(msg["id"], _rows(hass, entry_id, msg[_WINDOW]))


@websocket_api.websocket_command(
    {
        vol.Required("type"): TYPE_SUBSCRIBE,
        vol.Optional(_ENTITY): [str],
        vol.Optional(_WINDOW, default=14): vol.All(int, vol.Range(min=1, max=90)),
    }
)
@callback
def ws_subscribe(hass: HomeAssistant, connection, msg: dict) -> None:
    entry_id = _resolve(hass, connection, msg)
    if entry_id is None:
        return
    limit = msg[_WINDOW]

    @callback
    def _forward() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], _rows(hass, entry_id, limit))
        )

    # The unsubscribe callback must be registered before the first result is
    # sent, so a client that disconnects immediately still cleans up.
    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, f"{DOMAIN}_{entry_id}_updated", _forward
    )
    connection.send_result(msg["id"], _rows(hass, entry_id, limit))


@websocket_api.websocket_command(
    {
        vol.Required("type"): TYPE_COMMAND,
        vol.Required("command"): vol.In(
            ["complete", "mark_missed", "skip", "reset", "create", "update", "delete"]
        ),
        vol.Optional(_ENTITY): [str],
        vol.Optional("uid"): str,
        vol.Optional("completed_at"): str,
        vol.Optional("expected_revision"): int,
        vol.Optional(_ITEM, default=dict): dict,
        vol.Optional(_PATCH, default=dict): dict,
    }
)
@websocket_api.async_response
async def ws_command(hass: HomeAssistant, connection, msg: dict) -> None:
    entry_id = _resolve(hass, connection, msg)
    if entry_id is None:
        return
    store = data_for(hass, entry_id)

    payload: dict = dict(msg[_ITEM])
    payload.update(msg[_PATCH])
    if msg.get("completed_at"):
        payload["completed_at"] = msg["completed_at"]

    try:
        item = await apply_command(
            store,
            msg["command"],
            payload,
            msg.get("uid"),
            msg.get("expected_revision"),
        )
    except RoutineError as error:
        code = _CODE_CONFLICT if error.code == "conflict" else (
            _CODE_NOT_FOUND if error.code == "not-found" else _CODE_ERROR
        )
        connection.send_error(msg["id"], code, str(error))
        return

    notify(hass, entry_id)
    # Clients render the outcome that was actually stored, so the item is
    # returned instead of a bare boolean.
    connection.send_result(
        msg["id"],
        {
            "item": item_payload(item) if item is not None and hasattr(item, "uid") else None,
            "changed": True,
        },
    )
