"""HTTP API for AutiPlanner clients.

The Android app and any other client talk to these routes. Home Assistant
authenticates the bearer token; the routes never write the ICS file directly,
they call the same store the services use.
"""

from __future__ import annotations

import datetime as dt
import logging
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from . import data_for, entry_ids, notify
from .commands import apply_command
from .api import (
    ApiError,
    agenda_payload,
    command_payload,
    error_for,
    error_payload,
    normalize_date,
    normalize_entity_ids,
    normalize_limit,
    parse_command,
)
from .const import DOMAIN
from .store import RoutineError

_LOGGER = logging.getLogger(__name__)

AGENDA_URL = "/api/autiplanner/agenda"
COMMAND_URL = "/api/autiplanner/command"


async def _json(request: web.Request) -> dict:
    try:
        payload = await request.json()
    except ValueError as error:
        raise web.HTTPBadRequest(text="body must be JSON") from error
    if not isinstance(payload, dict):
        raise web.HTTPBadRequest(text="body must be a JSON object")
    return payload


def _resolve_entry(hass: HomeAssistant, payload: dict) -> str:
    """Resolves the target config entry, defaulting to the only one."""
    entity_ids = normalize_entity_ids(payload.get("entity_id"))
    if not entity_ids:
        available = entry_ids(hass)
        if not available:
            raise ApiError("no AutiPlanner calendar is configured", 404)
        return available[0]

    from homeassistant.helpers import entity_registry as er

    registry = er.async_get(hass)
    for entity_id in entity_ids:
        entry = registry.async_get(entity_id)
        # `platform` is the integration; `domain` would be `sensor` or `calendar`.
        if entry is not None and entry.platform == DOMAIN and entry.config_entry_id in hass.data.get(DOMAIN, {}):
            return entry.config_entry_id
    raise ApiError(f"{entity_ids[0]} is not an AutiPlanner entity", 404)


def _window(hass: HomeAssistant, limit: int, start: str | None) -> tuple[str, str]:
    try:
        tz = ZoneInfo(str(hass.config.time_zone))
    except (ZoneInfoNotFoundError, ValueError):  # pragma: no cover - unusual config
        tz = ZoneInfo("UTC")
    today = dt.datetime.now(tz=tz).date()
    if start is None:
        first = today - dt.timedelta(days=limit)
    else:
        first = dt.date.fromisoformat(start)
    return first.isoformat(), (first + dt.timedelta(days=limit * 2)).isoformat()


class AutiPlannerAgendaView(HomeAssistantView):
    """Returns the normalized agenda for a window."""

    url = AGENDA_URL
    name = "api:autiplanner:agenda"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        try:
            payload = await _json(request)
            entry_id = _resolve_entry(hass, payload)
            limit = normalize_limit(payload.get("limit"))
            start = normalize_date(payload.get("from"), "from")
        except ApiError as error:
            return web.json_response(
                error_payload("autiplanner_invalid", error.message),
                status=error.status,
            )

        store = data_for(hass, entry_id)
        window_start, window_end = _window(hass, limit, start)
        body = agenda_payload(
            store.items_for_range(window_start, window_end),
            store.revision,
            [f"{code}: {message}" for code, message in store.issues],
            window_start,
            window_end,
        )
        return web.json_response(body)


class AutiPlannerCommandView(HomeAssistantView):
    """Applies one command and returns the resulting item."""

    url = COMMAND_URL
    name = "api:autiplanner:command"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        try:
            payload = await _json(request)
            entry_id = _resolve_entry(hass, payload)
            command = parse_command(payload)
        except ApiError as error:
            return web.json_response(
                error_payload("autiplanner_invalid", error.message),
                status=error.status,
            )

        store = data_for(hass, entry_id)
        body: dict = dict(command.item) if command.item else {}
        body.update(command.patch)
        if command.completed_at is not None:
            body["completed_at"] = command.completed_at

        try:
            item = await apply_command(store, command.command, body, command.uid, command.expected_revision)
        except RoutineError as error:
            status, error_body = error_for(error.code, str(error))
            return web.json_response(error_body, status=status)

        notify(hass, entry_id)
        return web.json_response(command_payload(item))


def async_register(hass: HomeAssistant) -> None:
    hass.http.register_view(AutiPlannerAgendaView())
    hass.http.register_view(AutiPlannerCommandView())
