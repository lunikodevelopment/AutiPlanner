from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.autiplanner import _async_handle_status_service
from custom_components.autiplanner.const import DOMAIN, SERVICE_COMPLETE
from custom_components.autiplanner.model import RoutineItem
from custom_components.autiplanner.storage import RoutineStore


class FakeBus:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, object]]] = []

    def async_fire(self, event_type: str, event_data: dict[str, object]) -> None:
        self.events.append((event_type, event_data))


class FakeCall:
    def __init__(self, hass, service: str, data: dict[str, object]) -> None:
        self.hass = hass
        self.service = service
        self.data = data


def test_complete_service_returns_state_change_event_and_unknown_uid_is_an_error(tmp_path: Path) -> None:
    async def scenario() -> None:
        store = RoutineStore(tmp_path / "calendar.ics")
        await store.async_create_item(
            RoutineItem(
                uid="service-item",
                title="Take medication",
                date="2026-08-11",
                day_part="morning",
                status="pending",
            )
        )
        hass = SimpleNamespace(data={DOMAIN: {"entry": store}}, bus=FakeBus())
        await _async_handle_status_service(FakeCall(hass, SERVICE_COMPLETE, {"uid": "service-item"}))
        assert store.items[0].status == "completed"
        assert hass.bus.events[0][1]["uid"] == "service-item"

        with pytest.raises(HomeAssistantError):
            await _async_handle_status_service(FakeCall(hass, SERVICE_COMPLETE, {"uid": "missing"}))

    asyncio.run(scenario())
