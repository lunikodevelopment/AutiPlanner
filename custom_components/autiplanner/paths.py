"""Calendar file path rules.

This module imports no Home Assistant code, so the rules are unit tested on
their own. It also holds the default location, which the config flow and the
docs both refer to.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

#: Subdirectory of the Home Assistant config directory that the integration owns.
DEFAULT_SUBDIRECTORY = "autiplanner"
DEFAULT_FILENAME = "routine.ics"


class PathProblem:
    EMPTY = "empty_path"
    IS_DIRECTORY = "path_is_directory"
    NOT_A_FILE = "not_a_file"
    NOT_WRITABLE = "not_writable"
    NOT_READABLE = "not_readable"


def default_calendar_path(config_dir: str) -> str:
    """`<config>/autiplanner/routine.ics`. The store creates the directory."""
    return str(Path(config_dir) / DEFAULT_SUBDIRECTORY / DEFAULT_FILENAME)


def resolved(value: str) -> Path:
    return Path(os.path.expanduser(value.strip())).resolve()


def validate_calendar_path(value: str) -> str | None:
    """Returns a problem key, or None when the path is usable.

    A missing parent directory is accepted on purpose: the integration owns this
    file and creates the directory on first load. Rejecting it would make the
    default path unusable on a fresh install.
    """
    if not value or not value.strip():
        return PathProblem.EMPTY

    path = Path(os.path.expanduser(value.strip()))
    if path.is_dir():
        return PathProblem.IS_DIRECTORY
    if path.exists() and not path.is_file():
        return PathProblem.NOT_A_FILE

    if path.exists() and not os.access(path, os.R_OK):
        return PathProblem.NOT_READABLE

    # Walk up to the nearest existing ancestor and require that it is writable,
    # because that is where the missing directories will be created.
    ancestor = path.parent
    while not ancestor.exists() and ancestor != ancestor.parent:
        ancestor = ancestor.parent
    if not ancestor.exists() or not os.access(ancestor, os.W_OK):
        return PathProblem.NOT_WRITABLE
    return None


@dataclass(frozen=True)
class CalendarPath:
    """A validated path plus the directory that must exist before writing."""

    path: Path
    directory: Path


def describe(config_dir: str) -> CalendarPath:
    path = resolved(default_calendar_path(config_dir))
    return CalendarPath(path=path, directory=path.parent)
