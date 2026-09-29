# AutiPlanner

AutiPlanner is an accessibility-first routine planner designed around day-part planning (morning, afternoon, evening, night), explicit task outcomes, iCalendar interoperability, Home Assistant, and a Navet dashboard experience.

It runs entirely inside Home Assistant. There is no separate backend service.

Setup guide: [`SETUP.md`](SETUP.md).

## Project goals

- Model routines as interoperable iCalendar `VTODO`/`VEVENT` data rather than a proprietary calendar format.
- Preserve AutiPlanner-specific metadata through standard `X-AUTIPLANNER-*` extension properties.
- Make task state explicit: pending, completed, missed, or skipped.
- Keep Home Assistant as the synchronization/API boundary so Android and dashboard clients do not race to edit the same `.ics` file.
- Provide a provider-neutral core model that can be mapped into Navet without leaking Home Assistant payloads into shared UI code.
- Keep the project easy for Codex and other coding agents to extend incrementally.

## Planned architecture

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

## Repository layout

```text
custom_components/
  autiplanner/             Home Assistant integration (HACS installs this)
apps/
  android/                 Kotlin + Jetpack Compose client
  navet-extension/         Provider-neutral capability and Home Assistant adapter
packages/
  core/                    Provider-neutral domain contracts
  ics/                     AutiPlanner iCalendar profile and serialization/parsing helpers
tests/                     Integration tests that need no Home Assistant
docs/
  INTEGRATION.md           Integration layout and client surfaces
  ARCHITECTURE.md          Source-of-truth architecture decisions
  ICS_PROFILE.md           VTODO/VEVENT profile and custom fields
  NAVET_INTEGRATION.md     How to integrate with Navet safely
  ROADMAP.md               Suggested implementation sequence
examples/
  autiplanner.ics          Example calendar data
  series.ics               Example recurring series with an override
schemas/
  autiplanner.schema.json  JSON representation contract
hacs.json                  HACS metadata
SETUP.md                   Setup guide for Home Assistant OS
```

## Core domain

A routine item belongs to a day and a day part and has an explicit outcome:

```ts
type DayPart = "morning" | "afternoon" | "evening" | "night";
type RoutineStatus = "pending" | "completed" | "missed" | "skipped";
```

The canonical persisted representation uses iCalendar tasks where possible:

```ics
BEGIN:VTODO
UID:breakfast-20260811@example
DTSTAMP:20260811T060000Z
DTSTART:20260811T083000Z
SUMMARY:Eat breakfast
STATUS:COMPLETED
COMPLETED:20260811T084500Z
X-AUTIPLANNER-DATE:2026-08-11
X-AUTIPLANNER-DAYPART:MORNING
X-AUTIPLANNER-OUTCOME:COMPLETED
END:VTODO
```

See [`docs/ICS_PROFILE.md`](docs/ICS_PROFILE.md) for the full profile.

## Development

The repository starts deliberately small. The TypeScript packages are the executable contract/reference layer; the Home Assistant and Android directories begin as integration boundaries to be filled in feature-by-feature.

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

The Home Assistant domain tests and the Android tests use their own harnesses:

```bash
pnpm test:ha
pnpm test:android
```

## Using Codex

Read [`AGENTS.md`](AGENTS.md) first. It defines the invariants Codex should preserve, the source-of-truth documents to read before changing each subsystem, and the recommended implementation order.

A useful next Codex task is:

> Read AGENTS.md, docs/ARCHITECTURE.md, docs/ICS_PROFILE.md, and docs/ROADMAP.md. Add the Android create/edit/delete screens and a local read cache, or extend the ICS profile. Keep all mutations routed through Home Assistant.

## License

AutiPlanner is released under the MIT License. See [`LICENSE`](LICENSE).

## Navet licensing boundary

Navet is an upstream dependency/integration target and is not vendored into this repository. Navet currently identifies itself as AGPL-3.0. If you later copy or modify Navet source, keep those derivative portions compliant with Navet's license and preserve the relevant notices. This repository does not attempt to relicense upstream Navet code, and the MIT license above applies only to AutiPlanner's own source.

## Status

Phases 1 through 5 are implemented, and phase 6 is implemented as revision checks
plus a command queue rather than a full offline sync engine.

- `packages/core` — four-state routine model, commands with revision checks,
  bounded recurrence expansion, day-part agenda, offline command queue.
- `packages/ics` — the AutiPlanner VTODO profile, line folding, TEXT escaping,
  explicit local dates, unknown `X-AUTIPLANNER-*` preservation, `RRULE` series.
- `custom_components/autiplanner` — the single writer, and the whole runtime.
  Calendar entity, agenda sensors, complete/missed/skipped/reset plus CRUD
  actions, pairing, a mutation lock, atomic writes, and an HTTP plus websocket
  API that returns the confirmed item.
- `apps/navet-extension` — provider-neutral capability plus a Home Assistant
  adapter. The React widget belongs in a Navet fork, not here.
- `apps/android` — Kotlin + Compose agenda client with 48dp targets, TalkBack
  labels, and rollback on conflict. Pairs with Home Assistant using a one-time
  code, then talks to it over the HTTP API.
- `custom_components/autiplanner` — the whole runtime. Installable through HACS.

Not done yet: Android create/edit/delete UI and its local cache, and a real
offline-first editor.
