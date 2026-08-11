# AutiPlanner

AutiPlanner is an accessibility-first routine planner designed around day-part planning (morning, afternoon, evening, night), explicit task outcomes, iCalendar interoperability, Home Assistant, and a Navet dashboard experience.

## Project goals

- Model routines as interoperable iCalendar `VTODO`/`VEVENT` data rather than a proprietary calendar format.
- Preserve AutiPlanner-specific metadata through standard `X-AUTIPLANNER-*` extension properties.
- Make task state explicit: pending, completed, missed, or skipped.
- Let each routine carry a visible priority: green `must_do`, yellow `preferably`, or red `optional`.
- Keep icon-font tokens and explicit day parts in the shared calendar data so every client presents the same routine.
- Keep Home Assistant as the synchronization/API boundary so Android and dashboard clients do not race to edit the same `.ics` file.
- Provide a provider-neutral core model that can be mapped into Navet without leaking Home Assistant payloads into shared UI code.
- Keep the project easy for Codex and other coding agents to extend incrementally.

## Architecture

```text
                         ┌──────────────────────┐
                         │   AutiPlanner ICS    │
                         │ VTODO / VEVENT + X-* │
                         └──────────┬───────────┘
                                    │
                         owned/read/written by
                                    │
                     ┌──────────────▼──────────────┐
                     │ Home Assistant integration │
                     │ entities + commands/API    │
                     └──────────┬─────────┬────────┘
                                │         │
                         HA API │         │ provider adapter
                                │         │
                       ┌────────▼───┐  ┌──▼──────────────┐
                       │ Android app│  │ Navet extension │
                        └────────────┘  └─────────────────┘
```

Android and Navet do not write the `.ics` file directly. They send commands through Home Assistant, and the integration performs locked, atomic persistence.

## Repository layout

```text
apps/
  android/                 Native Android client and Home Assistant-backed Compose app
  navet-extension/         AutiPlanner UI/adapter patch surface for a Navet fork
integrations/
  home-assistant/          Home Assistant custom integration
packages/
  core/                    Provider-neutral domain contracts
  ics/                     AutiPlanner iCalendar profile and serialization/parsing helpers
docs/
  ARCHITECTURE.md          Source-of-truth architecture decisions
  ICS_PROFILE.md           VTODO/VEVENT profile and custom fields
  NAVET_INTEGRATION.md     How to integrate with Navet safely
  ROADMAP.md               Suggested implementation sequence
examples/
  autiplanner.ics          Example calendar data
schemas/
  autiplanner.schema.json  JSON representation contract
```

## Core domain

A routine item belongs to a day and a day part and has an explicit outcome:

```ts
type DayPart = "morning" | "afternoon" | "evening" | "night";
type RoutineStatus = "pending" | "completed" | "missed" | "skipped";
type RoutinePriority = "must_do" | "preferably" | "optional";
```

The canonical persisted representation uses iCalendar tasks where possible:

```ics
BEGIN:VTODO
UID:breakfast-20260811@example
DTSTART:20260811T083000Z
SUMMARY:Eat breakfast
STATUS:COMPLETED
COMPLETED:20260811T084500Z
X-AUTIPLANNER-DAYPART:MORNING
X-AUTIPLANNER-OUTCOME:COMPLETED
END:VTODO
```

See [`docs/ICS_PROFILE.md`](docs/ICS_PROFILE.md) for the full profile.

Priority is stored as `X-AUTIPLANNER-PRIORITY` and is intentionally separate from outcome and day part:

- green — `must_do`;
- yellow — `preferably`;
- red — `optional` (safe to avoid when time or energy is limited).

Icons are stored as `X-AUTIPLANNER-ICON`. Values may be a Home Assistant/Material token such as `mdi:coffee`, a supported Font Awesome token such as `fa:coffee`, or a literal/custom-font glyph token such as `unicode:☕`.

## Current implementation status

This checkout contains working implementations rather than only planning documents:

- `packages/core` — provider-neutral contracts, validation, bounded recurrence, templates, and deterministic occurrence identity;
- `packages/ics` — VTODO parsing/serialization, UTF-8 line folding, TEXT escaping, malformed-record warnings, recurrence fields, icon/priority metadata, and round-trip tests;
- `integrations/home-assistant` — config flow, standard to-do/calendar entities, four-state services, atomic locked writes, explicit day-part/icon/priority create/update services, and a responsive Lovelace calendar card;
- `apps/navet-extension` — provider-neutral capability, Home Assistant mapping, monthly calendar with ISO week numbers, accessible routine widget, responsive themes, priority legend, and fixtures;
- `apps/android` — buildable Kotlin/Jetpack Compose app with a month calendar home, ISO week numbers, dark-mode toggle, event icons, priority colors/legend, Home Assistant REST access, polling, local cache, four-state actions, and create/edit/delete flows;
- `apps/android/app/src/main/res` — a calendar/checkmark launcher icon for the Android app.

The optional offline/conflict phase remains deferred until the Home Assistant-authoritative model proves insufficient.

## Installation and verification

### TypeScript packages

Prerequisites: Node.js 22 or newer, Corepack, and pnpm.

From the repository root:

```bash
corepack enable
corepack prepare pnpm@11.0.0 --activate
pnpm install
pnpm typecheck
pnpm test
```

The root test command covers `packages/core`, `packages/ics`, and `apps/navet-extension`.

### Home Assistant

Copy the custom component into the Home Assistant configuration directory:

```text
<home-assistant-config>/custom_components/autiplanner/
```

For this checkout, copy `integrations/home-assistant/custom_components/autiplanner/`. Restart Home Assistant, then select **AutiPlanner** from Settings → Devices & services → Add integration.

Configure an absolute `.ics` path, an integration display name, and the explicit default day part used only for imported VTODOs that lack `X-AUTIPLANNER-DAYPART`. A missing file is initialized as an empty `VCALENDAR`; malformed records are skipped with parse warnings.

If Home Assistant shows `Config flow could not be loaded: {"message":"Invalid handler specified"}`, it has not registered the installed flow. Check that the files are exactly under `<config>/custom_components/autiplanner/` (not an extra nested `integrations/home-assistant` or `autiplanner` directory), remove stale duplicate copies, copy the complete component again, and restart Home Assistant. The SSH installer verifies both `manifest.json` and `config_flow.py`; if the error remains, inspect Settings → System → Logs for the first `Error occurred loading flow for integration autiplanner` traceback.

The integration provides a standard `todo` entity, a standard `calendar` entity, the `autiplanner.complete`, `autiplanner.mark_missed`, `autiplanner.skip`, `autiplanner.reset`, `autiplanner.add_routine`, and `autiplanner.update_routine` services, and `autiplanner_item_updated` events containing UID, outcome, date, day part, priority, icon, and revision. Descriptions are not included in update events.

All writes use one in-process lock, a same-directory temporary file, flush/fsync, restrictive file permissions, and atomic replacement.

For repeatable remote installs, use [`scripts/install-home-assistant.sh`](scripts/install-home-assistant.sh). It accepts an SSH host/IP and port, uploads the custom component and Lovelace card, backs up existing copies, verifies the manifest/card, and does not restart Home Assistant unless explicitly requested:

```bash
./scripts/install-home-assistant.sh \
  --host 192.168.1.20 \
  --port 22 \
  --user root \
  --identity-file ~/.ssh/id_ed25519
```

The installer also uploads [`integrations/home-assistant/www/autiplanner-card.js`](integrations/home-assistant/www/autiplanner-card.js) to `<config>/www/`. Register the card once in Home Assistant under Settings → Dashboards → Resources as a JavaScript module with URL `/local/autiplanner-card.js`, then add:

```yaml
type: custom:autiplanner-card
entity: todo.autiplanner
theme: system
sort_priority: true
icon_font: "Material Design Icons"
```

The card is the ICS-backed monthly home view: ISO week numbers, selectable days, all four periods, priority colors and legend, icon-font tokens, completion actions, and a mobile-sized add-routine form. `icon_font` may be changed to a locally loaded Font Awesome or other icon-font family; use a literal `unicode:` token when a font requires an explicit glyph code.

The shorter form is also supported: `./scripts/install-home-assistant.sh 192.168.1.20 22 --user root`.

Use `--config-dir` when the Home Assistant configuration is not `/config`, and `--restart-command 'ha core restart'` only when the remote SSH environment provides that command. Run `--dry-run` first to inspect the source and destination without connecting.

Run the portable Home Assistant tests with:

```bash
python3 -m venv .venv-ha
.venv-ha/bin/pip install -r integrations/home-assistant/requirements_test.txt
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
  PYTHONPATH=integrations/home-assistant \
  .venv-ha/bin/pytest -q integrations/home-assistant/tests
```

### Android

Prerequisites: JDK 17, Android SDK platform 36, and Android build tools 36.

The Android project is in `apps/android` and pins AGP 9.0.1, Gradle 9.1, Kotlin 2.3.20, Android API 36, and Compose BOM 2026.06.01.

Set the SDK location in the ignored `apps/android/local.properties` file:

```properties
sdk.dir=/absolute/path/to/Android/sdk
```

Then build and test:

```bash
cd apps/android
export JAVA_HOME=/path/to/jdk-17
./gradlew testDebugUnitTest assembleDebug
```

The debug APK is generated at `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Install it on a connected device or emulator with:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

On first launch, enter the Home Assistant base URL, long-lived access token, and AutiPlanner to-do entity ID. The app opens on a month calendar with ISO week numbers; tapping a day opens its morning, afternoon, evening, and night sections. It includes a persistent dark-mode toggle, priority-colored event cards and legend, icon-font tokens, and a calendar/checkmark launcher icon. It reads `autiplanner_items` through the Home Assistant state API, sends mutations through Home Assistant services, refreshes after writes, polls periodically, and stores the last successful normalized list in an atomic private cache. The development build stores the token in private app preferences and never logs it; a production release should use Android Keystore-backed storage.

## Navet extension

`apps/navet-extension` is an AutiPlanner-owned patch surface; Navet itself is not vendored here. Its provider-neutral widget consumes normalized routine items and generic commands. The Home Assistant mapping is isolated in `src/home-assistant-provider.ts`; the widget does not parse ICS or issue raw service payloads.

It renders a monthly calendar with ISO week numbers, selectable day details divided into morning, afternoon, evening, and night, visible `○`, `✓`, `✕`, and `—` states, priority colors with a legend, icon-font tokens, primary completion and detail actions, keyboard/focus semantics, and responsive light, dark, black, and glass preview themes. A Navet fork should connect it to Navet's existing primitives and theme helpers.

```bash
pnpm --filter @autiplanner/navet-extension typecheck
pnpm --filter @autiplanner/navet-extension test
```

See [`docs/NAVET_INTEGRATION.md`](docs/NAVET_INTEGRATION.md) for the provider boundary and licensing guidance.

## Core data and recurrence

```ts
type DayPart = "morning" | "afternoon" | "evening" | "night";
type RoutineStatus = "pending" | "completed" | "missed" | "skipped";
type RoutinePriority = "must_do" | "preferably" | "optional";
```

Recurring masters remain pending; completion belongs to an occurrence override. Recurrence uses standard `RRULE`, `RDATE`, `EXDATE`, and `RECURRENCE-ID` fields. `packages/core` exposes `routineTemplateToMaster`, `occurrenceUid`, and `expandRoutineItem`. Expansion requires an explicit `from`/`to` window and defaults to a 1,000-occurrence safety cap. The current bounded generator supports `DAILY`, `WEEKLY`, and `MONTHLY` rules with `COUNT`, `UNTIL`, `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `RDATE`, and `EXDATE`; unsupported frequencies fail loudly. Icon and priority metadata round-trip through `X-AUTIPLANNER-ICON` and `X-AUTIPLANNER-PRIORITY`.

See [`docs/ICS_PROFILE.md`](docs/ICS_PROFILE.md) for the complete VTODO profile and malformed-record behavior.

## Development

The repository starts deliberately small. The TypeScript packages are the executable contract/reference layer, the Home Assistant integration is the authoritative local runtime, and the Navet extension is a provider-neutral widget/adapter patch surface.

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

The current checkout implements Phases 1–4 and the bounded Phase 5 core/codec work. The live Phase 4 acceptance check still requires a configured Home Assistant instance and Android device/emulator; those credentials and devices are intentionally not committed.

## Using Codex

Read [`AGENTS.md`](AGENTS.md) first. It defines the invariants Codex should preserve, the source-of-truth documents to read before changing each subsystem, and the recommended implementation order.

For architectural or integration changes, read `AGENTS.md` and the relevant source-of-truth document before editing. Keep Home Assistant as the single writer, keep provider payloads out of shared Navet UI, preserve stable UIDs, and add focused tests for user-visible behavior and malformed input.

## Publishing changes

The checkout is connected to the upstream GitHub remote. Review the worktree, create an intentional branch, commit, and push normally:

```bash
git remote -v
git status
git switch -c codex/your-change
git add README.md <other-files>
git commit -m "Describe the change"
git push -u origin codex/your-change
```

Do not commit access tokens, real household calendars, `local.properties`, build outputs, virtual environments, or generated caches.

## Navet licensing boundary

Navet is an upstream dependency/integration target and is not vendored into this initial repository. Navet currently identifies itself as AGPL-3.0. If you later copy or modify Navet source, keep those derivative portions compliant with Navet's license and preserve the relevant notices. This repository does not attempt to relicense upstream Navet code.

## Status

Phases 1–4 are implemented, and the bounded Phase 5 recurrence/template contract and codec support are complete. Provider/UI expansion of recurring occurrences and optional offline/conflict support remain future work.
