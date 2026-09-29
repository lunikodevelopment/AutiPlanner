"""Config flow for the AutiPlanner integration."""

from __future__ import annotations

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv

from .const import CONF_CALENDAR_NAME, CONF_FILE_PATH, DOMAIN
from .paths import default_calendar_path, resolved, validate_calendar_path
from .store import RoutineStore

DEFAULT_NAME = "Routine"


def _schema(default_file: str, default_name: str) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_CALENDAR_NAME, default=default_name): cv.string,
            vol.Required(CONF_FILE_PATH, default=default_file): cv.string,
        }
    )


def _problems(value: str) -> dict[str, str]:
    """Validates a submitted path, including that it parses as a calendar."""
    problem = validate_calendar_path(value)
    if problem is not None:
        return {CONF_FILE_PATH: problem}
    try:
        # Reading the file is the last check. The store creates the file and its
        # directory when they are missing, so a new path is valid.
        RoutineStore(resolved(value)).load()
    except OSError:
        return {CONF_FILE_PATH: "unreadable"}
    except Exception:  # noqa: BLE001 - a malformed calendar is reported on the issues sensor
        return {}
    return {}


class AutiPlannerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Choose a local ICS file for the household routine calendar."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, str] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = _problems(user_input[CONF_FILE_PATH])
            if not errors:
                path = resolved(user_input[CONF_FILE_PATH])
                await self.async_set_unique_id(str(path))
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=user_input[CONF_CALENDAR_NAME] or DEFAULT_NAME,
                    data={
                        CONF_CALENDAR_NAME: user_input[CONF_CALENDAR_NAME] or DEFAULT_NAME,
                        CONF_FILE_PATH: str(path),
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_schema(default_calendar_path(self.hass.config.config_dir), DEFAULT_NAME),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> AutiPlannerOptionsFlow:
        return AutiPlannerOptionsFlow()


class AutiPlannerOptionsFlow(OptionsFlow):
    """Renames the calendar or moves it to another file.

    `OptionsFlow` supplies `self.config_entry`; defining `__init__` would break
    that, which is why the previous version showed blank defaults.
    """

    async def async_step_init(
        self, user_input: dict[str, str] | None = None
    ) -> ConfigFlowResult:
        current = self.config_entry.data
        if user_input is not None:
            errors = _problems(user_input[CONF_FILE_PATH])
            if errors:
                return self.async_show_form(
                    step_id="init",
                    data_schema=_schema(
                        user_input.get(CONF_FILE_PATH, ""),
                        user_input.get(CONF_CALENDAR_NAME, DEFAULT_NAME),
                    ),
                    errors=errors,
                )
            return self.async_create_entry(
                title="",
                data={
                    CONF_CALENDAR_NAME: user_input[CONF_CALENDAR_NAME] or DEFAULT_NAME,
                    CONF_FILE_PATH: str(resolved(user_input[CONF_FILE_PATH])),
                },
            )

        return self.async_show_form(
            step_id="init",
            data_schema=_schema(
                current.get(CONF_FILE_PATH, ""),
                current.get(CONF_CALENDAR_NAME, DEFAULT_NAME),
            ),
        )


__all__ = ["AutiPlannerConfigFlow", "AutiPlannerOptionsFlow"]
