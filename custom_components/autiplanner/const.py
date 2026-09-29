"""Constants for the AutiPlanner integration."""

from __future__ import annotations

DOMAIN = "autiplanner"
PLATFORMS = ["calendar", "sensor"]

CONF_CALENDAR_NAME = "calendar_name"
CONF_FILE_PATH = "file_path"

ATTR_UID = "uid"
ATTR_DAY_PART = "day_part"
ATTR_OUTCOME = "autiplanner_outcome"
ATTR_START = "start"
ATTR_DUE = "due"
ATTR_COMPLETED_AT = "completed_at"
ATTR_REVISION = "revision"
ATTR_ROUTINE_ID = "routine_id"
ATTR_EXPECTED_REVISION = "expected_revision"
ATTR_ISSUES = "autiplanner_issues"
ATTR_REVISION_STAMP = "autiplanner_revision"

SERVICE_COMPLETE = "complete"
SERVICE_MARK_MISSED = "mark_missed"
SERVICE_SKIP = "skip"
SERVICE_RESET = "reset"
SERVICE_CREATE = "create"
SERVICE_UPDATE = "update"
SERVICE_DELETE = "delete"
SERVICE_ADD_SERIES = "add_series"
SERVICE_PAIR = "pair"

OUTCOMES = ["pending", "completed", "missed", "skipped"]
