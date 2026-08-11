# AutiPlanner icon catalog

AutiPlanner stores icons as strings in `X-AUTIPLANNER-ICON`, so the same choice survives between Android, Home Assistant, the Lovelace card, and Navet. The built-in catalog uses the Material Design Icons namespace:

```text
mdi:calendar-clock
mdi:clipboard-check
mdi:gamepad-variant
```

The Android editor and Home Assistant card ship the Material Design Icons font and a searchable picker. Categories are organized around common planning decisions: appointments, daily tasks, health and routines, free time, home and errands, travel, social, and nature/weather. Search matches the icon name, friendly label, and planning keywords.

The picker’s common-use catalog is intentionally focused enough to scan on a phone. Any additional Material Design Icons token can still be entered through the existing token APIs, and existing `fa:*` and `unicode:*` values remain valid for custom setups. The bundled font is Material Design Icons 7.4.47; its license is included in [`MATERIAL_DESIGN_ICONS_LICENSE.txt`](MATERIAL_DESIGN_ICONS_LICENSE.txt).

The Home Assistant installer uploads the card and font together:

```bash
./scripts/install-home-assistant.sh \
  --host 192.168.1.20 \
  --port 22 \
  --user root
```

The card references the font at `/local/autiplanner-icons.woff2`. If the card is copied manually, copy both `integrations/home-assistant/www/autiplanner-card.js` and `integrations/home-assistant/www/autiplanner-icons.woff2` into the Home Assistant `www/` directory, then hard-refresh the dashboard resource.
