# Setting up AutiPlanner on Home Assistant

AutiPlanner runs entirely inside Home Assistant. There is no separate server:
the custom integration owns the calendar file, exposes the entities, and answers
the app. Once it is installed, connecting a phone takes one code.

## Install with HACS

1. In Home Assistant, open **HACS**.
2. Open the three-dot menu → **Custom repositories**.
3. Add `https://github.com/lunikodevelopment/AutiPlanner` with category
   **Integration**.
4. Search HACS for **AutiPlanner** and select **Download**.
5. **Restart Home Assistant.**

HACS reads `custom_components/autiplanner` from this repository, so it always
installs a version that matches the repository.

### Install without HACS

Copy the folder into your configuration directory and restart:

```bash
# Replace /config with your Home Assistant config directory
cp -r custom_components/autiplanner /config/custom_components/autiplanner
```

The result must be
`/config/custom_components/autiplanner/manifest.json`.

## Add the integration

1. Go to **Settings → Devices & services → Add integration**.
2. Search for **AutiPlanner**.
3. Leave the defaults and select **Submit**.

   | Field | Default |
   |---|---|
   | Calendar name | `Routine` |
   | Calendar file path | `/config/autiplanner/routine.ics` |

The integration creates the `autiplanner` folder and an empty calendar. You do
not create either by hand. To adopt an existing calendar, enter its path
instead; a file that does not fully parse is imported as far as possible and the
problems appear on the **Calendar issues** sensor.

## Confirm it worked

| Entity | Purpose |
|---|---|
| `calendar.routine` | Standard calendar view of the routine |
| `sensor.routine_today` | Today's items |
| `sensor.routine_agenda` | The agenda across a window of days |
| `sensor.routine_calendar_issues` | Import problems, `0` when the file is clean |

Replace `routine` with the slug of the calendar name you chose. Confirm the
exact ids under **Settings → Devices & services → AutiPlanner → entities**.

On the agenda sensors the **state is the number of items** and `items` is the
full list. Each entry carries a `dayPart` and one of four `status` values:
`pending`, `completed`, `missed`, or `skipped`. That is the contract every
client reads.

## Connect the app

This is the part that used to need a copied token. It no longer does.

1. In Home Assistant, go to **Developer tools → Actions**.
2. Choose **AutiPlanner: Pair a device**.
3. Select **Perform action**. The response contains a code:

   ```yaml
   code: 8SkQ2v1pR4mZ0aT7xLcWnA
   expires_in: 600
   base_url: https://your-instance:8123
   ```

4. Open the AutiPlanner app and enter the **address** and the **pairing code**.
5. Select **Pair this device**.

The app receives a Home Assistant token, saves the address, and looks up which
sensor to read. Nothing else to type.

The code is single use and expires after ten minutes. If it is never redeemed,
nothing is stored. Issued tokens appear in your Home Assistant profile as
**AutiPlanner app**, where you can revoke them.

### If you prefer a token by hand

Open the app, select **Enter a token manually**, and fill in the address,
a long-lived access token from your profile, and optionally the agenda sensor.
The token is stored in encrypted preferences on the device and is never backed
up.

## Try a command

Go to **Developer tools → Actions** and call `autiplanner.mark_missed`:

```yaml
action: autiplanner.mark_missed
target:
  entity_id: sensor.routine_today
data:
  uid: "exercise-20260811@autiplanner.local"
```

The stored item comes back with `status: missed`. It is written as
`STATUS:NEEDS-ACTION` plus `X-AUTIPLANNER-OUTCOME:MISSED`, never as completed.
Call `autiplanner.reset` to undo it.

Available actions: `complete`, `mark_missed`, `skip`, `reset`, `create`,
`update`, `delete`, `add_series`, and `pair`. Each mutation accepts an optional
`expected_revision`; a stale value fails with a conflict and writes nothing.

## Verifying the API directly

The app uses these routes. Replace the token and base URL:

```bash
curl -sS -X POST https://your-instance:8123/api/autiplanner/agenda \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id":["sensor.routine_agenda"],"limit":14}'
```

```bash
curl -sS -X POST https://your-instance:8123/api/autiplanner/command \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"mark_missed","entity_id":["sensor.routine_agenda"],"uid":"exercise-20260811@autoplanner.local"}'
```

A conflict returns HTTP 409 with `error.code: autiplanner_conflict`.

## Troubleshooting

**AutiPlanner does not appear in Add integration.** The files are in the wrong
place, or Home Assistant was not restarted. Confirm
`/config/custom_components/autiplanner/manifest.json` exists, then restart.

**"That location cannot be written to."** The parent directory is not writable
by Home Assistant. Choose a path under `/config`.

**Pairing returns "could not issue a token".** Home Assistant could not mint a
token on this release. Use manual setup with a long-lived token instead, and
report it with your Home Assistant version.

**The pairing code is rejected.** It expired after ten minutes or was already
used. Generate a new one.

**The app says it is not connected.** The address must include `http://` or
`https://` and the host. A `.local` address only resolves on the same network
unless you have remote access configured.

**Commands fail with a conflict.** Another client changed the same item. The
stored item is authoritative; read it, then retry with the current
`expected_revision`. There is no automatic merge.

## What is not supported yet

- No to-do entity. Home Assistant's to-do model can only store completed or not
  completed, which cannot express a missed or skipped routine item.
- Recurring routines use a subset of `RRULE` (`FREQ` daily/weekly/monthly,
  `INTERVAL`, `COUNT`, `UNTIL`, and weekly `BYDAY`). Other rules are reported and
  left untouched.
- Conflict resolution is manual by design.
