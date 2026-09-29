"""Tests for the calendar path rules."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from tests import install_package

install_package()

from autiplanner.paths import (  # noqa: E402
    PathProblem,
    default_calendar_path,
    resolved,
    validate_calendar_path,
)


class DefaultPathTest(unittest.TestCase):
    def test_default_path_is_inside_the_config_directory(self) -> None:
        path = default_calendar_path("/config")
        self.assertEqual(path, "/config/autiplanner/routine.ics")

    def test_default_path_has_no_platform_separator_leak(self) -> None:
        # Uses pathlib, so the separator follows the platform.
        expected = str(Path("/config") / "autiplanner" / "routine.ics")
        self.assertEqual(default_calendar_path("/config"), expected)


class ValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def test_a_missing_parent_directory_is_accepted(self) -> None:
        # This is the regression: the default folder does not exist on a fresh
        # install, and rejecting it made setup impossible.
        nested = self.root / "autiplanner" / "routine.ics"
        self.assertFalse(nested.parent.exists())
        self.assertIsNone(validate_calendar_path(str(nested)))

    def test_an_existing_file_is_accepted(self) -> None:
        target = self.root / "routine.ics"
        target.write_text("BEGIN:VCALENDAR\nEND:VCALENDAR\n", encoding="utf-8")
        self.assertIsNone(validate_calendar_path(str(target)))

    def test_empty_input_is_rejected(self) -> None:
        self.assertEqual(validate_calendar_path(""), PathProblem.EMPTY)
        self.assertEqual(validate_calendar_path("   "), PathProblem.EMPTY)

    def test_a_directory_is_rejected(self) -> None:
        self.assertEqual(validate_calendar_path(str(self.root)), PathProblem.IS_DIRECTORY)

    def test_a_read_only_parent_is_rejected(self) -> None:
        locked = self.root / "locked"
        locked.mkdir()
        os.chmod(locked, 0o500)
        try:
            problem = validate_calendar_path(str(locked / "routine.ics"))
            self.assertEqual(problem, PathProblem.NOT_WRITABLE)
        finally:
            os.chmod(locked, 0o700)

    def test_resolved_expands_a_home_directory(self) -> None:
        resolved_path = resolved("~/routine.ics")
        self.assertFalse(str(resolved_path).startswith("~"))
        self.assertTrue(resolved_path.is_absolute())


if __name__ == "__main__":
    unittest.main()
