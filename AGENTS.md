# AutiPlanner agent instructions

This file is the entry point for Codex and other coding agents working in this repository.

## Required reading

Before changing code, read:

1. `docs/ARCHITECTURE.md`
2. `docs/ICS_PROFILE.md`
3. `docs/ROADMAP.md`

For Navet work, also read `docs/NAVET_INTEGRATION.md` and the upstream Navet `AGENTS.md` plus the files it marks as required.

## Product invariant

AutiPlanner is a routine planner organized by date and explicit day parts. A routine item can be pending, completed, missed, or skipped. The UI must never collapse those four meanings into a single boolean.

Canonical presentation intent:

```text
MONDAY — DATE
  MORNING
    ✓ completed item
    ✕ missed item
    ○ pending item
    — skipped item
  AFTERNOON
  EVENING
```

## Architecture invariants

- `packages/core` owns provider-neutral domain contracts. It must not import Home Assistant, Android, React, Navet, or iCalendar parser implementations.
- `packages/ics` maps between the core model and the AutiPlanner iCalendar profile.
- Home Assistant is the synchronization boundary and intended single writer for persisted calendar state once the integration exists.
- Android and Navet clients should send commands to Home Assistant rather than directly editing the same `.ics` file.
- `missed` and `skipped` remain distinct AutiPlanner outcomes even though Home Assistant's generic to-do model may not have equivalent first-class states.
- Preserve unknown `X-AUTIPLANNER-*` properties when practical. Never silently rewrite a missed item as completed or pending.
- Use stable UIDs. Do not derive identity from a mutable title.
- Treat timezone and all-day semantics explicitly. Never guess a timezone from a formatted clock string.
- Prefer incremental, testable changes over a rewrite.

## iCalendar rules

- Prefer RFC 5545 `VTODO` for actionable routine items.
- `VEVENT` may represent non-actionable calendar events, but completion state belongs to task/routine semantics.
- Store day part in `X-AUTIPLANNER-DAYPART`.
- Store the four-state outcome in `X-AUTIPLANNER-OUTCOME`.
- For completed tasks, set standard `STATUS:COMPLETED` and `COMPLETED` in addition to the extension outcome.
- For pending, missed, and skipped tasks, standard status remains compatible with non-completed VTODO semantics; the AutiPlanner extension carries the richer outcome.
- Do not invent a new file extension or a non-iCalendar grammar. AutiPlanner uses ordinary `.ics` with extension properties.

## Accessibility rules

Accessibility is a product requirement, not a cleanup pass.

- Never communicate status using color alone.
- Every ✓/✕/○/— control needs an accessible text label.
- Completion actions must have sufficiently large touch targets for tablet/phone use.
- Respect font scaling and dynamic type in Android.
- Keep day-part headings and item state semantically exposed to assistive technologies.
- Avoid destructive one-tap state changes without an easy reversal path.

## Navet boundary

Do not vendor or copy upstream Navet into this repository unless the task explicitly calls for it and licensing implications have been considered. Prefer an upstream fork/branch or patch series. Navet currently describes its architecture as provider-neutral core/UI plus provider-specific adapters; AutiPlanner UI work should follow that separation.

## Home Assistant boundary

When implementing the custom integration:

- Verify entity/service behavior against current official Home Assistant developer documentation.
- Expose generic fields through standard calendar/to-do entities where possible.
- Keep richer AutiPlanner outcome/day-part data available through integration-owned commands/data rather than forcing it into unrelated HA fields.
- Serialize writes so two clients cannot concurrently corrupt the ICS store.
- Use atomic file replacement or an equivalent safe storage strategy.

## Definition of done for feature work

A feature is not done until:

- domain behavior is covered by tests;
- ICS round-trip behavior is tested when persistence changes;
- completed/missed/skipped/pending are all considered;
- accessibility behavior is considered for UI changes;
- docs are updated when a public contract or architecture decision changes;
- no secrets, Home Assistant tokens, private URLs, or personal calendar data are committed.

## Recommended Codex workflow

1. State which roadmap phase the requested change belongs to.
2. Read only the relevant package/docs plus neighboring tests.
3. Add or update tests before broad refactors.
4. Keep a small diff.
5. Run the narrowest useful checks, then the repository checks.
6. Summarize changed contracts and any follow-up work without silently expanding scope.
