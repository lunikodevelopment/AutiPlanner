# Navet extension boundary

AutiPlanner-owned capability and Home Assistant adapter for Navet. Navet source
itself is not vendored here. Follow `docs/NAVET_INTEGRATION.md` and upstream
`AGENTS.md` before changing Navet.

## Layout

```text
src/capability/   provider-neutral types, agenda grouping, outcome controls
src/homeassistant/ Home Assistant adapter
```

## Dependency direction

```text
Navet shared widget
       ↑ provider-neutral capability
       ↑ Home Assistant adapter
       ↑ AutiPlanner integration services / websocket
```

`src/capability` imports `@autiplanner/core` for the four-state domain types. It
does not import React, Navet, or a provider SDK. `src/homeassistant` is the only
place that knows about AutiPlanner service names and websocket frame types.

## Widget contract

Input: normalized `RoutineView` items plus a `RoutineProvider`.
Output: day-part sections with four visible states.

- `○` pending
- `✓` completed
- `✕` missed
- `—` skipped

`groupDays` never infers day part from a clock, and `outcomeControls` gives every
control a spoken label plus a 48px minimum target. Only `complete` is a
single-tap action. `missed` and `skipped` are marked `destructive` and are
reached through the secondary menu, and tapping the current state resets it, so
no state change is a one-tap dead end.

## Provider contract

`RoutineProvider` returns `RoutineCommandResult` with the confirmed item. A
client should not assume success from a boolean: it must reconcile with the
returned item, and roll back when `code` is `conflict`.

## Tests

```bash
pnpm --filter @autiplanner/navet-widget test
```
