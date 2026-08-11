# AutiPlanner

AutiPlanner is an accessibility-first routine planner designed around day-part planning (morning, afternoon, evening, night), explicit task outcomes, iCalendar interoperability, Home Assistant, and a Navet dashboard experience.

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
apps/
  android/                 Native Android client boundary and implementation notes
  navet-extension/         AutiPlanner UI/adapter work intended for a Navet fork/upstream patch
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

## Development

The repository starts deliberately small. The TypeScript packages are the executable contract/reference layer; the Home Assistant and Android directories begin as integration boundaries to be filled in feature-by-feature.

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

## Using Codex

Read [`AGENTS.md`](AGENTS.md) first. It defines the invariants Codex should preserve, the source-of-truth documents to read before changing each subsystem, and the recommended implementation order.

A useful first Codex task is:

> Read AGENTS.md, docs/ARCHITECTURE.md, docs/ICS_PROFILE.md, and docs/ROADMAP.md. Implement Phase 1 only: make the core model and ICS package parse and serialize the example VTODO records, add round-trip tests, and do not modify the Home Assistant, Android, or Navet boundaries yet.

## Navet licensing boundary

Navet is an upstream dependency/integration target and is not vendored into this initial repository. Navet currently identifies itself as AGPL-3.0. If you later copy or modify Navet source, keep those derivative portions compliant with Navet's license and preserve the relevant notices. This repository does not attempt to relicense upstream Navet code.

## Status

Foundation/scaffolding only. The data contract is intentionally specified before UI or synchronization code so that all clients can converge on the same behavior.
