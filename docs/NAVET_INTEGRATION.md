# Navet integration strategy

AutiPlanner is intended to appear as a custom routine/calendar experience in Navet without turning shared Navet UI into Home Assistant-specific code.

## Upstream relationship

Upstream: `https://github.com/awesomestvi/navet`

Do not copy the entire Navet source tree into this repository as the default approach. Prefer one of:

1. maintain a fork of Navet and implement the AutiPlanner feature there;
2. develop a clean patch series against upstream;
3. if Navet later exposes an extension/plugin surface suitable for this use case, consume that surface.

Navet currently documents a package direction with provider-neutral core/UI layers and provider packages. Follow upstream `AGENTS.md` and its required architecture/UX docs before editing Navet.

## Target normalized UI model

The Navet-facing model should resemble the AutiPlanner core contract rather than raw Home Assistant entities:

```ts
type RoutineStatus = "pending" | "completed" | "missed" | "skipped";
type DayPart = "morning" | "afternoon" | "evening" | "night";

interface RoutineItem {
  uid: string;
  title: string;
  date: string;
  dayPart: DayPart;
  status: RoutineStatus;
  start?: string;
  due?: string;
  completedAt?: string;
}
```

## Target widget behavior

```text
TUESDAY — 11 AUGUST

MORNING
  ✓ Take medication     08:00
  ✓ Eat breakfast       08:30
  ○ Morning walk        10:00

AFTERNOON
  ✕ Exercise            13:30
  ○ Appointment         15:00

EVENING
  — Optional journaling 20:00
```

Suggested interactions:

- selecting an item opens details;
- a primary action marks pending -> completed;
- a secondary menu exposes missed, skipped, and reset;
- changing state sends a provider command and waits for normalized state to confirm the result;
- optimistic UI is optional but must roll back on provider failure.

## Likely Navet areas

Confirm against the current upstream tree before implementation. Upstream's current agent guidance points shared dashboard/app behavior toward `packages/app/src`, provider-neutral contracts toward `packages/core/src`, shared UI toward `packages/ui/src`, and Home Assistant adapter behavior toward `packages/provider-homeassistant/src`.

The desired dependency direction is:

```text
Navet shared widget
       ↑
provider-neutral AutiPlanner capability/model
       ↑
Home Assistant provider adapter
       ↑
AutiPlanner Home Assistant integration/entities/commands
```

Not:

```text
shared React widget -> raw Home Assistant websocket/service payloads
```

## Phase 3 implementation surface

`apps/navet-extension` now contains an AutiPlanner-owned prototype boundary:

- `src/capability.ts` is the provider-neutral state/command contract;
- `src/home-assistant-provider.ts` maps the HA to-do entity's normalized `autiplanner_items` attribute and translates commands to the four AutiPlanner services;
- `src/routine-planner.tsx` renders date/day-part groups, visible `○`/`✓`/`✕`/`—` states, primary completion, and progressive detail actions;
- `src/routine-planner.css` is a standalone preview stylesheet only, with light, dark, black, and glass theme variables;
- `src/story-fixtures.ts` and `test/` cover all states, malformed provider records, service translation, and accessible row affordances.

The implementation was guided by Navet's current compact calendar event item and calendar small view, the Home dashboard rhythm guidance, the provider-neutral UI contract, and the Home Assistant adapter/testing guidance. It remains a patch surface for a Navet fork; it does not vendor Navet or make the shared widget depend on Home Assistant.

## HACS SSH bridge patch

The HACS installation is a compiled Home Assistant panel under `/config/custom_components/navet`; it does not contain the TypeScript source from `apps/navet-extension`. Use [`scripts/install-navet-patch.sh`](../scripts/install-navet-patch.sh) to apply the compiled-installation bridge over SSH.

The script validates the HACS Navet directory, backs up `__init__.py` and existing AutiPlanner web assets under `/config/.autiplanner-backups/`, installs the shared calendar card, icon font, and Navet panel wrapper into `/config/www/`, then adds an **AutiPlanner** sidebar panel at `/autiplanner`. It leaves Navet's original `/navet` panel intact and is idempotent after HACS updates.

```bash
./scripts/install-navet-patch.sh \
  --host 192.168.1.20 \
  --port 2222 \
  --user root \
  --restart-command 'ha core restart'
```

Use `--navet-dir` when the HACS component is stored outside the usual `/config/custom_components/navet` path, or `--dry-run` to inspect the targets first. A Home Assistant restart is required to register the extra panel.

## Licensing

Navet currently identifies itself as AGPL-3.0. If a Navet fork contains modified Navet source, preserve the upstream license/notices and comply with the license for those derivative portions. Keep original AutiPlanner components and upstream-derived code clearly attributable rather than obscuring provenance.
