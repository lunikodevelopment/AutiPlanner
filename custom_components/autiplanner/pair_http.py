"""Pairing HTTP endpoint.

The app shows a one-time code and receives a token. This route is intentionally
unauthenticated, because the app has no token yet. The code is the credential:
high entropy, short lived, single use, and minted only by an authenticated
service call.

Token minting uses Home Assistant's own auth manager and is wrapped in broad
error handling. If the internal API differs on a given Home Assistant release,
pairing reports that it is unavailable and the household can still paste a
token by hand rather than the integration failing to load.
"""

from __future__ import annotations

import inspect
import logging

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from . import entry_ids, pairings
from .api import error_payload
from .pairing import PairingError

_LOGGER = logging.getLogger(__name__)

PAIR_URL = "/api/autiplanner/pair"

#: Identifies the issued refresh token in the Home Assistant token list.
PAIRING_CLIENT_ID = "https://github.com/lunikodevelopment/AutiPlanner"
PAIRING_CLIENT_NAME = "AutiPlanner app"


class AutiPlannerPairView(HomeAssistantView):
    """Exchanges a one-time code for a Home Assistant token."""

    url = PAIR_URL
    name = "api:autiplanner:pair"
    requires_auth = False

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        try:
            body = await request.json()
        except ValueError:
            body = {}
        if not isinstance(body, dict):
            body = {}

        code = body.get("code")
        device_name = body.get("device_name")
        if device_name is not None and not isinstance(device_name, str):
            device_name = None

        for entry_id in entry_ids(hass):
            registry = pairings(hass, entry_id)
            try:
                record = registry.redeem(code, device_name=device_name)
            except PairingError as error:
                # A wrong code is expected while the app iterates over entries.
                if error.code == "pairing_code_invalid":
                    continue
                return web.json_response(
                    error_payload(f"autiplanner_{error.code}", str(error)),
                    status=400,
                )

            token = await _mint_token(hass, record.user_id, device_name)
            if token is None:
                return web.json_response(
                    error_payload(
                        "autiplanner_pairing_unavailable",
                        "Home Assistant could not issue a token for this code. "
                        "Create a long-lived token in your profile instead.",
                    ),
                    status=503,
                )
            return web.json_response(
                {
                    "access_token": token,
                    "entity_id": _agenda_entity_id(hass, entry_id),
                    "base_url": _base_url(hass),
                    "token_type": "Bearer",
                }
            )

        return web.json_response(
            error_payload("autiplanner_pairing_code_invalid", "That pairing code is not valid"),
            status=400,
        )


async def _mint_token(
    hass: HomeAssistant,
    user_id: str | None,
    device_name: str | None,
) -> str | None:
    """Creates a long-lived token for the user who issued the code."""
    try:
        from homeassistant.auth.models import RefreshTokenType
    except ImportError:  # pragma: no cover - guarded for older or unusual builds
        _LOGGER.warning("AutiPlanner pairing is unavailable: auth models not importable")
        return None

    auth = hass.auth
    user = auth.async_get_user(user_id) if user_id else None
    if user is None:
        # Fall back to the first owner so a code issued by an admin still works.
        owners = await auth.async_get_owners()
        user = owners[0] if owners else None
    if user is None:
        return None

    try:
        refresh = auth.async_create_refresh_token(
            user,
            PAIRING_CLIENT_ID,
            client_name=device_name or PAIRING_CLIENT_NAME,
            token_type=RefreshTokenType.long_lived,
        )
        if inspect.isawaitable(refresh):
            refresh = await refresh
        access = auth.async_create_access_token(refresh)
        if inspect.isawaitable(access):
            access = await access
        return access if isinstance(access, str) else None
    except Exception as error:  # noqa: BLE001 - degrade instead of breaking setup
        _LOGGER.error("AutiPlanner could not mint a pairing token: %s", error)
        return None


def _agenda_entity_id(hass: HomeAssistant, entry_id: str) -> str | None:
    """Finds the agenda sensor so the app does not have to guess an entity id."""
    try:
        from homeassistant.helpers import entity_registry as er

        registry = er.async_get(hass)
        for entry in er.async_entries_for_config_entry(registry, entry_id):
            if entry.unique_id == f"{entry_id}-agenda":
                return entry.entity_id
    except Exception:  # noqa: BLE001 - the app falls back to manual entry
        return None
    return None


def _base_url(hass: HomeAssistant) -> str | None:
    return hass.config.external_url or hass.config.internal_url


def async_register(hass: HomeAssistant) -> None:
    hass.http.register_view(AutiPlannerPairView())


__all__ = ["AutiPlannerPairView", "PAIRING_CLIENT_ID", "PAIR_URL", "async_register"]
