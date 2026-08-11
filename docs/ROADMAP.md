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

Goal: implement the date/day-part routine widget against the Home Assistant-backed capability.

- inspect current upstream agent/UX guidance;
- define provider-neutral capability and command model;
- Home Assistant provider mapping;
- accessible widget states and detail interactions;
- story/test coverage;
- responsive tablet/phone layout.

Exit condition: ✓/✕/○/— changes persist through Home Assistant and appear consistently after refresh.

## Phase 4 — Android app

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

- standard RRULE-based recurrence;
- occurrence-level outcome state;
- reusable routine templates;
- exceptions and one-off overrides;
- deterministic UID/occurrence identity rules.

Do not implement recurrence by cloning an unbounded future calendar.

## Phase 6 — Optional offline/conflict support

Only add this if it is actually needed.

- revision field;
- optimistic concurrency;
- conflict UI;
- deterministic merge rules;
- offline command queue.

Avoid building a distributed sync engine before the simpler Home Assistant-authoritative model proves insufficient.
