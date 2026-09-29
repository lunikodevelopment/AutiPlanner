# Roadmap

This is an implementation order, not a deadline schedule. Codex should normally complete one phase before expanding into the next.

## Phase 0 — Foundation

Status: scaffolded.

- architecture invariants;
- ICS profile;
- provider-neutral TypeScript contracts;
- example ICS data;
- Home Assistant, Android, and Navet boundaries;
- agent instructions.

## Phase 1 — Core + ICS round trip

Status: implemented.

Goal: prove the data model independently of UI and Home Assistant.

- implement production-quality ICS parsing/serialization for the documented VTODO subset;
- implement line unfolding/folding and TEXT escaping;
- map pending/completed/missed/skipped correctly;
- preserve explicit day part;
- preserve unknown AutiPlanner extensions;
- add fixtures and round-trip tests;
- define behavior for malformed/imported records.

Exit condition: `examples/autiplanner.ics` parses to the expected core model and serializes without losing AutiPlanner semantics.

## Phase 2 — Home Assistant custom integration

Status: implemented.

Goal: make Home Assistant the authoritative runtime/synchronization layer.

- config flow;
- safe local ICS storage configuration;
- calendar and/or to-do entities using standard HA behavior;
- AutiPlanner commands for complete/missed/skipped/reset;
- mutation lock + atomic writes;
- tests for reload, concurrent mutations, malformed files, and service errors;
- state/event mechanism suitable for live clients.

Exit condition: two Home Assistant clients observe the same state and a mutation survives restart.

## Phase 3 — Navet experience

Status: capability and Home Assistant adapter implemented. The React widget
lives in a Navet fork or patch series, not in this repository.

Goal: implement the date/day-part routine widget against the Home Assistant-backed capability.

- inspect current upstream agent/UX guidance;
- define provider-neutral capability and command model;
- Home Assistant provider mapping;
- accessible widget states and detail interactions;
- story/test coverage;
- responsive tablet/phone layout.

Exit condition: ✓/✕/○/— changes persist through Home Assistant and appear consistently after refresh.

## Phase 4 — Android app

Status: implemented. Agenda, four-state actions, accessibility, and a Home
Assistant client are in place. Item create/edit/delete UI and a local cache are
still open.

Goal: native editing and daily use.

- Kotlin + Jetpack Compose project;
- Home Assistant authentication/connection strategy;
- daily agenda screen grouped by day part;
- create/edit/delete routine items;
- completed/missed/skipped/reset actions;
- dynamic type, TalkBack labels, large touch targets;
- local cache for resilience.

Exit condition: Android and Navet reflect each other's changes through Home Assistant.

## Phase 5 — Recurrence and templates

Status: implemented.

- standard `RRULE` subset: `FREQ` daily/weekly/monthly, `INTERVAL`, `COUNT`,
  `UNTIL`, `BYDAY` for weekly;
- occurrence-level outcome state; the series master is never completed;
- reusable routine templates with `EXDATE` and `RDATE`;
- one-off overrides addressed as `<series-uid>:<date>` with `RECURRENCE-ID`;
- deterministic occurrence identity.

Expansion is bounded to a 366-day requested window. The calendar is never
cloned into an unbounded future.

## Phase 6 — Optional offline/conflict support

Status: revision field, optimistic concurrency, conflict UI, and a command queue
are implemented. Offline-first mutation is not.

- `X-AUTIPLANNER-REVISION` is written and read on every record;
- commands accept `expectedRevision` / `expected_revision` and fail with a
  conflict instead of overwriting;
- a conflicting command is not applied; the client shows the stored item and
  leaves the retry to the user;
- `flushQueue` replays commands in order and stops at the first conflict;
- merge rules are deliberately absent. The server item is authoritative.

Adding an offline command queue and a true offline-first editor should wait until
the Home Assistant-authoritative model is shown to be insufficient.

## Remaining work

- Android create/edit/delete screens and a local read cache.
- A Navet React widget, in a Navet fork or patch series rather than this repo.
- Config-flow, entity, and service tests on the real Home Assistant harness,
  including verifying that token minting works on current Home Assistant.