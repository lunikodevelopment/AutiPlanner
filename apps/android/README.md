# Android client

This directory is the boundary for the future native AutiPlanner Android application.

The initial repository intentionally does not pin an Android Gradle/Compose toolchain before the client phase starts. When Phase 4 begins, initialize the project using the then-current stable Android toolchain rather than inheriting stale scaffold versions.

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
