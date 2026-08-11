"""Constants for the AutiPlanner Home Assistant integration."""

from __future__ import annotations

DOMAIN = "autiplanner"
PLATFORMS = ["todo", "calendar"]

CONF_PATH = "path"
CONF_NAME = "name"
CONF_DEFAULT_DAY_PART = "default_day_part"
DEFAULT_FILENAME = "autiplanner.ics"
DEFAULT_NAME = "AutiPlanner"

ATTR_UID = "uid"
ATTR_COMPLETED_AT = "completed_at"

SERVICE_COMPLETE = "complete"
SERVICE_MARK_MISSED = "mark_missed"
SERVICE_SKIP = "skip"
SERVICE_RESET = "reset"

EVENT_ITEM_UPDATED = "autiplanner_item_updated"
