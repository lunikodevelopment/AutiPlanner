"""Constants for the AutiPlanner Home Assistant integration."""

from __future__ import annotations

DOMAIN = "autiplanner"
PLATFORMS = ["todo", "calendar"]

CONF_PATH = "path"
CONF_NAME = "name"
CONF_DEFAULT_DAY_PART = "default_day_part"
CONF_ICON_FONT = "icon_font"
DEFAULT_FILENAME = "autiplanner.ics"
DEFAULT_NAME = "AutiPlanner"
DEFAULT_ICON_FONT = "Material Design Icons"

ATTR_UID = "uid"
ATTR_ENTITY_ID = "entity_id"
ATTR_COMPLETED_AT = "completed_at"
ATTR_TITLE = "title"
ATTR_DATE = "date"
ATTR_DAY_PART = "day_part"
ATTR_ICON = "icon"
ATTR_PRIORITY = "priority"
ATTR_DESCRIPTION = "description"
ATTR_START = "start"
ATTR_END = "end"
ATTR_DUE = "due"

SERVICE_COMPLETE = "complete"
SERVICE_MARK_MISSED = "mark_missed"
SERVICE_SKIP = "skip"
SERVICE_RESET = "reset"
SERVICE_ADD_ROUTINE = "add_routine"
SERVICE_UPDATE_ROUTINE = "update_routine"

EVENT_ITEM_UPDATED = "autiplanner_item_updated"
