# Android client

Native Jetpack Compose client for AutiPlanner. It reads and writes through
Home Assistant only. The app never edits the authoritative `.ics` file.

## Layout

```text
app/src/main/java/app/autiplanner/
  AutiPlannerApplication.kt  container, crash recording
  core/Routine.kt        four-state model, day parts, clock and labels
  core/Agenda.kt         outcome controls, touch targets, summary
  data/Settings.kt       connection settings and validation
  data/EncryptedSettingsStore.kt  encrypted token storage
  data/AppContainer.kt   builds the client, never throws while unconfigured
  data/CrashLog.kt       last unexpected crash
  data/HomeAssistantClient.kt  transport seam and commands
  ui/AgendaScreen.kt     agenda grouped by day part
  ui/AgendaViewModel.kt  state holder with rollback on conflict
  ui/SetupScreen.kt      first-run connection screen
  ui/CrashBanner.kt
  MainActivity.kt
app/src/test/            domain and startup regression tests
```

## Product requirements

- date navigation;
- sections for morning, afternoon, evening, and night;
- explicit pending/completed/missed/skipped controls;
- completed/missed/skipped/reset actions;
- TalkBack labels for every state control;
- dynamic type and font scaling;
- 48dp minimum touch targets;
- no direct writes to the authoritative ICS file.

## Accessibility decisions

- `○` `✓` `✕` `—` are paired with the words Pending, Completed, Missed,
  Skipped. Color is a secondary cue only.
- The primary button announces the action it performs ("Mark completed",
  "Reset to pending") rather than only the current state.
- Only completion is a single tap. Missed and skipped open a confirmation
  because they are easy to trigger by accident.
- Tapping the current state resets it, so no state change is a one-tap dead end.
- Day-part headings and rows expose merged accessibility labels.

## Concurrency

A command sends `expected_revision`. On conflict the row rolls back to the item
Home Assistant returns and a message explains that the stored version is shown.
The app never silently overwrites another client's change.

## First run

The app opens on a setup screen and asks for the Home Assistant address, a
long-lived access token, and the AutiPlanner entity to read. The token is stored
in `EncryptedSharedPreferences`, and `allowBackup` is disabled so it is never
copied into a cloud backup.

Nothing is written before setup. The container builds a client that reports
"not connected" as ordinary UI state, so a missing configuration shows an error
banner instead of crashing.

## When something does crash

An unexpected exception is recorded before the process exits, and the next
launch shows what happened with a dismiss action. Expected failures (offline,
not configured, revision conflict) are UI state and never reach that handler.

## Build

Requires JDK 17 and the Android SDK.

```bash
cd apps/android
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
```

`local.properties` is machine specific and is not committed; use
`local.properties.sample` as the template.
