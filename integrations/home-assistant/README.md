# AutiPlanner Home Assistant integration

This directory contains the Phase 2 custom integration. It is configured from Home Assistant's UI and owns one local `.ics` file as the single writer for routine state.

## Install locally

Copy `custom_components/autiplanner` into the Home Assistant configuration directory:

```text
<config directory>/custom_components/autiplanner/
```

Restart Home Assistant, then add **AutiPlanner** from Settings → Devices & services. Choose an absolute `.ics` path, an icon-font family, and the explicit day-part fallback used only for imported VTODOs without `X-AUTIPLANNER-DAYPART`.

If the UI reports `Config flow could not be loaded: {"message":"Invalid handler specified"}`, verify that the complete directory is installed at `<config>/custom_components/autiplanner/`, including `config_flow.py` and `manifest.json`. Do not install the parent `integrations/home-assistant` directory or create a second nested `autiplanner` directory. Remove stale copies, restart Home Assistant, and check the first `Error occurred loading flow for integration autiplanner` traceback in Settings → System → Logs if it still fails.

The specific error `No module named 'custom_components.autiplanner.backup'` identifies an older or different installed copy; the current component does not import a `backup` module. Replace the complete directory from the `codex/publish-autiplanner` branch.

The integration exposes:

- a standard `todo` entity for interoperable create/update/delete/reorder operations;
- a standard `calendar` entity for agenda consumers;
- `autiplanner.complete`, `autiplanner.mark_missed`, `autiplanner.skip`, and `autiplanner.reset` actions for the richer four-state outcome model;
- `autiplanner.add_routine` and `autiplanner.update_routine` actions for explicit date, morning/afternoon/evening/night period, icon token, and priority metadata;
- `autiplanner_item_updated` events containing UID, outcome, date, day part, priority, icon, and revision, without logging or emitting descriptions.

Priority is persisted as `X-AUTIPLANNER-PRIORITY` and shown as a legend everywhere:

- green `must_do`;
- yellow `preferably`;
- red `optional`, suitable for skipping when time or energy is limited.

Icons are persisted as `X-AUTIPLANNER-ICON`. The built-in picker uses a bundled Material Design Icons 7.4.47 font and saves portable tokens such as `mdi:calendar-clock` or `mdi:coffee`. It groups the common-use catalog into appointments, daily tasks, health/routines, free time, home/errands, travel, social, and nature/weather, with live search across labels and keywords. Supported Font Awesome tokens such as `fa:coffee` and `unicode:` values remain valid for custom fonts.

## Lovelace card

The repository includes `www/autiplanner-card.js`, a dependency-free custom card for Home Assistant dashboards and the Home Assistant mobile app. Copy it to `<config>/www/autiplanner-card.js`, register `/local/autiplanner-card.js` as a JavaScript module resource, and add:

```yaml
type: custom:autiplanner-card
entity: todo.autiplanner
theme: system
sort_priority: true
icon_font: "Material Design Icons"
```

It provides the ICS-backed monthly calendar home with ISO week numbers, selectable days, all four periods, color-coded priorities, icon tokens, completion actions, and an inline routine form with a searchable categorized icon picker. The SSH installer uploads this card and `www/autiplanner-icons.woff2` automatically alongside the component. If copying manually, copy both files into `<config>/www/`; the card loads the font from `/local/autiplanner-icons.woff2`. `icon_font` can still name a locally loaded Font Awesome or other icon font for legacy/custom tokens.

All mutations go through one in-process `asyncio.Lock`, write a complete calendar to a same-directory temporary file, `fsync` it, and replace the configured file atomically. A missing file is initialized as an empty VCALENDAR. Malformed or incomplete records are skipped with warnings rather than guessed into a state; service errors leave the source file untouched.

## Tests

The portable tests cover the Python ICS codec, reload persistence, concurrent mutations, malformed records, four-state service errors, and explicit period/priority/icon routine creation:

```bash
python3 -m venv .venv-ha
.venv-ha/bin/pip install -r integrations/home-assistant/requirements_test.txt
PYTHONPATH=integrations/home-assistant .venv-ha/bin/pytest -q integrations/home-assistant/tests
```

The entity modules were also import-checked against Home Assistant 2026.2.3 during development. A full Home Assistant runtime is intentionally not committed to this repository.
