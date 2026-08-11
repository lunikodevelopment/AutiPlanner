# Navet extension boundary

This directory contains AutiPlanner-owned notes, fixtures, and (if useful later) provider-neutral prototype code for the Navet experience. It does not vendor Navet itself.

For actual Navet source changes, work in a Navet fork or patch branch and follow `docs/NAVET_INTEGRATION.md` plus upstream agent/design guidance.

## Desired widget contract

Input: a list of normalized routine items plus mutation commands.

Output: accessible date/day-part sections with four visible states:

- `○` pending
- `✓` completed
- `✕` missed
- `—` skipped

Do not make the shared widget parse ICS or issue raw Home Assistant service payloads.

## Phase 3 prototype

The source files in `src/` are an AutiPlanner-owned patch surface for a Navet fork:

- `capability.ts` defines the normalized state and command boundary consumed by UI;
- `home-assistant-provider.ts` maps the Home Assistant to-do entity and AutiPlanner services;
- `routine-planner.tsx` renders the date/day-part experience;
- `routine-planner.css` supplies a restrained standalone preview stylesheet with all four Navet themes;
- `story-fixtures.ts` provides realistic states for a Navet Storybook story.

In a Navet fork, the widget should be wired through Navet's existing primitives and theme helpers. This package intentionally does not import Navet or expose Home Assistant payloads to the component.

The stylesheet is intentionally a separate import (`import "./routine-planner.css"`) so Node-based contract tests do not need a CSS loader.
