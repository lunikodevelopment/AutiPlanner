"""Pytest configuration for the Home Assistant integration tests.

These tests run against a real Home Assistant via
`pytest-homeassistant-custom-component`. They live outside `tests/` on purpose:
`tests/` holds the dependency-free unit tests that run with plain `unittest`,
and this directory needs the Home Assistant harness.
"""

from __future__ import annotations

import pathlib
import sys
import types

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
OUR_COMPONENTS = str(REPO_ROOT / "custom_components")


def _expose_our_custom_components() -> None:
    """Makes this repository's `custom_components` importable by Home Assistant.

    Home Assistant discovers custom integrations with `import custom_components`
    and then walks `custom_components.__path__`. The test harness ships its own
    `custom_components` package in `testing_config`, and whichever is imported
    first wins, so ours would be invisible and every setup would fail with
    "Integration not found".

    The `__path__` is extended rather than replaced, so the harness keeps access
    to its own test integrations.
    """
    existing = sys.modules.get("custom_components")
    if existing is None:
        package = types.ModuleType("custom_components")
        package.__path__ = [OUR_COMPONENTS]
        sys.modules["custom_components"] = package
        return

    paths = list(getattr(existing, "__path__", []) or [])
    if OUR_COMPONENTS not in paths:
        # Ours first so a name clash resolves to this repository.
        paths.insert(0, OUR_COMPONENTS)
    existing.__path__ = paths
    spec = getattr(existing, "__spec__", None)
    if spec is not None:
        spec.submodule_search_locations = paths


_expose_our_custom_components()


@pytest.fixture(autouse=True)
def _custom_integrations(enable_custom_integrations):
    """Lets Home Assistant load ``custom_components/`` from this repository."""
    yield
