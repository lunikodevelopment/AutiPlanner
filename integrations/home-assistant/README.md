# AutiPlanner Home Assistant integration

This directory contains the Phase 2 custom integration. It is configured from Home Assistant's UI and owns one local `.ics` file as the single writer for routine state.

## Install locally

Copy `custom_components/autiplanner` into the Home Assistant configuration directory:

```text
<config directory>/custom_components/autiplanner/
```

Restart Home Assistant, then add **AutiPlanner** from Settings → Devices & services. Choose an absolute `.ics` path and the explicit day-part fallback used only for imported VTODOs without `X-AUTIPLANNER-DAYPART`.

The integration exposes:

- a standard `todo` entity for interoperable create/update/delete/reorder operations;
- a standard `calendar` entity for agenda consumers;
- `autiplanner.complete`, `autiplanner.mark_missed`, `autiplanner.skip`, and `autiplanner.reset` actions for the richer four-state outcome model;
- `autiplanner_item_updated` events containing UID, outcome, day part, and revision, without logging or emitting descriptions.

All mutations go through one in-process `asyncio.Lock`, write a complete calendar to a same-directory temporary file, `fsync` it, and replace the configured file atomically. A missing file is initialized as an empty VCALENDAR. Malformed or incomplete records are skipped with warnings rather than guessed into a state; service errors leave the source file untouched.

## Tests

The portable tests cover the Python ICS codec, reload persistence, concurrent mutations, malformed records, and service errors:

```bash
python3 -m venv .venv-ha
.venv-ha/bin/pip install -r integrations/home-assistant/requirements_test.txt
PYTHONPATH=integrations/home-assistant .venv-ha/bin/pytest -q integrations/home-assistant/tests
```

The entity modules were also import-checked against Home Assistant 2026.2.3 during development. A full Home Assistant runtime is intentionally not committed to this repository.
