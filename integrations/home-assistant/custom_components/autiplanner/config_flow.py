"""Config flow for a local AutiPlanner ICS file."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_NAME

from .const import (
    CONF_DEFAULT_DAY_PART,
    CONF_ICON_FONT,
    CONF_PATH,
    DEFAULT_FILENAME,
    DEFAULT_ICON_FONT,
    DEFAULT_NAME,
    DOMAIN,
)
from .model import DAY_PARTS


class AutiPlannerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle user configuration for AutiPlanner."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Collect a local ICS path and import policy."""
        errors: dict[str, str] = {}
        if user_input is not None:
            path = Path(user_input[CONF_PATH]).expanduser()
            if not path.is_absolute() or path.exists() and path.is_dir():
                errors[CONF_PATH] = "invalid_path"
            elif any(entry.data.get(CONF_PATH) == str(path) for entry in self.hass.config_entries.async_entries(DOMAIN)):
                errors[CONF_PATH] = "already_configured"
            else:
                data = {
                    CONF_PATH: str(path),
                    CONF_NAME: user_input[CONF_NAME].strip() or DEFAULT_NAME,
                    CONF_DEFAULT_DAY_PART: user_input[CONF_DEFAULT_DAY_PART],
                    CONF_ICON_FONT: user_input[CONF_ICON_FONT].strip() or DEFAULT_ICON_FONT,
                }
                return self.async_create_entry(title=data[CONF_NAME], data=data)

        default_path = self.hass.config.path(DEFAULT_FILENAME)
        schema = vol.Schema(
            {
                vol.Required(CONF_NAME, default=DEFAULT_NAME): str,
                vol.Required(CONF_PATH, default=default_path): str,
                vol.Required(CONF_DEFAULT_DAY_PART, default="morning"): vol.In(DAY_PARTS),
                vol.Optional(CONF_ICON_FONT, default=DEFAULT_ICON_FONT): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)
