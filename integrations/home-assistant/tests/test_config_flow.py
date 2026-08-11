"""Home Assistant config-flow coverage for AutiPlanner."""

from importlib import import_module

from homeassistant import config_entries

from custom_components.autiplanner.const import DOMAIN


def test_config_flow_registers_handler():
    """Importing the config flow registers the domain with Home Assistant."""
    module = import_module("custom_components.autiplanner.config_flow")

    assert config_entries.HANDLERS.get(DOMAIN) is module.AutiPlannerConfigFlow
