"""Home Assistant tests for the AutiPlanner integration.

The store, ICS, and recurrence modules have no Home Assistant imports, so they
can be tested without Home Assistant installed. Importing
``autiplanner.ics`` normally executes ``autiplanner/__init__.py``, which does
import Home Assistant, so a package stub is registered here first. Only the
in-memory stub is replaced; nothing on disk is modified.
"""

import importlib
import pathlib
import sys
import types

COMPONENT = pathlib.Path(__file__).resolve().parents[1] / "custom_components" / "autiplanner"
COMPONENTS_ROOT = COMPONENT.parent

#: Modules under test that do not depend on Home Assistant.
PURE_MODULES = ("const", "model", "paths", "ics", "recurrence", "store", "api", "commands", "pairing")


def install_package() -> types.ModuleType:
    """Registers an in-memory ``autiplanner`` package for the pure modules."""
    if "autiplanner" in sys.modules:
        return sys.modules["autiplanner"]

    package = types.ModuleType("autiplanner")
    package.__path__ = [str(COMPONENT)]
    # Mark it as a real package so relative imports resolve against __path__.
    package.__spec__ = importlib.machinery.ModuleSpec(
        "autiplanner",
        loader=None,
        origin=str(COMPONENT / "__init__.py"),
        is_package=True,
    )
    package.__spec__.submodule_search_locations = [str(COMPONENT)]
    sys.modules["autiplanner"] = package
    sys.path.insert(0, str(COMPONENTS_ROOT))

    for name in PURE_MODULES:
        importlib.import_module(f"autiplanner.{name}")
    return package
