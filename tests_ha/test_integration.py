"""End-to-end tests against a real Home Assistant.

These are the tests that would have caught the invented `websocket_api`
symbols, the missing entity platforms, and the calendar event type. They load
the integration the way Home Assistant does.
"""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

DOMAIN = "autiplanner"


def _today() -> str:
    """Today in Home Assistant's timezone.

    The agenda sensors only report a window around today, so a fixed date in a
    test would silently fall outside it.
    """
    return dt_util.now().date().isoformat()


async def _setup(hass: HomeAssistant, tmp_path) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={
            "calendar_name": "Routine",
            "file_path": str(tmp_path / "routine.ics"),
        },
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_setup_creates_calendar_file(hass: HomeAssistant, tmp_path) -> None:
    await _setup(hass, tmp_path)
    assert (tmp_path / "routine.ics").exists()
    assert (tmp_path / "routine.ics").read_text(encoding="utf-8").startswith("BEGIN:VCALENDAR")


async def test_entities_are_created(hass: HomeAssistant, tmp_path) -> None:
    """The entity ids documented in SETUP.md must actually exist."""
    await _setup(hass, tmp_path)
    for entity_id in (
        "calendar.routine",
        "sensor.routine_today",
        "sensor.routine_agenda",
        "sensor.routine_calendar_issues",
    ):
        assert hass.states.get(entity_id) is not None, f"{entity_id} was not created"


async def test_services_are_registered(hass: HomeAssistant, tmp_path) -> None:
    await _setup(hass, tmp_path)
    for service in (
        "complete",
        "mark_missed",
        "skip",
        "reset",
        "create",
        "update",
        "delete",
        "add_series",
        "pair",
    ):
        assert hass.services.has_service(DOMAIN, service), f"{service} not registered"


async def test_agenda_sensor_exposes_the_four_states(hass: HomeAssistant, tmp_path) -> None:
    await _setup(hass, tmp_path)
    await hass.services.async_call(
        DOMAIN,
        "create",
        {
            "uid": "walk@autiplanner.local",
            "title": "Morning walk",
            "date": _today(),
            "day_part": "morning",
            "status": "pending",
            "entity_id": "sensor.routine_agenda",
        },
        blocking=True,
    )
    await hass.async_block_till_done()

    state = hass.states.get("sensor.routine_agenda")
    assert state is not None
    assert state.state == "1"
    item = state.attributes["items"][0]
    assert item["status"] == "pending"
    assert item["dayPart"] == "morning"


async def test_mark_missed_is_not_stored_as_completed(hass: HomeAssistant, tmp_path) -> None:
    await _setup(hass, tmp_path)
    await hass.services.async_call(
        DOMAIN,
        "create",
        {
            "uid": "walk@autiplanner.local",
            "title": "Morning walk",
            "date": _today(),
            "day_part": "morning",
            "status": "pending",
            "entity_id": "sensor.routine_agenda",
        },
        blocking=True,
    )
    await hass.async_block_till_done()

    await hass.services.async_call(
        DOMAIN,
        "mark_missed",
        {"uid": "walk@autiplanner.local", "entity_id": "sensor.routine_agenda"},
        blocking=True,
    )
    await hass.async_block_till_done()

    item = hass.states.get("sensor.routine_agenda").attributes["items"][0]
    assert item["status"] == "missed"
    assert "completedAt" not in item
    stored = (tmp_path / "routine.ics").read_text(encoding="utf-8")
    assert "X-AUTIPLANNER-OUTCOME:MISSED" in stored
    assert "STATUS:COMPLETED" not in stored


async def test_revision_conflict_does_not_write(hass: HomeAssistant, tmp_path) -> None:
    await _setup(hass, tmp_path)
    await hass.services.async_call(
        DOMAIN,
        "create",
        {
            "uid": "walk@autiplanner.local",
            "title": "Morning walk",
            "date": _today(),
            "day_part": "morning",
            "status": "pending",
            "entity_id": "sensor.routine_agenda",
        },
        blocking=True,
    )
    await hass.async_block_till_done()

    from homeassistant.exceptions import HomeAssistantError

    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN,
            "mark_missed",
            {
                "uid": "walk@autiplanner.local",
                "expected_revision": 99,
                "entity_id": "sensor.routine_agenda",
            },
            blocking=True,
        )
    await hass.async_block_till_done()
    item = hass.states.get("sensor.routine_agenda").attributes["items"][0]
    assert item["status"] == "pending"


async def test_legacy_entry_without_file_path_is_repaired(
    hass: HomeAssistant, tmp_path, monkeypatch
) -> None:
    """An entry from an older build has no `file_path`.

    Reading it directly raised KeyError inside async_setup_entry, which surfaced
    as "Error setting up entry AutiPlanner" and stopped every entity loading.
    """
    monkeypatch.setattr(hass.config, "config_dir", str(tmp_path))
    entry = MockConfigEntry(domain=DOMAIN, version=1, data={"calendar_name": "Routine"})
    entry.add_to_hass(hass)

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.data["file_path"] == str(tmp_path / "autiplanner" / "routine.ics")
    assert entry.version == 2
    assert (tmp_path / "autiplanner" / "routine.ics").exists()
    assert hass.states.get("sensor.routine_agenda") is not None


async def test_http_routes_are_registered(hass: HomeAssistant, tmp_path) -> None:
    """The app talks to these three routes.

    When they are missing, Home Assistant answers 404 and every client fails,
    which is exactly what happened before `websocket_api` was fixed.
    """
    await _setup(hass, tmp_path)
    registered = {
        resource.canonical for resource in hass.http.app.router.resources()
    }
    for path in (
        "/api/autiplanner/agenda",
        "/api/autiplanner/command",
        "/api/autiplanner/pair",
    ):
        assert path in registered, f"{path} was not registered"


async def test_pairing_issues_a_single_use_code(hass: HomeAssistant, tmp_path) -> None:
    await _setup(hass, tmp_path)
    response = await hass.services.async_call(
        DOMAIN,
        "pair",
        {"entity_id": "sensor.routine_agenda"},
        blocking=True,
        return_response=True,
    )
    assert response["code"]
    assert response["expires_in"] == 600

    # The HTTP route exchanges the code; here we assert the registry consumes it.
    from custom_components.autiplanner import pairings

    entry_id = next(iter(hass.data[DOMAIN]))
    registry = pairings(hass, entry_id)
    assert registry.redeem(response["code"]).code == response["code"]
    with pytest.raises(Exception):
        registry.redeem(response["code"])
