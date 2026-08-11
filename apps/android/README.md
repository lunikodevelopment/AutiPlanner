# Android client

This directory is the boundary for the future native AutiPlanner Android application.

Phase 4 now contains a buildable Kotlin + Jetpack Compose client. The project pins the current toolchain used for this implementation: Android Gradle Plugin 9.0.1, Gradle 9.1, Kotlin 2.3.20, Android API 36, and Compose BOM 2026.06.01.

The first connection strategy is deliberately small and inspectable:

- configure a Home Assistant base URL, long-lived access token, and AutiPlanner to-do entity ID;
- read normalized `autiplanner_items` through `GET /api/states/{entity_id}`;
- send status changes through `POST /api/services/autiplanner/{service}`;
- send create/edit/delete through Home Assistant's standard `todo` services;
- refresh after every mutation and poll periodically so the Home Assistant state remains authoritative;
- keep the last successful normalized item list in an atomic local cache for read resilience.

The token is kept in the app's private preferences for this first scaffold and is never logged. A production release should replace that storage with an Android Keystore-backed secret store before distribution.

## Product requirements

- Kotlin + Jetpack Compose;
- Home Assistant-backed authentication/data connection;
- date navigation;
- sections for morning, afternoon, evening, and night;
- explicit pending/completed/missed/skipped controls;
- create/edit/delete routine items;
- TalkBack labels for all state controls;
- font scaling/dynamic type support;
- large touch targets;
- local cache for read resilience;
- no direct writes to the authoritative ICS file.

Suggested first screen:

```text
TUESDAY — 11 AUGUST

MORNING
  ✓ Take medication       08:00
  ○ Eat breakfast         08:30

AFTERNOON
  ✕ Exercise              13:30

EVENING
  — Optional journaling   20:00
```

## Build and test

From this directory:

```bash
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
./gradlew testDebugUnitTest assembleDebug
```

The generated debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. The UI includes loading, error, empty, all four outcome states, date navigation, detail actions, and create/edit/delete flows with TalkBack labels and 44–48 dp touch targets.
